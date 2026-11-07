// THE RELAY: lets the phone reach the laptop from anywhere, with no tunnel and no open port at home.
// Runs on a small always-on VM (relay/vm-startup.sh), behind Caddy for HTTPS.
//
// Both sides dial OUT to it. The laptop keeps one stream open (GET /laptop, server-sent events) and
// posts what it has to say (POST /laptop/push, PUT /laptop/file). The phone uses the same endpoints
// as the laptop's own bridge (main/phoneBridge.ts), so the one PWA works with either.
//
// Rooms: a laptop and its phones meet in the room named sha256(pairing code). The relay keeps no
// accounts and no config: it never stores the code, only that hash, and everything lives in memory.
// Zero dependencies (node:http only). Bundled to one file by relay/deploy.mjs.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { PWA_HTML, PWA_ICON, PWA_MANIFEST, PWA_SERVICE_WORKER, TOKEN_RE } from '../src/shared/remotePwa.ts'

const PORT = Number(process.env.PORT || 8080)
const MAX_JSON = 2 * 1024 * 1024
const MAX_FILE = 50 * 1024 * 1024
const MAX_UPLOAD = 25 * 1024 * 1024
const ROOM_FILES_MAX = 150 * 1024 * 1024
const ALL_FILES_MAX = 300 * 1024 * 1024 // all rooms together: the VM allows the relay 600 MB
const MAX_ROOMS = 500
const FILE_TTL_MS = 30 * 60_000
const HISTORY_MS = 30 * 60_000 // a phone that opens later still sees the last half hour (not audio)
const PING_MS = 15_000

interface StoredFile {
  name: string
  mime: string
  buf: Buffer
  at: number
}
interface Room {
  laptop: ServerResponse | null
  laptopSeen: boolean // a laptop has used this code since the relay started
  phones: Set<ServerResponse>
  files: Map<string, StoredFile>
  history: { at: number; seq: number; json: string }[]
  touched: number
}

const rooms = new Map<string, Room>()
let seq = 0 // event ids, so a phone that reconnects only gets what it missed (EventSource's Last-Event-ID)
const roomId = (token: string): string => createHash('sha256').update(token).digest('hex')

function room(token: string): Room {
  const id = roomId(token)
  let r = rooms.get(id)
  if (!r) {
    if (rooms.size >= MAX_ROOMS) throw new Error('busy')
    r = { laptop: null, laptopSeen: false, phones: new Set(), files: new Map(), history: [], touched: Date.now() }
    rooms.set(id, r)
  }
  r.touched = Date.now()
  return r
}

const sse = (res: ServerResponse, obj: unknown): void => {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

function toPhones(r: Room, obj: { type?: unknown; [k: string]: unknown }): void {
  const json = JSON.stringify(obj)
  // Keep what a phone opened later would want to see; never audio, never open questions.
  const kept = obj.type === 'file-ready' || obj.type === 'event' || obj.type === 'reply' || obj.type === 'turn-end'
  const line = kept ? `id: ${++seq}\ndata: ${json}\n\n` : `data: ${json}\n\n`
  for (const p of r.phones) p.write(line)
  if (kept) {
    r.history.push({ at: Date.now(), seq, json })
    const cutoff = Date.now() - HISTORY_MS
    while (r.history.length > 300 || (r.history[0] && r.history[0].at < cutoff)) r.history.shift()
  }
}

function toLaptop(r: Room, obj: unknown): boolean {
  if (!r.laptop) return false
  sse(r.laptop, obj)
  return true
}

// ── Small HTTP helpers ─────────────────────────────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > limit) return reject(new Error('too big'))
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('too big'))
        req.destroy()
        return
      }
      parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const v: unknown = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}')
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function tokenOf(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization
  const t = (auth?.startsWith('Bearer ') ? auth.slice(7) : null) ?? url.searchParams.get('token') ?? (req.headers['x-token'] as string | undefined) ?? ''
  return TOKEN_RE.test(t) ? t : null
}

// A wrong code costs a guesser nothing but time; still, don't let one address hammer us.
const misses = new Map<string, { n: number; since: number }>()
function tooManyMisses(ip: string): boolean {
  const m = misses.get(ip)
  return !!m && Date.now() - m.since < 60_000 && m.n >= 30
}
function miss(ip: string): void {
  const m = misses.get(ip)
  if (!m || Date.now() - m.since > 60_000) misses.set(ip, { n: 1, since: Date.now() })
  else m.n++
}

