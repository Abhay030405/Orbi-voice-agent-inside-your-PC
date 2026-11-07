// PHONE BRIDGE: drive Dreamwalker from your phone, over the internet, with no ADB and no same network.
//
// Two ways in, both optional, both the same PWA (shared/remotePwa.ts):
//  1. The RELAY (default): an always-on server (relay/server.ts). The laptop dials OUT to it and keeps
//     one stream open, so nothing at home has to be reachable; the phone opens the relay's https URL.
//  2. A tiny HTTP server inside the app, on 127.0.0.1 only, for a tunnel you run yourself:
//       cloudflared tunnel --url http://localhost:8787
//
// It touches no other module: it takes callbacks. `onCommand(text)` is wired to the same path as typed
// text, so a phone command runs through the SAME gatekeeper, ledger and tools as the voice. Progress is
// the event stream the UI already gets; `offerFile` hands a file to the phone to download.
//
// Transport: SSE (laptop -> phone push) + POST (phone -> laptop). No WebSocket library, no APK.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import { PWA_HTML, PWA_ICON, PWA_MANIFEST, PWA_SERVICE_WORKER } from '../shared/remotePwa.ts'

export interface RemoteStatus {
  relay: string | null // the relay's URL, or null when it's switched off
  relayOnline: boolean // the laptop's stream to the relay is open right now
  localPort: number | null // the local server's port, if it's listening
  phones: number // phones that opened the remote since the relay connection began (best effort)
}

export interface PhoneBridge {
  /** Push any event to the phone. Feed it the same stream the UI gets (agent state, tool activity). */
  emit(event: { type: string; [k: string]: unknown }): void
  /** Make a file downloadable on the phone. Throws if it's too big or there's nowhere to send it. */
  offerFile(absPath: string): Promise<{ name: string; size: number }>
  /** Ask the phone to approve a risky action. Resolves true/false; false on timeout or abort. */
  askConfirm(summary: string, risk: string, signal?: AbortSignal, timeoutMs?: number): Promise<boolean>
  /** Stream a chunk of Orbi's voice to the phone (24 kHz Int16 PCM, as the speaker gets it). */
  sendAudio(pcm: Uint8Array): void
  /** Tell the phone to stop playing now (an interruption). */
  stopAudio(): void
  /** True while a phone command is in flight — so the caller routes replies, files and confirms to it. */
  commandActive: boolean
  token: string
  readonly status: RemoteStatus
  stop(): void
}

export interface BridgeOptions {
  token: string
  onCommand: (text: string) => void
  onContacts?: (list: { name: string; number: string }[]) => void
  onStop?: () => void // the phone's Stop button: silence Orbi now
  onUpload?: (name: string, data: Buffer) => Promise<string> // a file sent from the phone; returns where it was saved
  onStatus?: (status: RemoteStatus) => void
  relayUrl?: string | null
  port?: number | null // null = no local server
}

export const MAX_SEND_BYTES = 50 * 1024 * 1024
const MAX_BODY = 2 * 1024 * 1024
const MAX_UPLOAD = 25 * 1024 * 1024

