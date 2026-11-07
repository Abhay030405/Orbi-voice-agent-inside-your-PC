// Barge-in rules (wake/bargein.ts): when "the speech model says speech" really means the user cut in.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BargeIn, PlaybackLevel } from './bargein.ts'

// A 20 ms chunk at a given loudness (constant samples: RMS = value).
function chunkAt(level: number): Uint8Array {
  const s = new Int16Array(320).fill(Math.round(level * 32767))
  return new Uint8Array(s.buffer)
}
const loud = chunkAt(0.1)
const quiet = chunkAt(0.005)
const opts = { warmupChunks: 10, windowChunks: 10, neededChunks: 7, minRms: 0.015, echoMargin: 2.5, defaultEchoGain: 0.5 }

function run(b: BargeIn, n: number, pcm: Uint8Array, speech: boolean, playing = 0): number {
  let fired = 0
  for (let i = 0; i < n; i++) if (b.push(pcm, speech, playing)) fired++
  return fired
}

describe('barge-in', () => {
  it('fires after enough loud speech, once', () => {
    const b = new BargeIn(opts)
    assert.equal(run(b, 10, loud, true), 0, 'warm-up: ignored')
    assert.equal(run(b, 6, loud, true), 0, 'not yet enough')
    assert.equal(run(b, 1, loud, true), 1, 'the 7th loud speech chunk fires')
    assert.equal(run(b, 6, loud, true), 0, 'starts over after firing (warm-up again)')
  })

  it('ignores the start of a reply (echo canceller still adapting)', () => {
    const b = new BargeIn({ ...opts, warmupChunks: 50 })
    assert.equal(run(b, 50, loud, true), 0)
  })

  it('ignores quiet "speech" (leftover echo of its own voice, people far away)', () => {
    const b = new BargeIn(opts)
    assert.equal(run(b, 100, quiet, true), 0)
  })

  it('ignores loud sounds that are not speech (a door, a cough)', () => {
    const b = new BargeIn(opts)
    assert.equal(run(b, 100, loud, false), 0)
  })

  it('needs speech to be sustained: scattered blips do not add up', () => {
    const b = new BargeIn(opts)
    run(b, 10, loud, false)
    let fired = 0
    for (let i = 0; i < 60; i++) if (b.push(loud, i % 3 === 0)) fired++ // 1 in 3 chunks
    assert.equal(fired, 0)
  })

  it('tolerates short gaps inside real speech', () => {
    const b = new BargeIn(opts)
    run(b, 10, loud, false)
    let fired = 0
    for (let i = 0; i < 10; i++) if (b.push(loud, i % 4 !== 3)) fired++ // 3 in 4 chunks
    assert.equal(fired, 1)
  })

  it('reset() brings the warm-up back (a new reply)', () => {
    const b = new BargeIn(opts)
    run(b, 10, loud, false)
    run(b, 6, loud, true)
    b.reset()
    assert.equal(run(b, 10, loud, true), 0)
  })
})

