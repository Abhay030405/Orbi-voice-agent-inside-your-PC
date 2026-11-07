// SPEECH DETECTION (VAD): "is someone talking in this audio?", on this computer, with Silero VAD (a
// ~0.6 MB model, MIT) run by sherpa-onnx (already here for the wake word). Used only while Orbi
// speaks, to notice the user talking over it (wake/bargein.ts decides when that counts). Nothing it
// hears is sent anywhere by it. Cost: well under 1% of a CPU core.

import { Vad } from 'sherpa-onnx-node'
import { toFloat } from './spotter'

const WINDOW = 512 // samples per model step at 16 kHz (32 ms), what Silero expects

export class SpeechDetector {
  private readonly vad: Vad

  // Throws if the model file is missing (fix: `npm run models`).
  constructor(modelFile: string) {
    this.vad = new Vad(
      {
        sileroVad: {
          model: modelFile,
          threshold: 0.6, // stricter than the 0.5 default: leftover echo must not count
          minSpeechDuration: 0.1,
          minSilenceDuration: 0.2,
          windowSize: WINDOW,
          maxSpeechDuration: 20
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0
      },
      5 // seconds of audio it may buffer
    )
  }

  // Feed one 20 ms chunk of 16 kHz Int16 PCM. Returns whether the user is talking right now.
  feed(pcm: Uint8Array): boolean {
    this.vad.acceptWaveform(toFloat(pcm))
    const speaking = this.vad.isDetected()
    // We only want the live verdict, not the cut-out speech segments: drop them so memory stays flat.
    while (!this.vad.isEmpty()) this.vad.pop()
    return speaking
  }

  // Forget what it heard (a new reply starts).
  reset(): void {
    this.vad.reset()
  }
}