function openStream(req: IncomingMessage, res: ServerResponse, onClose: () => void): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  res.write('retry: 2000\n\n')
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS)
  req.on('close', () => {
    clearInterval(ping)
    onClose()
  })
}

const MIME_OK = /^[\w.+-]+\/[\w.+-]+$/

// ── Routes ─────────────────────────────────────────────────────────────────────────────────────────
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://relay')
  const path = url.pathname
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()

  if (req.method === 'GET') {
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
      return void res.end(PWA_HTML)
    }
    if (path === '/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/manifest+json' })
      return void res.end(PWA_MANIFEST)
    }
    if (path === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' })
      return void res.end(PWA_SERVICE_WORKER)
    }
    if (path === '/icon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' })
      return void res.end(PWA_ICON)
    }
    if (path === '/health') return json(res, 200, { ok: true, rooms: rooms.size, up: Math.round(process.uptime()) })
  }

  if (tooManyMisses(ip)) return json(res, 429, { ok: false, error: 'Too many tries. Wait a minute.' })
  const token = tokenOf(req, url)
  if (!token) {
    miss(ip)
    return json(res, 401, { ok: false, error: 'Wrong pairing code. Scan the QR code on the laptop again.' })
  }
  const r = room(token)

  // ── The laptop's side ──
  if (path === '/laptop' && req.method === 'GET') {
    const old = r.laptop
    r.laptop = res
    r.laptopSeen = true
    old?.end() // a newer connection from the laptop replaces the old one
    openStream(req, res, () => {
      if (r.laptop !== res) return
      r.laptop = null
      toPhones(r, { type: 'laptop', online: false })
    })
    sse(res, { type: 'hello', phones: r.phones.size })
    toPhones(r, { type: 'laptop', online: true })
    return
  }
  if (path === '/laptop/push' && req.method === 'POST') {
    const body = await readJson(req)
    const events = Array.isArray(body.events) ? body.events : []
    for (const e of events) if (typeof e === 'object' && e !== null) toPhones(r, e as { type?: unknown; [k: string]: unknown })
    return json(res, 200, { ok: true, phones: r.phones.size })
  }
  if (path === '/laptop/file' && req.method === 'PUT') {
    if (!r.laptop) return json(res, 409, { ok: false, error: 'Only a connected laptop can send files.' })
    const id = url.searchParams.get('id') ?? ''
    const name = (url.searchParams.get('name') ?? 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160)
    const mime = String(req.headers['content-type'] ?? '')
    if (!/^[a-f0-9]{8,32}$/.test(id)) return json(res, 400, { ok: false, error: 'bad id' })
    const buf = await readBody(req, MAX_FILE)
    r.files.set(id, { name, mime: MIME_OK.test(mime) ? mime : 'application/octet-stream', buf, at: Date.now() })
    let total = 0
    for (const f of r.files.values()) total += f.buf.length
    for (const [k, f] of r.files) {
      if (total <= ROOM_FILES_MAX) break
      total -= f.buf.length
      r.files.delete(k) // oldest first (Map keeps insertion order)
    }
    trimAllFiles()
    return json(res, 200, { ok: true })
  }

  // ── The phone's side ──
  // "Is my code right?" A code no laptop has used for minutes (the relay was up all along) is likely an old one.
  if (path === '/ping' && req.method === 'GET') {
    return json(res, 200, { ok: true, laptop: !!r.laptop, unknown: !r.laptopSeen && process.uptime() > 180 })
  }
  if (path === '/events' && req.method === 'GET') {
    r.phones.add(res)
    openStream(req, res, () => r.phones.delete(res))
    sse(res, { type: 'laptop', online: !!r.laptop })
    // A reconnect (EventSource sends the last id it saw) gets only what it missed; a new page gets the last 30 min.
    const after = Number(req.headers['last-event-id'] ?? 0) || 0
    const cutoff = Date.now() - HISTORY_MS
    for (const h of r.history) if (h.seq > after && h.at >= cutoff) res.write(`id: ${h.seq}\ndata: ${h.json}\n\n`)
    toLaptop(r, { type: 'phones', count: r.phones.size })
    return
  }
  if (path.startsWith('/dl/') && req.method === 'GET') {
    const f = r.files.get(path.slice(4))
    if (!f) return json(res, 404, { ok: false, error: 'That file has expired. Ask Orbi to send it again.' })
    res.writeHead(200, {
      'content-type': f.mime,
      'content-length': String(f.buf.length),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'cache-control': 'no-store'
    })
    return void res.end(f.buf)
  }
  if (req.method === 'POST' && ['/command', '/confirm-reply', '/contacts', '/stop'].includes(path)) {
    const body = await readJson(req)
    if (!r.laptop) return json(res, 503, { ok: false, error: 'Your laptop is offline (asleep, no internet, or Orbi is closed).' })
    toLaptop(r, { type: path.slice(1), body })
    return json(res, 200, { ok: true })
  }
  if (path === '/upload' && req.method === 'POST') {
    if (!r.laptop) return json(res, 503, { ok: false, error: 'Your laptop is offline.' })
    const name = (url.searchParams.get('name') ?? 'file').slice(0, 160)
    const buf = await readBody(req, MAX_UPLOAD)
    const id = randomBytes(8).toString('hex')
    const key = `${roomId(token)}:${id}`
    // The laptop answers on /laptop/push with {type:'upload-done', id, ok, error?}.
    const done = new Promise<{ ok: boolean; error?: string; saved?: string }>((resolve) => {
      uploads.set(key, resolve)
      setTimeout(() => {
        if (uploads.delete(key)) resolve({ ok: false, error: 'The laptop did not answer.' })
      }, 30_000).unref()
    })
    toLaptop(r, { type: 'upload', id, name, b64: buf.toString('base64') })
    const result = await done
    return json(res, result.ok ? 200 : 502, result)
  }
  if (path === '/laptop/upload-done' && req.method === 'POST') {
    const body = await readJson(req)
    const key = `${roomId(token)}:${String(body.id)}`
    const resolve = uploads.get(key)
    if (resolve) {
      uploads.delete(key)
      resolve({ ok: body.ok === true, error: typeof body.error === 'string' ? body.error : undefined, saved: typeof body.saved === 'string' ? body.saved : undefined })
    }
    return json(res, 200, { ok: true })
  }

  json(res, 404, { ok: false, error: 'not found' })
}

