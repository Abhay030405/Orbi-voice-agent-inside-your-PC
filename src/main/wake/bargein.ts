// BARGE-IN: decides when the user is really talking over Orbi's reply, so it can stop.
//
// Pure logic (no model, no timers of its own): for every 20 ms mic chunk it gets "does the speech model
// think this is speech?", how loud the chunk is, and how loud Orbi itself is playing right now. The mic is
// echo-cancelled, but on laptop speakers a lot of Orbi's own voice still comes back (measured 2026-10-31:
// mic RMS 0.03–0.09 while it spoke, every chunk "speech" to the model; it stopped itself mid-answer).
// So the rules:
//   - warm-up at the start of each reply: nothing counts, and it LEARNS how much of its own playback
//     comes back into the mic (the echo gain: mic level / playback level),
//   - after that, a chunk counts only if it is speech AND clearly louder than the echo its own playback
//     would explain right now (ECHO_MARGIN × gain × playback level), and above a floor,
//   - sustained: most of the last ~0.4 s, not one cough or a door.
// When it pauses between sentences, the expected echo drops to nothing, so the user gets through easily.

import { rms } from './gate.ts'

export interface BargeInOptions {
  warmupChunks: number // nothing counts for this many chunks at the start of a reply; echo gain learned
  windowChunks: number // look at this many recent chunks…
  neededChunks: number // …and fire when at least this many were the user's speech
  minRms: number // quieter than this never counts (distant voices, faint leftover echo)
  echoMargin: number // the user must be this many times louder than the expected echo
  defaultEchoGain: number // used until learned (no playback during the warm-up)
}

export const BARGE_IN_DEFAULTS: BargeInOptions = {
  warmupChunks: 40, // 0.8 s
  windowChunks: 20, // 0.4 s
  neededChunks: 14, // 0.28 s of speech in it
  minRms: 0.015, // speech near the mic is ~0.03–0.3; a quiet room ~0.001–0.003 (brain.ts SPEECH_RMS)
  echoMargin: 2.5,
  defaultEchoGain: 0.5
}

// Echo learning, made robust (it worked once, then not again, 2026-11-01). The first version kept the
// LOUDEST mic/playback ratio of the warm-up: one chunk where the user was still finishing their sentence
// as the reply began (typical right after talking over the previous one), or where playback was barely
// audible, set a huge gain, and then nothing the user said could count as louder than "the echo".
// Now: only chunks with real playback teach, the MEDIAN of them is taken, a reply whose estimate jumps
// far above what earlier replies learned is treated as the user talking (ignored), and the gain is capped.
const TEACHING_PLAYBACK = 0.02 // playback quieter than this teaches nothing about the echo
const MIN_SAMPLES = 8 // fewer teaching chunks than this in the warm-up: keep what we knew
const MAX_ECHO_GAIN = 1 // speakers and mic don't make its own voice LOUDER than it plays; more = the user
const SUSPICIOUS_JUMP = 2 // an estimate this many times the known gain = someone was talking

export class BargeIn {
  private readonly opts: BargeInOptions
  private seen = 0
  private recent: boolean[] = []
  private ratios: number[] = [] // this reply's warm-up: mic level / playback level
  private known = 0 // learned over earlier replies (the room and volume rarely change); 0 = not yet

  constructor(opts: BargeInOptions = BARGE_IN_DEFAULTS) {
    this.opts = opts
  }

  // The echo gain in use now (for the trace log).
  get echoGain(): number {
    return Math.min(this.known || this.opts.defaultEchoGain, MAX_ECHO_GAIN)
  }

  // A new reply starts playing: warm-up again. What earlier replies learned about the echo is kept.
  reset(): void {
    this.seen = 0
    this.recent = []
    this.ratios = []
  }

  // One 20 ms chunk. `isSpeech` = the speech model's verdict; `playing` = how loud Orbi is playing right
  // now (RMS of its own output, PlaybackLevel). True = the user is talking over it.
  push(pcm: Uint8Array, isSpeech: boolean, playing = 0): boolean {
    const level = rms(pcm)
    this.seen++
    if (this.seen <= this.opts.warmupChunks) {
      if (playing >= TEACHING_PLAYBACK) this.ratios.push(level / playing)
      if (this.seen === this.opts.warmupChunks) this.learn()
      return false
    }
    const expectedEcho = this.echoGain * playing
    const theUser = isSpeech && level >= this.opts.minRms && level >= this.opts.echoMargin * expectedEcho
    this.recent.push(theUser)
    if (this.recent.length > this.opts.windowChunks) this.recent.shift()
    if (this.recent.filter(Boolean).length < this.opts.neededChunks) return false
    this.reset() // fire once, not on every chunk after
    return true
  }

  private learn(): void {
    if (this.ratios.length < MIN_SAMPLES) return
    const sorted = [...this.ratios].sort((a, b) => a - b)
    const estimate = Math.min(sorted[Math.floor(sorted.length / 2)], MAX_ECHO_GAIN)
    if (this.known === 0) this.known = estimate
    else if (estimate <= this.known * SUSPICIOUS_JUMP) this.known = 0.7 * this.known + 0.3 * estimate
    // else: much louder than its echo ever was = the user was talking during the warm-up; ignore it
  }
}

// How loud Orbi's own voice is coming out of the speakers right now. Its audio is played as it arrives
// (Gemini sends it at about real-time pace), one chunk after another, so we keep a small timeline of
// what plays when. Speakers and the mic add some delay, so "now" means the loudest of the last ~250 ms.
export class PlaybackLevel {
  private readonly now: () => number
  private readonly sampleRate: number
  private segments: { start: number; end: number; level: number }[] = []
  private playEnd = 0

  constructor(sampleRate = 24000, now: () => number = Date.now) {
    this.sampleRate = sampleRate
    this.now = now
  }

  // A chunk of Orbi's voice (16-bit mono PCM) was handed to the speakers.
  played(pcm: Uint8Array): void {
    const t = this.now()
    const start = Math.max(t, this.playEnd)
    const ms = (pcm.byteLength / 2 / this.sampleRate) * 1000
    this.playEnd = start + ms
    this.segments.push({ start, end: this.playEnd, level: rms(pcm) })
    this.segments = this.segments.filter((s) => s.end >= t - 1000)
  }

  // The speakers were silenced (interrupted, stopped).
  stopped(): void {
    this.segments = []
    this.playEnd = 0
  }

  level(lookbackMs = 250): number {
    const t = this.now()
    let max = 0
    for (const s of this.segments) if (s.start <= t && s.end >= t - lookbackMs) max = Math.max(max, s.level)
    return max
  }
}
