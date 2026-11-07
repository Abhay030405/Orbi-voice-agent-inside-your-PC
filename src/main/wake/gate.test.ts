import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NoiseGate, rms } from './gate.ts'

// 20 ms of 16 kHz Int16 PCM at a given amplitude (a 440 Hz tone; 0 = silence).
function chunk(amplitude: number, tag = 0): Uint8Array {
  const pcm = new Int16Array(320)
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((i / 16000) * 2 * Math.PI * 440) * amplitude * 32767)
  if (tag) pcm[0] = tag // mark chunks so tests can tell them apart
  return new Uint8Array(pcm.buffer)
}

describe('NoiseGate (wake-word CPU saver)', () => {
  it('measures loudness', () => {
    assert.equal(rms(chunk(0)), 0)
    assert.ok(Math.abs(rms(chunk(0.5)) - 0.5 / Math.SQRT2) < 0.01)
  })

  it('passes nothing while the room is quiet', () => {
    const gate = new NoiseGate()
    for (let i = 0; i < 100; i++) assert.equal(gate.push(chunk(0.001)).length, 0)
    assert.equal(gate.open, false)
  })

  it('opens on sound and hands over the 0.3 s before it first (so "Hey" is not cut off)', () => {
    const gate = new NoiseGate()
    for (let i = 1; i <= 30; i++) gate.push(chunk(0.001, i))
    const out = gate.push(chunk(0.2, 99))
    assert.equal(out.length, 16) // 15 held + the loud one
    assert.equal(new Int16Array(out[0].buffer)[0], 16) // the newest 15 quiet ones: 16..30
    assert.equal(new Int16Array(out.at(-1)!.buffer)[0], 99)
  })

  it('stays open through a short pause between words, then closes after 1 s of quiet', () => {
    const gate = new NoiseGate()
    gate.push(chunk(0.2))
    for (let i = 0; i < 50; i++) assert.equal(gate.push(chunk(0)).length, 1, `quiet chunk ${i} still passes`)
    assert.equal(gate.push(chunk(0)).length, 0) // 1 s (50 chunks) of quiet later: closed
    assert.equal(gate.open, false)
  })
})
