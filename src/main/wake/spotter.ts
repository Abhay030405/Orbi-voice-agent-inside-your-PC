// WAKE WORD: listens to every mic chunk while idle and says "yes" when it hears the wake phrase.
// Runs 100% on this computer (sherpa-onnx, an open-source speech toolkit). Nothing is sent anywhere
// until it fires. Cost: ~2% of one CPU core (measured: 2.3 s of audio checked in 49 ms).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { KeywordSpotter, type OnlineStream } from 'sherpa-onnx-node'
import { answerLines, keywordLines, parseVocab, type Vocab } from './tokenizer'

const MODEL_FILES = {
  encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  tokens: 'tokens.txt',
  vocab: 'bpe.vocab'
}

// How sure the spotter must be before it fires (0..1). Lower = wakes more easily but also by
// mistake. 0.25 fired on the real phrase and ignored a near-miss sentence in our tests; tune with
// real hostel noise (docs/build-log/04-wake-word.md).
const THRESHOLD = 0.25
const BOOST = 1.0

export class WakeWord {
  private readonly vocab: Vocab
  private readonly modelDir: string
  private readonly workDir: string
  private spotter: KeywordSpotter | null = null
  private stream: OnlineStream | null = null

  // Throws if the model files are missing (fix: `npm run models`).
  constructor(modelDir: string, workDir: string) {
    this.modelDir = modelDir
    this.workDir = workDir
    this.vocab = parseVocab(readFileSync(join(modelDir, MODEL_FILES.vocab), 'utf8'))
  }

  // Can this phrase be a wake word at all? Used to validate the agent's name before saving it.
  canUse(phrase: string): boolean {
    return keywordLines(phrase, this.vocab) !== null
  }

  // Start listening for a new phrase. Rebuilding the spotter takes a moment, so only do it when the
  // phrase actually changes (app start, or the user renames the agent).
  setPhrase(phrase: string): void {
    const lines = keywordLines(phrase, this.vocab)
    if (!lines) throw new Error(`"${phrase}" can't be used as a wake word`)

    mkdirSync(this.workDir, { recursive: true })
    const keywordsFile = join(this.workDir, 'keywords.txt')
    writeFileSync(keywordsFile, `${lines.join('\n')}\n`)

    this.spotter = buildSpotter(this.modelDir, keywordsFile, THRESHOLD)
    this.stream = this.spotter.createStream()
  }

  // Feed one 20 ms chunk of 16 kHz Int16 PCM. Returns true if the wake phrase just ended.
  feed(pcm: Uint8Array): boolean {
    const spotter = this.spotter
    const stream = this.stream
    if (!spotter || !stream) return false

    stream.acceptWaveform({ samples: toFloat(pcm), sampleRate: 16000 })

    let heard = false
    while (spotter.isReady(stream)) {
      spotter.decode(stream)
      if (spotter.getResult(stream).keyword) {
        heard = true
        spotter.reset(stream)
      }
    }
    return heard
  }

  // Throw away buffered audio, so sound from before (e.g. the end of a conversation) can't combine
  // with new sound into a false wake-up.
  reset(): void {
    if (this.spotter) this.stream = this.spotter.createStream()
  }
}

function buildSpotter(modelDir: string, keywordsFile: string, threshold: number): KeywordSpotter {
  const model = (file: string): string => join(modelDir, file)
  return new KeywordSpotter({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: model(MODEL_FILES.encoder),
        decoder: model(MODEL_FILES.decoder),
        joiner: model(MODEL_FILES.joiner)
      },
      tokens: model(MODEL_FILES.tokens),
      numThreads: 1,
      provider: 'cpu',
      debug: 0
    },
    keywordsFile,
    keywordsThreshold: threshold,
    keywordsScore: BOOST
  })
}

// 16 kHz Int16 PCM → floats. Copy the bytes first, explicitly: the mic chunks arrive over Electron IPC as
// Node Buffers, and Buffer.slice() does NOT copy (it's a view into a shared pool), so `.slice().buffer`
// handed the model the whole pool instead of the 20 ms chunk (found 2026-10-31: speech detection saw
// no speech at all live, yet found it in the same audio saved to a file). The copy is also aligned,
// which Int16Array needs.
export function toFloat(pcm: Uint8Array): Float32Array {
  const even = pcm.byteLength - (pcm.byteLength % 2)
  const bytes = new Uint8Array(even)
  bytes.set(pcm.subarray(0, even))
  const int16 = new Int16Array(bytes.buffer)
  return Float32Array.from(int16, (s) => s / 32768)
}

// SPOKEN ANSWERS: "yes, go ahead" / "no, cancel it" to an open confirmation, recognised on this
// computer by the same small model as the wake word (word list: tokenizer.ts ANSWER_WORDS). It only
// runs while a question is open. Stricter than the wake word (0.35): "is that allowed" matched
// "allow" at 0.25. After the first match it listens DECIDE_CHUNKS more, and any "no" in that time
// wins: when in doubt, don't act.
const ANSWER_THRESHOLD = 0.35
const DECIDE_CHUNKS = 30 // 30 × 20 ms = 0.6 s

export class SpokenAnswers {
  private readonly spotter: KeywordSpotter
  private stream: OnlineStream
  private heard: 'yes' | 'no' | null = null
  private left = 0

  constructor(modelDir: string, workDir: string) {
    const vocab = parseVocab(readFileSync(join(modelDir, MODEL_FILES.vocab), 'utf8'))
    mkdirSync(workDir, { recursive: true })
    const keywordsFile = join(workDir, 'answers.txt')
    writeFileSync(keywordsFile, `${answerLines(vocab).join('\n')}\n`)
    this.spotter = buildSpotter(modelDir, keywordsFile, ANSWER_THRESHOLD)
    this.stream = this.spotter.createStream()
  }

  // A new question: forget everything heard before it.
  reset(): void {
    this.stream = this.spotter.createStream()
    this.heard = null
    this.left = 0
  }

  // Feed one 20 ms chunk. Returns the answer once it's decided, otherwise null.
  feed(pcm: Uint8Array): 'yes' | 'no' | null {
    this.stream.acceptWaveform({ samples: toFloat(pcm), sampleRate: 16000 })
    while (this.spotter.isReady(this.stream)) {
      this.spotter.decode(this.stream)
      const label = this.spotter.getResult(this.stream).keyword
      if (!label) continue
      this.spotter.reset(this.stream)
      const answer = label === 'NO' ? 'no' : 'yes'
      if (this.heard === null) this.left = DECIDE_CHUNKS
      if (this.heard !== 'no') this.heard = answer
    }
    if (this.heard === null || --this.left > 0) return null
    const decided = this.heard
    this.reset()
    return decided
  }
}
