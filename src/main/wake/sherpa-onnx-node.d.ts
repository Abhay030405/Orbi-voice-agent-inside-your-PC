// sherpa-onnx-node ships no TypeScript types. These describe only the parts we use, taken from the
// package's own JSDoc (node_modules/sherpa-onnx-node/keyword-spotter.js and types.js).
declare module 'sherpa-onnx-node' {
  export interface OnlineStream {
    acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
  }

  export interface KeywordResult {
    keyword: string // the @label from the keywords file, or '' when nothing was spotted
  }

  // Voice activity detection (node_modules/sherpa-onnx-node/vad.js).
  export class Vad {
    constructor(config: Record<string, unknown>, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isDetected(): boolean
    isEmpty(): boolean
    pop(): void
    reset(): void
  }

  export class KeywordSpotter {
    constructor(config: Record<string, unknown>)
    createStream(): OnlineStream
    isReady(stream: OnlineStream): boolean
    decode(stream: OnlineStream): void
    reset(stream: OnlineStream): void
    getResult(stream: OnlineStream): KeywordResult
  }
}