const MIME: Record<string, string> = {
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function startPhoneBridge(opts: BridgeOptions): PhoneBridge {
  const token = opts.token
  const relay = opts.relayUrl ? opts.relayUrl.replace(/\/+$/, '') : null
  const status: RemoteStatus = { relay, relayOnline: false, localPort: null, phones: 0 }
  const setStatus = (patch: Partial<RemoteStatus>): void => {
    Object.assign(status, patch)
    opts.onStatus?.({ ...status })
  }

  const clients = new Set<ServerResponse>() // phones on the LOCAL server
  const files = new Map<string, { name: string; mime: string; buf: Buffer }>() // for the local server
  const confirms = new Map<string, (approved: boolean) => void>() // open phone confirmations, by id
  let stopped = false
  let live: AbortController | null = null // the relay stream now open

  // ── What the phone sends (same messages from the local server and from the relay) ──
  function command(body: Record<string, unknown>): void {
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
    if (!text) return
    bridge.commandActive = true
    opts.onCommand(text)
  }
  function confirmReply(body: Record<string, unknown>): void {
    confirms.get(String(body.id))?.(body.approve === true)
  }
  function contacts(body: Record<string, unknown>): number {
    const raw = body.contacts
    if (!Array.isArray(raw)) return 0
    // The Contact Picker gives {name:[...], tel:[...]} (arrays); accept that or {name, number}.
    const list = raw
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .flatMap((c) => {
        const nameRaw = Array.isArray(c.name) ? c.name[0] : c.name
        const name = typeof nameRaw === 'string' ? nameRaw.slice(0, 80) : ''
        const tels = Array.isArray(c.tel) ? c.tel : [c.tel ?? c.number]
        return tels.filter((t): t is string => typeof t === 'string').map((t) => ({ name, number: t.slice(0, 40) }))
      })
      .filter((c) => c.name && c.number)
      .slice(0, 2000)
    opts.onContacts?.(list)
    push({ type: 'event', msg: `shared ${list.length} contact${list.length === 1 ? '' : 's'} with the laptop (kept on your devices)` })
    return list.length
  }
  async function upload(name: string, data: Buffer): Promise<{ ok: boolean; saved?: string; error?: string }> {
    if (!opts.onUpload) return { ok: false, error: 'This laptop does not accept files.' }
    try {
      const saved = await opts.onUpload(name, data)
      push({ type: 'event', msg: `saved ${basename(saved)} in Downloads on the laptop` })
      return { ok: true, saved: basename(saved) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Relay client ──
  // Events go up in small batches (Orbi's voice is ~25 chunks a second), one request at a time, in order.
  let queue: unknown[] = []
  let flushing = false
  let flushTimer: NodeJS.Timeout | null = null
  const auth = { authorization: `Bearer ${token}` }

  function relayPush(obj: { type: string; [k: string]: unknown }): void {
    if (!relay || !status.relayOnline) return
    queue.push(obj)
    if (queue.length > 400) queue = queue.filter((e, i) => i >= queue.length - 200 || (e as { type?: unknown }).type !== 'audio')
    flushTimer ??= setTimeout(() => void flush(), 60)
  }
  async function flush(): Promise<void> {
    flushTimer = null
    if (flushing || queue.length === 0) return
    flushing = true
    const events = queue
    queue = []
    try {
      const res = await fetch(`${relay}/laptop/push`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) console.error(`[remote] relay refused events: ${res.status}`)
    } catch (err) {
      console.error(`[remote] couldn't send to the relay: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      flushing = false
      if (queue.length) flushTimer ??= setTimeout(() => void flush(), 0)
    }
  }

  async function onRelayMessage(m: { type?: unknown; body?: unknown; [k: string]: unknown }): Promise<void> {
    const body = (typeof m.body === 'object' && m.body !== null ? m.body : {}) as Record<string, unknown>
    switch (m.type) {
      case 'command':
        return command(body)
      case 'confirm-reply':
        return confirmReply(body)
      case 'contacts':
        return void contacts(body)
      case 'stop':
        return opts.onStop?.()
      case 'phones':
        return setStatus({ phones: typeof m.count === 'number' ? m.count : status.phones })
      case 'upload': {
        const id = String(m.id ?? '')
        const result = await upload(String(m.name ?? 'file'), Buffer.from(String(m.b64 ?? ''), 'base64'))
        await fetch(`${relay}/laptop/upload-done`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ id, ...result }),
          signal: AbortSignal.timeout(15_000)
        }).catch(() => {})
        return
      }
    }
  }

  async function relayLoop(): Promise<void> {
    let backoff = 1000
    while (!stopped && relay) {
      const ac = new AbortController()
      live = ac
      let lastData = Date.now()
      // The relay pings every 15 s. Silence for 45 s = a dead connection (sleep, Wi-Fi change): start over.
      const watchdog = setInterval(() => {
        if (Date.now() - lastData > 45_000) ac.abort()
      }, 5_000)
      try {
        const res = await fetch(`${relay}/laptop`, { headers: auth, signal: ac.signal })
        if (!res.ok || !res.body) throw new Error(`the relay answered ${res.status}`)
        setStatus({ relayOnline: true })
        console.log(`[remote] connected to the relay ${relay}`)
        backoff = 1000
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ''
        let from = 0 // where to look next: a 25 MB upload arrives in thousands of pieces
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          lastData = Date.now()
          buf += value
          let end: number
          while ((end = buf.indexOf('\n\n', from)) >= 0) {
            const block = buf.slice(0, end)
            buf = buf.slice(end + 2)
            from = 0
            for (const line of block.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                void onRelayMessage(JSON.parse(line.slice(6)) as { type?: unknown }).catch((err: unknown) =>
                  console.error(`[remote] ${err instanceof Error ? err.message : String(err)}`)
                )
              } catch {
                /* not JSON: ignore */
              }
            }
          }
          from = Math.max(0, buf.length - 1)
        }
      } catch (err) {
        if (!stopped) console.error(`[remote] relay: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        clearInterval(watchdog)
        if (status.relayOnline) setStatus({ relayOnline: false })
      }
      if (stopped) break
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 10_000) // the relay restarting (a deploy, a reboot) is back within seconds
    }
  }

  // ── Out to the phone(s), both ways ──
  function push(obj: { type: string; [k: string]: unknown }): void {
    const line = `data: ${JSON.stringify(obj)}\n\n`
    for (const res of clients) res.write(line)
    relayPush(obj)
  }

  const bridge: PhoneBridge = {
    token,
    commandActive: false,
    get status() {
      return { ...status }
    },
    emit: (event) => push(event),
    async offerFile(absPath) {
      const stat = await fs.stat(absPath)
      if (!stat.isFile()) throw new Error(`${basename(absPath)} is not a file`)
      if (stat.size > MAX_SEND_BYTES) throw new Error(`${basename(absPath)} is ${(stat.size / 1048576).toFixed(0)} MB; the limit is 50 MB`)
      if (!status.relayOnline && clients.size === 0) throw new Error('The phone remote is not connected (no internet, or the relay is off).')
      const buf = await fs.readFile(absPath)
      const name = basename(absPath)
      const mime = MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
      const id = randomBytes(8).toString('hex')
      // A copy for the local server only if a phone uses it: these can be 50 MB each.
      if (clients.size > 0) {
        files.set(id, { name, mime, buf })
        setTimeout(() => files.delete(id), 30 * 60_000).unref()
      }
      if (relay && status.relayOnline) {
        const res = await fetch(`${relay}/laptop/file?id=${id}&name=${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { ...auth, 'content-type': mime },
          body: buf,
          signal: AbortSignal.timeout(120_000)
        })
        if (!res.ok) throw new Error(`The relay refused the file (${res.status}).`)
      }
      push({ type: 'file-ready', name, size: buf.length, url: `/dl/${id}` })
      return { name, size: buf.length }
    },
    askConfirm(summary, risk, signal, timeoutMs = 60_000) {
      const id = randomBytes(6).toString('hex')
      return new Promise<boolean>((resolve) => {
        const settle = (approved: boolean, by: 'phone' | 'laptop' | 'timeout'): void => {
          if (!confirms.delete(id)) return // already answered (reply raced the timeout)
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          push({ type: 'confirm-close', id, summary, by })
          resolve(approved)
        }
        const onAbort = (): void => settle(false, 'laptop') // answered on the laptop: close it on the phone
        const timer = setTimeout(() => settle(false, 'timeout'), timeoutMs)
        timer.unref()
        confirms.set(id, (approved) => settle(approved, 'phone'))
        if (signal?.aborted) return settle(false, 'laptop')
        signal?.addEventListener('abort', onAbort)
        push({ type: 'confirm', id, summary, risk })
      })
    },
    sendAudio: (pcm) => push({ type: 'audio', b64: Buffer.from(pcm).toString('base64') }),
    stopAudio: () => push({ type: 'audio-stop' }),
    stop: () => {
      stopped = true
      live?.abort()
      server?.close()
    }
  }

  // ── The local server (127.0.0.1 only) ──
  const tokenOk = (given: unknown): boolean => {
    if (typeof given !== 'string' || given.length !== token.length) return false
    return timingSafeEqual(Buffer.from(given), Buffer.from(token))
  }
  const reply = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req: IncomingMessage, limit: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const parts: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > limit) {
          reject(new Error('too big'))
          req.destroy()
        } else parts.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(parts)))
      req.on('error', reject)
    })
  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    try {
      const v: unknown = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}')
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    const given = url.searchParams.get('token') ?? req.headers['x-token']
    const p = url.pathname

    if (p === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return void res.end(PWA_HTML)
    }
    if (p === '/health') return reply(res, 200, { ok: true })
    // PWA bits — must load before the token gate so the phone can install the app.
    if (p === '/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/manifest+json' })
      return void res.end(PWA_MANIFEST)
    }
    if (p === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      return void res.end(PWA_SERVICE_WORKER)
    }
    if (p === '/icon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' })
      return void res.end(PWA_ICON)
    }
    if (!tokenOk(given)) return reply(res, 401, { ok: false, error: 'Wrong pairing code. Scan the QR code on the laptop again.' })
    if (p === '/ping') return reply(res, 200, { ok: true, laptop: true })

    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write('retry: 2000\n\n')
      res.write(`data: ${JSON.stringify({ type: 'laptop', online: true })}\n\n`)
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }
    if (req.method === 'POST') {
      if (p === '/command') {
        command(await readJson(req))
        return reply(res, 200, { ok: true })
      }
      if (p === '/confirm-reply') {
        confirmReply(await readJson(req))
        return reply(res, 200, { ok: true })
      }
      if (p === '/stop') {
        opts.onStop?.()
        return reply(res, 200, { ok: true })
      }
      if (p === '/contacts') return reply(res, 200, { ok: true, count: contacts(await readJson(req)) })
      if (p === '/upload') {
        const data = await readBody(req, MAX_UPLOAD)
        const result = await upload(url.searchParams.get('name') ?? 'file', data)
        return reply(res, result.ok ? 200 : 502, result)
      }
    }
    if (p.startsWith('/dl/')) {
      const f = files.get(p.slice(4))
      if (!f) return reply(res, 404, { ok: false, error: 'That file has expired. Ask Orbi to send it again.' })
      res.writeHead(200, { 'content-type': f.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` })
      return void res.end(f.buf)
    }
    reply(res, 404, { ok: false, error: 'not found' })
  }

  let server: Server | null = null
  if (opts.port) {
    const port = opts.port
    server = createServer((req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) reply(res, 400, { ok: false, error: 'Bad request.' })
        else res.end()
      })
    })
    // A second copy of the app (or anything else) on the port must not crash this one.
    server.on('error', (err) => console.error(`[remote] local server not started: ${err.message}`))
    server.listen(port, '127.0.0.1', () => {
      setStatus({ localPort: port })
      console.log(`[remote] local bridge on http://localhost:${port} (for your own tunnel)`)
    })
  }
  if (relay) void relayLoop()

  return bridge
}
