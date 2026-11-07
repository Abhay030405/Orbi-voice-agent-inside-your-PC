// Downloads the offline wake-word model (~17 MB download, ~5 MB kept) and the speech-detection model
// (~0.6 MB). Run once: npm run models
//
// Model: sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01 (k2-fsa/sherpa-onnx, Apache-2.0),
// trained on 10,000 h of English (GigaSpeech XL). We keep only the int8 (smaller, faster) files.
// bpe.vocab is NOT downloaded: it's committed in resources/models/kws/ (generated once from the
// model's bpe.model with Python sentencepiece; see docs/build-log/04-wake-word.md).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${NAME}.tar.bz2`
const KEEP = [
  'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'tokens.txt'
]
const target = join(import.meta.dirname, '..', 'resources', 'models', 'kws')

// Silero VAD (snakers4/silero-vad, MIT, ~0.6 MB), as repackaged by sherpa-onnx: notices the user talking
// over Orbi's reply, so it can stop (brain.ts, wake/vad.ts).
const VAD_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx'
const vadTarget = join(import.meta.dirname, '..', 'resources', 'models', 'vad')
if (existsSync(join(vadTarget, 'silero_vad.onnx'))) {
  console.log('Speech-detection model already present.')
} else {
  console.log('Downloading silero_vad.onnx…')
  const res = await fetch(VAD_URL)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  mkdirSync(vadTarget, { recursive: true })
  writeFileSync(join(vadTarget, 'silero_vad.onnx'), Buffer.from(await res.arrayBuffer()))
  console.log(`Speech-detection model ready in ${vadTarget}`)
}

if (KEEP.every((f) => existsSync(join(target, f)))) {
  console.log('Wake-word model already present.')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'dw-models-'))
try {
  console.log(`Downloading ${NAME}…`)
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const archive = join(work, 'kws.tar.bz2')
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()))

  // `tar` ships with Windows 10+, macOS and Linux, and all of them understand .bz2 (-j).
  // Relative paths + cwd on purpose: GNU tar (e.g. inside Git Bash) reads "C:\..." as a remote
  // host called "C" and fails, while Windows' own tar doesn't. A relative name works with both.
  const members = KEEP.map((f) => `${NAME}/${f}`)
  const tar = spawnSync('tar', ['-xjf', 'kws.tar.bz2', ...members], { cwd: work, stdio: 'inherit' })
  if (tar.status !== 0) throw new Error('Extracting the archive failed')

  mkdirSync(target, { recursive: true })
  for (const f of KEEP) renameSync(join(work, NAME, f), join(target, f))
  console.log(`Wake-word model ready in ${target}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
