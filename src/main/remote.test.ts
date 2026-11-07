// The phone remote end to end: the real relay (relay/server.ts) on a free port, the real laptop bridge
// (phoneBridge.ts) dialling out to it, and a fake phone using the same HTTP calls as the PWA.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { startPhoneBridge, type PhoneBridge } from './phoneBridge.ts'

process.env.PORT = '0'
const relayMod = await import('../../relay/server.ts')
const port = await relayMod.listening
const base = `http://127.0.0.1:${port}`
const token = randomBytes(24).toString('base64url')
const q = (path: string, t = token): string => `${base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`

const waitFor = async <T>(fn: () => T | undefined | false, what: string, ms = 5000): Promise<T> => {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

// A phone: the /events stream, collected.
function phone(): { events: Record<string, unknown>[]; close: () => void } {
  const events: Record<string, unknown>[] = []
  const ac = new AbortController()
  void (async () => {
    const res = await fetch(q('/events'), { signal: ac.signal })
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buf += value
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        for (const line of buf.slice(0, i).split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)))
        buf = buf.slice(i + 2)
      }
    }
  })().catch(() => {})
  return { events, close: () => ac.abort() }
}
const post = (path: string, body: unknown, t = token) =>
  fetch(q(path, t), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('phone remote through the relay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-remote-'))
  const commands: string[] = []
  const uploads: { name: string; data: Buffer }[] = []
  let stops = 0
  let bridge: PhoneBridge
  let p: ReturnType<typeof phone>

  before(async () => {
    bridge = startPhoneBridge({
      token,
      relayUrl: base,
      port: null,
      onCommand: (t) => commands.push(t),
      onStop: () => stops++,
      onUpload: async (name, data) => {
        uploads.push({ name, data })
        return join(dir, name)
      }
    })
    await waitFor(() => bridge.status.relayOnline, 'the laptop to connect')
    p = phone()
    await waitFor(() => p.events.find((e) => e.type === 'laptop'), 'laptop status')
  })
  after(() => {
    p.close()
    bridge.stop()
    relayMod.server.closeAllConnections()
    relayMod.server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the phone sees the laptop online', () => {
    assert.equal(p.events.find((e) => e.type === 'laptop')?.online, true)
  })

  it('a command from the phone reaches the agent, and marks the phone as the controller', async () => {
    const r = await post('/command', { text: '  open docker  ' })
    assert.equal(r.status, 200)
    await waitFor(() => commands.includes('open docker'), 'the command')
    assert.equal(bridge.commandActive, true)
  })

  it('empty or oversized commands are cut, never crash', async () => {
    await post('/command', { text: '' })
    await post('/command', { nope: 1 })
    await fetch(q('/command'), { method: 'POST', body: '{not json' })
    await post('/command', { text: 'x'.repeat(5000) })
    await waitFor(() => commands.some((c) => c.length === 2000), 'the long command, cut to 2000')
    assert.equal(commands.filter((c) => c === '').length, 0)
  })

  it("the agent's words and events reach the phone, in order", async () => {
    for (let i = 0; i < 30; i++) bridge.emit({ type: 'reply', text: `${i} ` })
    const replies = await waitFor(() => {
      const r = p.events.filter((e) => e.type === 'reply')
      return r.length >= 30 && r
    }, '30 replies')
    assert.equal(replies.map((r) => r.text).join(''), Array.from({ length: 30 }, (_, i) => `${i} `).join(''))
  })

  it('a confirmation answered on the phone', async () => {
    const asked = bridge.askConfirm('Delete notes.txt', 'high')
    const card = await waitFor(() => p.events.find((e) => e.type === 'confirm' && e.summary === 'Delete notes.txt'), 'the question')
    await post('/confirm-reply', { id: card.id, approve: true })
    assert.equal(await asked, true)
    const closed = await waitFor(() => p.events.find((e) => e.type === 'confirm-close' && e.id === card.id), 'the card to close')
    assert.equal(closed.by, 'phone')
  })

  it('a confirmation answered on the laptop first closes the phone card, as a no', async () => {
    const ac = new AbortController()
    const asked = bridge.askConfirm('Send the email', 'high', ac.signal)
    const card = await waitFor(() => p.events.find((e) => e.type === 'confirm' && e.summary === 'Send the email'), 'the question')
    ac.abort()
    assert.equal(await asked, false)
    const closed = await waitFor(() => p.events.find((e) => e.type === 'confirm-close' && e.id === card.id), 'the card to close')
    assert.equal(closed.by, 'laptop') // the phone says "answered on the laptop", not "Orbi didn't do it"
    await post('/confirm-reply', { id: card.id, approve: true }) // too late: ignored
  })

  it('an unanswered confirmation is a no', async () => {
    assert.equal(await bridge.askConfirm('Call Mom', 'high', undefined, 200), false)
  })

  it('a file from the laptop downloads on the phone, byte for byte', async () => {
    const data = randomBytes(300_000)
    const file = join(dir, 'deck.pptx')
    writeFileSync(file, data)
    const sent = await bridge.offerFile(file)
    assert.equal(sent.size, data.length)
    const ready = await waitFor(() => p.events.find((e) => e.type === 'file-ready'), 'file-ready')
    assert.equal(ready.name, 'deck.pptx')
    const res = await fetch(q(String(ready.url)))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /presentationml/)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), data)
    assert.equal((await fetch(q(String(ready.url), 'x'.repeat(40)))).status, 404) // another room has no such file
  })

  it('a file from the phone lands on the laptop', async () => {
    const res = await fetch(q('/upload?name=' + encodeURIComponent('hi there.txt')), { method: 'POST', body: 'hello laptop' })
    const body = (await res.json()) as { ok: boolean; saved?: string }
    assert.equal(body.ok, true)
    assert.equal(body.saved, 'hi there.txt')
    assert.equal(uploads.at(-1)?.data.toString(), 'hello laptop')
  })

  it("the phone's Stop button reaches the laptop", async () => {
    await post('/stop', {})
    await waitFor(() => stops === 1, 'stop')
  })

  it('a phone that opens later still sees the last replies and files (never old questions)', async () => {
    const late = phone()
    await waitFor(() => late.events.some((e) => e.type === 'file-ready'), 'history')
    assert.ok(late.events.some((e) => e.type === 'reply'))
    assert.ok(!late.events.some((e) => e.type === 'confirm'))
    assert.ok(!late.events.some((e) => e.type === 'audio'))
    late.close()
  })

  it('the phone can check its pairing code', async () => {
    assert.deepEqual(await (await fetch(q('/ping'))).json(), { ok: true, laptop: true, unknown: false })
    assert.equal((await fetch(q('/ping', 'W'.repeat(40)))).status, 200) // a valid-looking code: an empty room
    assert.equal((await fetch(q('/ping', 'bad'))).status, 401)
  })

  it('a phone that reconnects gets only what it missed, not the whole history again', async () => {
    const read = async (headers: Record<string, string>): Promise<string> => {
      const ac = new AbortController()
      const res = await fetch(q('/events'), { headers, signal: ac.signal })
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let text = ''
      const stop = setTimeout(() => ac.abort(), 400)
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          text += value
        }
      } catch {
        /* aborted */
      }
      clearTimeout(stop)
      return text
    }
    const fresh = await read({})
    const ids = [...fresh.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))
    assert.ok(ids.length > 5)
    const last = Math.max(...ids)
    assert.doesNotMatch(await read({ 'last-event-id': String(last) }), /"type":"reply"/)
    assert.match(await read({ 'last-event-id': String(last - 1) }), new RegExp(`id: ${last}\n`))
  })

  it('only a connected laptop can put files on the relay', async () => {
    const other = 'Y'.repeat(40)
    const r = await fetch(`${base}/laptop/file?id=abcdef0123456789&name=x.txt&token=${other}`, { method: 'PUT', body: 'x' })
    assert.equal(r.status, 409)
  })

  it('wrong, short or missing pairing codes are refused', async () => {
    assert.equal((await post('/command', { text: 'x' }, 'short')).status, 401)
    assert.equal((await fetch(`${base}/events`)).status, 401)
    assert.equal((await fetch(`${base}/laptop`)).status, 401)
    const other = 'Z'.repeat(40) // valid shape, but a different room: no laptop there
    assert.equal((await post('/command', { text: 'x' }, other)).status, 503)
    assert.equal(commands.includes('x'), false)
  })

  it('the PWA itself loads without a code', async () => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /Orbi Remote/)
    assert.equal((await fetch(`${base}/manifest.json`)).status, 200)
    assert.equal((await fetch(`${base}/sw.js`)).status, 200)
  })

  it('a too-big body is refused, and the relay keeps working', async () => {
    const r = await fetch(q('/command'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(3 * 1024 * 1024) }).catch(() => null)
    assert.ok(!r || r.status === 413)
    assert.equal((await fetch(`${base}/health`)).status, 200)
  })

  it('the laptop reconnects by itself when the connection drops', async () => {
    relayMod.server.closeAllConnections() // like a Wi-Fi drop: every stream dies
    await waitFor(() => !bridge.status.relayOnline, 'the drop to be noticed')
    await waitFor(() => bridge.status.relayOnline, 'the laptop to reconnect', 8000)
    p = phone()
    await waitFor(() => p.events.find((e) => e.type === 'laptop' && e.online === true), 'online again')
    assert.equal((await post('/command', { text: 'after the drop' })).status, 200)
    await waitFor(() => commands.includes('after the drop'), 'a command after the drop')
  })

  it('when the laptop goes away, the phone is told and commands say so', async () => {
    bridge.stop()
    await waitFor(() => p.events.find((e) => e.type === 'laptop' && e.online === false), 'offline')
    const r = await post('/command', { text: 'are you there' })
    assert.equal(r.status, 503)
    assert.match(((await r.json()) as { error: string }).error, /offline/)
  })
})
