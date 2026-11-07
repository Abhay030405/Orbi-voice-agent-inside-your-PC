// A beep, generated as raw PCM in exactly the format Gemini uses (24 kHz, 16-bit, mono), and split
// into chunks the way Gemini streams them. Lets us test the whole playback path without Gemini:
// if the beep plays cleanly, any later audio bug is in the Link, not the Mouth.

import { AUDIO } from './config'

const CHUNK_MS = 40

export function makeTestToneChunks(freqHz = 440, durationMs = 1200): Uint8Array[] {
  const rate = AUDIO.outputSampleRate
  const total = Math.round((rate * durationMs) / 1000)
  const samples = new Int16Array(total)

  for (let i = 0; i < total; i++) {
    // Fade in/out over 20 ms: jumping straight from silence to full volume makes an audible click.
    const fade = Math.min(1, i / (rate * 0.02), (total - i) / (rate * 0.02))
    samples[i] = Math.round(Math.sin((2 * Math.PI * freqHz * i) / rate) * 0.3 * fade * 32767)
  }

  const bytes = new Uint8Array(samples.buffer)
  const chunkBytes = ((rate * CHUNK_MS) / 1000) * 2 // 2 bytes per Int16 sample
  const chunks: Uint8Array[] = []
  for (let off = 0; off < bytes.length; off += chunkBytes) {
    chunks.push(bytes.slice(off, off + chunkBytes))
  }
  return chunks
}
