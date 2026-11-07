// NOISE GATE for the wake word. The spotter is a small speech model; running it 50 times a second on
// a silent room cost about a third of a CPU core (measured, docs/build-log/09-ui.md). So: skip it while
// the room is quiet, and run it only around sound.
//
// The danger is cutting off the start of "Hey…": the gate only notices sound once it's already loud.
// So it keeps the last LOOKBACK chunks while closed and, when it opens, hands those over first. It
// stays open HOLD chunks after the last loud one, so the pauses between words are still heard.
//
// Pure: no Electron, unit-tested in gate.test.ts.

const THRESHOLD = 0.006 // RMS (0..1). Speech at a normal distance is ~0.03–0.3; a quiet room with the
// browser's noise suppression is ~0.001–0.003.
const LOOKBACK = 15 // 15 × 20 ms = 0.3 s of audio from just before the gate opened
const HOLD = 50 // stay open 1 s after the last loud chunk

export function rms(pcm: Uint8Array): number {
  const n = Math.floor(pcm.byteLength / 2)
  if (n === 0) return 0
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true) / 32768
    sum += s * s
  }
  return Math.sqrt(sum / n)
}

export class NoiseGate {
  private held: Uint8Array[] = []
  private quietFor = HOLD // start closed

  // Returns the chunks to give the spotter now: none while quiet; on opening, the held lookback plus
  // this chunk; while open, just this chunk.
  push(pcm: Uint8Array): Uint8Array[] {
    const loud = rms(pcm) >= THRESHOLD
    const wasOpen = this.quietFor < HOLD
    this.quietFor = loud ? 0 : Math.min(HOLD, this.quietFor + 1)
    if (wasOpen) return [pcm]
    if (loud) {
      const out = [...this.held, pcm]
      this.held = []
      return out
    }
    this.held.push(pcm)
    if (this.held.length > LOOKBACK) this.held.shift()
    return []
  }

  get open(): boolean {
    return this.quietFor < HOLD
  }
}
