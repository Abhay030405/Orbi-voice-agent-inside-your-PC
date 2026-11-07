// Runs on the AUDIO THREAD, not the page's JS thread. The browser calls process() every 128 samples
// (8 ms at 16 kHz). If this ran on the page thread, a slow React render could make us miss
// samples, and the user's words would come out choppy.
//
// Job: take the mic's Float32 samples (-1..1), convert to Int16 (what Gemini wants), and hand off
// 20 ms chunks (320 samples = 640 bytes) to the page.

// The AudioWorklet's own globals. TypeScript's DOM types don't include them, so declare the bits
// we use. `export {}` keeps these declarations local to this file.
declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
export {}

const CHUNK_MS = 20

class MicProcessor extends AudioWorkletProcessor {
  private readonly chunkSamples = Math.round((sampleRate * CHUNK_MS) / 1000)
  private chunk = new Int16Array(this.chunkSamples)
  private filled = 0

  process(inputs: Float32Array[][]): boolean {
    const samples = inputs[0]?.[0] // first input, first (only) channel
    if (!samples) return true

    for (let i = 0; i < samples.length; i++) {
      // Float32 → Int16. Clamp first: loud input can go slightly past ±1.
      const s = Math.max(-1, Math.min(1, samples[i]))
      this.chunk[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff

      if (this.filled === this.chunkSamples) {
        // Transfer, don't copy: the buffer moves to the page thread and we start a fresh one.
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer])
        this.chunk = new Int16Array(this.chunkSamples)
        this.filled = 0
      }
    }
    return true // keep running
  }
}

registerProcessor('mic-processor', MicProcessor)
