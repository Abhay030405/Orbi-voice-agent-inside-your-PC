// EAR: the microphone. Opening a mic takes 100–300 ms, so opening it on every button press would cut
// off the user's first word: it opens once and stays open.
//
// Two modes:
//   always-on (wake word enabled): every chunk goes to main, where the wake-word spotter checks it
//     locally. Main, not this file, decides what (if anything) reaches Gemini.
//   push-to-talk only: chunks are passed on only while the button is held; the rest are dropped
//     right here, and the mic is closed when not needed (so the OS mic indicator goes off).

// `?worker&url`: Vite compiles the worklet file on its own and gives us its URL to load.
import micWorkletUrl from './mic-worklet.ts?worker&url'
import { rmsLevel } from './mouth'

const SAMPLE_RATE = 16_000 // what Gemini wants from the mic

export class Ear {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private starting: Promise<void> | null = null
  private listening = false
  private alwaysOn = false
  private analyser: AnalyserNode | null = null
  private readonly wave = new Float32Array(512)

  constructor(private readonly onChunk: (pcm: Uint8Array) => void) {}

  // Safe to call many times: the first call opens the mic, later calls reuse it. Two quick
  // presses would otherwise open the mic twice.
  open(): Promise<void> {
    this.starting ??= this.openMic()
    return this.starting
  }

  private async openMic(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true, // so it doesn't hear its own voice from the speakers
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    // A context at 16 kHz: Chromium converts the mic's native rate (usually 48 kHz) for us.
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    await this.ctx.audioWorklet.addModule(micWorkletUrl)

    const source = this.ctx.createMediaStreamSource(this.stream)
    const worklet = new AudioWorkletNode(this.ctx, 'mic-processor')
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.alwaysOn || this.listening) this.onChunk(new Uint8Array(event.data))
    }
    source.connect(worklet)
    // Side branch for measuring loudness (the edge glow pulses with your voice while listening).
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512
    source.connect(this.analyser)
  }

  // Press → startListening, release → stopListening. If the user releases BEFORE the mic finishes
  // opening, the late `await` must not switch listening back on. So record what the user wants
  // now, and apply it after the await.
  private wanted = false

  async startListening(): Promise<void> {
    this.wanted = true
    await this.open()
    this.listening = this.wanted
  }

  stopListening(): void {
    this.wanted = false
    this.listening = false
    if (!this.alwaysOn) this.close()
  }

  // Wake word on → keep the mic open and streaming to main. Off → mic only while the button is held.
  setAlwaysOn(on: boolean): Promise<void> {
    this.alwaysOn = on
    if (on) return this.open()
    if (!this.listening) this.close()
    return Promise.resolve()
  }

  // Mic loudness right now, 0..1 (0 if the mic isn't open).
  level(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.wave)
    return rmsLevel(this.wave)
  }

  close(): void {
    if (!this.ctx && !this.stream) return
    this.listening = false
    this.stream?.getTracks().forEach((track) => track.stop()) // turns the OS mic indicator off
    void this.ctx?.close()
    this.stream = null
    this.ctx = null
    this.analyser = null
    this.starting = null
  }
}