// All rooms together stay under ALL_FILES_MAX: the oldest files anywhere go first.
function trimAllFiles(): void {
  const all: { r: Room; k: string; f: StoredFile }[] = []
  for (const r of rooms.values()) for (const [k, f] of r.files) all.push({ r, k, f })
  let total = all.reduce((n, x) => n + x.f.buf.length, 0)
  for (const x of all.sort((a, b) => a.f.at - b.f.at)) {
    if (total <= ALL_FILES_MAX) break
    total -= x.f.buf.length
    x.r.files.delete(x.k)
  }
}

const uploads = new Map<string, (r: { ok: boolean; error?: string; saved?: string }) => void>()

// Rooms nobody uses, and old files, go away.
setInterval(() => {
  const now = Date.now()
  for (const [id, r] of rooms) {
    for (const [k, f] of r.files) if (now - f.at > FILE_TTL_MS) r.files.delete(k)
    if (!r.laptop && r.phones.size === 0 && now - r.touched > 6 * 3600_000) rooms.delete(id)
  }
  for (const [ip, m] of misses) if (now - m.since > 60_000) misses.delete(ip)
}, 60_000).unref()

export const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    const code = msg === 'too big' ? 413 : msg === 'busy' ? 503 : 400
    if (!res.headersSent) json(res, code, { ok: false, error: code === 413 ? 'Too big.' : code === 503 ? 'The relay is busy.' : 'Bad request.' })
    else res.end()
  })
})
server.requestTimeout = 0 // streams stay open for hours
server.headersTimeout = 30_000
server.keepAliveTimeout = 65_000
// Resolves with the port once listening (tests pass PORT=0 for a free one).
export const listening = new Promise<number>((resolve) => {
  server.listen(PORT, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port
    console.log(`[relay] listening on 127.0.0.1:${port}`)
    resolve(port)
  })
})
