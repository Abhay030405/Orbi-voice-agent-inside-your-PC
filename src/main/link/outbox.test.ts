import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Outbox } from './outbox.ts'

const kinds = (o: Outbox<string>, resumed = true) =>
  o.takeForReplay(resumed).map((e) => `${e.kind}:${e.message}`)

describe('Outbox (what to re-send after a reconnect)', () => {
  it('forgets what the server confirmed and replays the rest, in order', () => {
    const o = new Outbox<string>(100)
    o.sent('text', 'q1') // #1
    o.sent('audio', 'a2') // #2
    o.sent('audio', 'a3') // #3
    o.confirm(2) // server: "I have #1 and #2"
    o.sent('audio', 'a4') // #4
    assert.deepEqual(kinds(o), ['audio:a3', 'audio:a4'])
  })

  it('numbering restarts at 1 on every connection (measured from the real server)', () => {
    const o = new Outbox<string>(100)
    o.sent('text', 'old1')
    o.takeForReplay(true) // reconnect: replay would re-send old1 and record it again
    o.sent('text', 'old1') // #1 on the new connection
    o.sent('text', 'new2') // #2
    o.confirm(1)
    assert.deepEqual(kinds(o), ['text:new2'])
  })

  it('delivers messages queued while disconnected, after the unconfirmed ones', () => {
    const o = new Outbox<string>(100)
    o.sent('audio', 'a1')
    o.queued('audio', 'a2') // connection is down
    o.queued('audioEnd', 'end')
    o.confirm(5) // a stale confirmation can't remove messages that were never sent
    assert.deepEqual(kinds(o), ['audio:a2', 'audioEnd:end'])
  })

  it('drops tool results when the session could not be resumed', () => {
    const o = new Outbox<string>(100)
    o.queued('toolResult', 't1')
    o.queued('text', 'q')
    assert.deepEqual(kinds(o, false), ['text:q'])
  })

  it('caps buffered audio by dropping the oldest', () => {
    const o = new Outbox<string>(2)
    o.sent('audio', 'a1')
    o.sent('text', 't')
    o.sent('audio', 'a2')
    o.sent('audio', 'a3')
    assert.deepEqual(kinds(o), ['text:t', 'audio:a2', 'audio:a3'])
  })
})