describe('barge-in: its own voice coming back through the speakers', () => {
  // Orbi plays at 0.2; the mic hears it back at 0.06 (gain 0.3), and the speech model calls it speech.
  const echo = chunkAt(0.06)
  const user = chunkAt(0.2) // a person at the laptop, talking over it

  it('learns the echo during the warm-up and does not stop for its own voice', () => {
    const b = new BargeIn(opts)
    let fired = 0
    for (let i = 0; i < 200; i++) if (b.push(echo, true, 0.2)) fired++
    assert.equal(fired, 0)
  })

  it('still stops for the user, who is clearly louder than that echo', () => {
    const b = new BargeIn(opts)
    run(b, 10, echo, true, 0.2) // warm-up while it speaks: learns gain 0.3
    let fired = 0
    for (let i = 0; i < 10; i++) if (b.push(user, true, 0.2)) fired++
    assert.equal(fired, 1)
  })

  it('a user as quiet as the echo is not enough while it speaks loudly…', () => {
    const b = new BargeIn(opts)
    run(b, 10, echo, true, 0.2)
    assert.equal(run(b, 50, chunkAt(0.08), true, 0.2), 0)
  })

  it('…but gets through in its pause between sentences (no playback, no expected echo)', () => {
    const b = new BargeIn(opts)
    run(b, 10, echo, true, 0.2)
    assert.equal(run(b, 10, chunkAt(0.08), true, 0), 1)
  })

  it('without a learned gain (silent warm-up) it uses a cautious default', () => {
    const b = new BargeIn(opts)
    run(b, 10, quiet, false, 0) // nothing played during the warm-up
    assert.equal(run(b, 50, chunkAt(0.2), true, 0.2), 0, '0.2 < 2.5 × 0.5 × 0.2')
    assert.equal(run(b, 10, chunkAt(0.3), true, 0.2), 1, '0.3 > 0.25')
  })

  it('the user still talking as the NEXT reply starts does not make that reply impossible to stop', () => {
    // The bug of 2026-11-01: worked once, then never again. Reply 1 learns the real echo (0.3); in
    // reply 2's warm-up the user is still finishing their sentence (0.2 over playback 0.2 = "gain 1").
    const b = new BargeIn(opts)
    run(b, 10, echo, true, 0.2)
    run(b, 10, user, true, 0.2) // first reply talked over
    b.reset()
    run(b, 10, user, true, 0.2) // reply 2 warm-up: the user, not the echo
    assert.ok(b.echoGain < 0.35, `gain kept near 0.3, got ${b.echoGain}`)
    assert.equal(run(b, 10, user, true, 0.2), 1, 'reply 2 can still be stopped')
  })

  it('one odd loud chunk, or a barely audible start, does not set the echo gain', () => {
    const b = new BargeIn(opts)
    b.push(chunkAt(0.3), true, 0.01) // ratio 30, but playback too quiet to teach anything
    b.push(chunkAt(0.3), true, 0.2) // one loud blip (ratio 1.5)
    run(b, 8, echo, true, 0.2)
    assert.ok(Math.abs(b.echoGain - 0.3) < 0.01, `median, not max: ${b.echoGain}`)
  })

  it('remembers the echo across replies', () => {
    const b = new BargeIn(opts)
    run(b, 10, echo, true, 0.2)
    b.reset()
    run(b, 10, quiet, false, 0) // a reply that starts with silence teaches nothing
    assert.ok(Math.abs(b.echoGain - 0.3) < 0.01)
  })

  it('never believes the echo is louder than its own playback', () => {
    const b = new BargeIn(opts)
    run(b, 10, user, true, 0.1) // user talking through the very first warm-up: ratio 2
    assert.equal(b.echoGain, 1)
  })
})

describe('playback level (how loud it is playing right now)', () => {
  const chunk24k = (ms: number, level: number): Uint8Array => {
    const s = new Int16Array(Math.round((24000 * ms) / 1000)).fill(Math.round(level * 32767))
    return new Uint8Array(s.buffer)
  }

  it('follows the queued audio in time, and keeps the recent peak for the speaker/mic delay', () => {
    let t = 1000
    const p = new PlaybackLevel(24000, () => t)
    p.played(chunk24k(500, 0.2)) // plays 1000–1500
    p.played(chunk24k(500, 0.05)) // queued: plays 1500–2000
    assert.ok(Math.abs(p.level() - 0.2) < 0.001)
    t = 1800
    assert.ok(Math.abs(p.level() - 0.05) < 0.001, 'the loud part ended > 250 ms ago')
    t = 2100
    assert.ok(Math.abs(p.level() - 0.05) < 0.001, 'still within the delay window')
    t = 2400
    assert.equal(p.level(), 0, 'silence after the queue ran out')
  })

  it('drops everything when the speakers are silenced', () => {
    const t = 0
    const p = new PlaybackLevel(24000, () => t)
    p.played(chunk24k(500, 0.2))
    p.stopped()
    assert.equal(p.level(), 0)
  })
})
