// The tokenizer must split phrases EXACTLY like the official SentencePiece library, or the spotter
// listens for the wrong sounds. Expected values come from Python's `sentencepiece` on the same model.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { keywordLines, normalizePhrase, parseVocab, tokenize } from './tokenizer.ts'

const vocab = parseVocab(
  readFileSync(join(import.meta.dirname, '../../../resources/models/kws/bpe.vocab'), 'utf8')
)
const W = '▁' // ▁

describe('tokenize (matches Python sentencepiece)', () => {
  const cases: Record<string, string[]> = {
    'hey dreamwalker': [`${W}HE`, 'Y', `${W}DR`, 'E', 'A', 'M', 'W', 'AL', 'K', 'ER'],
    'Hey Jarvis': [`${W}HE`, 'Y', `${W}JA`, 'R', 'VI', 'S'],
    'hey siri': [`${W}HE`, 'Y', `${W}S`, 'I', 'RI']
  }
  for (const [phrase, expected] of Object.entries(cases)) {
    it(phrase, () => assert.deepEqual(tokenize(phrase, vocab), expected))
  }

  it('builds the spotter line with a label', () => {
    assert.deepEqual(keywordLines('hey jarvis', vocab), [`${W}HE Y ${W}JA R VI S @HEY_JARVIS`])
  })
})

describe('keywordLines (names are spoken, not spelled)', () => {
  const lines = keywordLines('Hey Orbi', vocab) ?? []
  it('keeps the exact spelling first', () => assert.equal(lines[0], `${W}HE Y ${W}OR B I @HEY_ORBI`))
  it('adds the two-word ways it is said ("or bee", "or bye")', () => {
    assert.ok(lines.includes(`${W}HE Y ${W}OR ${W}BE @HEY_ORBI`))
    assert.ok(lines.includes(`${W}HE Y ${W}OR ${W}BY @HEY_ORBI`))
  })
  it('gives every line the same label, at most 10 lines', () => {
    assert.ok(lines.length > 1 && lines.length <= 10)
    assert.ok(lines.every((l) => l.endsWith(' @HEY_ORBI')))
  })
  it('leaves names without an "ee" ending alone', () => assert.equal(keywordLines('hey dreamwalker', vocab)?.length, 1))
  it('rejects what normalizePhrase rejects', () => assert.equal(keywordLines('hey r2d2', vocab), null))
})

describe('normalizePhrase (what users may type as a name)', () => {
  it('accepts letters, trims and uppercases', () => assert.equal(normalizePhrase('  hey   Nova '), 'HEY NOVA'))
  it('rejects digits and symbols', () => assert.equal(normalizePhrase('hey r2d2'), null))
  it('rejects empty', () => assert.equal(normalizePhrase('   '), null))
  it('rejects more than 4 words', () => assert.equal(normalizePhrase('a b c d e'), null))
})
