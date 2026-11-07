// MOUTH: plays Gemini's voice. Receives raw 24 kHz Int16 PCM chunks and schedules them back to
// back on the Web Audio clock so there are no gaps or clicks between chunks.
// How and why: docs/build-log/02-speak.md, Part 2.

const SAMPLE_RATE = 24_000
// When we've run out of audio and a new chunk arrives, start it this far in the future instead of
// "now". A tiny jitter buffer: gives the next chunk time to arrive. Bigger = smoother but laggier.
const CUSHION_S = 0.05

export class Mouth {
  // An AudioContext at Gemini's rate, so the browser does the 24 kHz → speaker-rate conversion.
  private readonly ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  // The moment (on ctx.currentTime's clock, in seconds) when the last scheduled chunk ends.
  private playhead = 0
  // Chunks scheduled or playing right now. Needed to stop them all on interrupt (slice 2).
  private readonly live = new Set<AudioBufferSourceNode>()
  // Every chunk passes through this on its way to the speakers, so we can measure how loud the
  // voice is right now (for the edge glow).
  private readonly analyser = this.ctx.createAnalyser()
  private readonly wave = new Float32Array(512)

  constructor(private readonly onDrained: () => void) {
    this.analyser.fftSize = 512
    this.analyser.connect(this.ctx.destination)
    // If the audio device fails (unplugged headphones, driver hiccup, another app grabbing it),
    // scheduled chunks never fire `onended`, so we'd never report "done" and the agent would sit in
    // "speaking" forever. Seen in testing. Treat a device error as "playback is over".
    this.ctx.addEventListener('error', () => {
      console.error('[mouth] audio device error: dropping queued speech')
      const hadAudio = this.live.size > 0
      this.stop()
      if (hadAudio) this.onDrained()
    })
  }

  enqueue(pcm: Uint8Array): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()

    // Int16 needs 2 bytes per sample. Copy into a fresh buffer: the bytes we got over IPC may sit
    // at an odd offset inside a bigger buffer, and Int16Array requires an even offset.
    const even = pcm.byteLength - (pcm.byteLength % 2)
    const samples = new Int16Array(pcm.slice(0, even).buffer)
    if (samples.length === 0) return

    // Int16 (-32768..32767) → Float32 (-1..1), the format Web Audio wants.
    const buffer = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.analyser)

    // Schedule on the timeline: right where the previous chunk ends. If that's already in the
    // past (we ran dry), restart a cushion's length from now.
    const now = this.ctx.currentTime
    if (this.playhead < now) this.playhead = now + CUSHION_S
    source.start(this.playhead)
    this.playhead += buffer.duration

    this.live.add(source)
    source.onended = () => {
      this.live.delete(source)
      if (this.live.size === 0) this.onDrained()
    }
  }

  // "I heard you": two quick rising notes. Not part of the speech queue, so it never counts as
  // the agent speaking, and stop() doesn't cut it off.
  chime(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const start = this.ctx.currentTime + 0.01
    for (const [i, freq] of [880, 1320].entries()) {
      const t = start + i * 0.09
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.frequency.value = freq
      // Quick fade in and out: a sudden start or stop makes an audible click.
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.12, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      osc.connect(gain).connect(this.ctx.destination)
      osc.start(t)
      osc.stop(t + 0.13)
    }
  }

  // Stop everything now and forget the queue. Used for interrupts (slice 2) and unmount.
  // Loudness right now, 0..1: the RMS (root mean square) of the last ~20 ms of the wave, scaled so
  // normal speech lands around 0.3–0.8.
  level(): number {
    this.analyser.getFloatTimeDomainData(this.wave)
    return rmsLevel(this.wave)
  }

  stop(): void {
    for (const source of this.live) {
      source.onended = null
      source.stop()
    }
    this.live.clear()
    this.playhead = 0
  }

  close(): void {
    this.stop()
    void this.ctx.close()
  }
}

// Shared by Mouth and Ear. RMS = sqrt(mean of squares): a standard "how loud" measure. Speech RMS is
// small (~0.05–0.2), so scale it up and clamp to 0..1.
export function rmsLevel(wave: Float32Array): number {
  let sum = 0
  for (const v of wave) sum += v * v
  return Math.min(1, Math.sqrt(sum / wave.length) * 5)
}
