// Turns a wake phrase the user typed ("Hey Jarvis") into the model's tokens ("▁HE Y ▁JAR VIS").
//
// Why we need this: the keyword spotter only accepts keywords that are ALREADY split into its
// tokens, and the native module can't do that split at runtime. So we do it, which is what lets
// the user name their agent anything without retraining a model.
//
// The model's vocabulary is a SentencePiece "unigram" model: each token has a log-probability
// score. The best split of a word is the one whose scores add up highest. We find it with dynamic
// programming (Viterbi), the same idea as shortest-path DP: best[i] = best score for the first i
// characters, built from smaller prefixes.
//
// Verified to match Python's official `sentencepiece` on 17 phrases (see docs/build-log/04-wake-word.md).

const WORD_START = '▁' // "▁": SentencePiece marks the start of each word with this character

export interface Vocab {
  scores: Map<string, number>
  maxPieceLength: number
}

// bpe.vocab format: one "piece<TAB>score" per line. Skip control pieces like <unk>.
export function parseVocab(text: string): Vocab {
  const scores = new Map<string, number>()
  let maxPieceLength = 1
  for (const line of text.split(/\r?\n/)) {
    const [piece, score] = line.split('\t')
    if (!piece || score === undefined || piece.startsWith('<')) continue
    scores.set(piece, Number(score))
    maxPieceLength = Math.max(maxPieceLength, piece.length)
  }
  return { scores, maxPieceLength }
}

// Wake phrases: 1–4 words of plain letters (apostrophes allowed, e.g. "Hey Jarv's" is silly but valid).
export function normalizePhrase(phrase: string): string | null {
  const words = phrase.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 4) return null
  if (!words.every((w) => /^[A-Z']+$/.test(w))) return null
  return words.join(' ')
}

export function tokenize(phrase: string, vocab: Vocab): string[] | null {
  const normalized = normalizePhrase(phrase)
  if (!normalized) return null

  const text = WORD_START + normalized.split(' ').join(WORD_START)
  const n = text.length

  // best[i]: highest total score for text[0..i). from[i]: where the last token of that split starts.
  const best = new Array<number>(n + 1).fill(-Infinity)
  const from = new Array<number>(n + 1).fill(-1)
  best[0] = 0

  for (let end = 1; end <= n; end++) {
    for (let start = Math.max(0, end - vocab.maxPieceLength); start < end; start++) {
      if (best[start] === -Infinity) continue
      const score = vocab.scores.get(text.slice(start, end))
      if (score === undefined) continue
      if (best[start] + score > best[end]) {
        best[end] = best[start] + score
        from[end] = start
      }
    }
  }
  if (best[n] === -Infinity) return null // some character has no token at all

  // Walk back from the end to recover the winning split.
  const pieces: string[] = []
  for (let end = n; end > 0; end = from[end]) pieces.push(text.slice(from[end], end))
  return pieces.reverse()
}

// A name is SPOKEN, not spelled. "Orbi" is said "or-bee", but its best split is ▁OR B I: single
// letter pieces, which the model only matched when the name was said like "or-bye" (measured with
// synthetic voices: "Hey Orbee" never fired on ▁OR B I, but fired every time on ▁OR ▁BE). So the
// name (the last word) also gets listened for as:
//   - two whole words, when both halves are words in the model's vocabulary: ▁OR ▁BE, ▁OR ▁BY
//   - other spellings of an "ee" ending (Orbi, Siri, Lexy, Jenny → I / Y / EE / E)
// Every line carries the same label, so any of them wakes it. Each extra line is one more way to wake
// by mistake, so there are at most MAX_LINES (near-miss sentences: docs/build-log/04-wake-word.md).
const MAX_LINES = 10
const EE_ENDING = /(IE|EE|EY|EA|I|Y)$/

// Also the name WITHOUT its ending: Abhay says "Orbi" as "or-b" (like "orb"), and "Hey Orbi" never woke
// it until he said "hey or bye" (2026-10-21). So "ORB" is listened for too.
function nameSpellings(word: string): string[] {
  const m = EE_ENDING.exec(word)
  if (!m || word.length - m[0].length < 2) return [word]
  const stem = word.slice(0, -m[0].length)
  return [...new Set([word, ...(stem.length >= 3 ? [stem] : []), ...['I', 'Y', 'EE', 'E'].map((ending) => stem + ending)])]
}

// "ORBE" → [▁OR, ▁BE], "ORB" → [▁OR, ▁B]: every way to cut a word into two whole-word pieces.
function wholeWordSplits(word: string, vocab: Vocab): string[][] {
  const splits: string[][] = []
  for (let k = 2; k <= word.length - 1; k++) {
    const left = WORD_START + word.slice(0, k)
    const right = WORD_START + word.slice(k)
    if (vocab.scores.has(left) && vocab.scores.has(right)) splits.push([left, right])
  }
  return splits
}

// The spotter's keywords file for one phrase: "▁HE Y ▁OR B I @HEY_ORBI", "▁HE Y ▁OR ▁BE @HEY_ORBI", …
// The part after @ is the label the spotter reports when it fires. The exact spelling comes first.
export function keywordLines(phrase: string, vocab: Vocab): string[] | null {
  const normalized = normalizePhrase(phrase)
  const exact = normalized ? tokenize(normalized, vocab) : null
  if (!normalized || !exact) return null

  const words = normalized.split(' ')
  const name = words[words.length - 1]
  const lead = words.length > 1 ? (tokenize(words.slice(0, -1).join(' '), vocab) ?? []) : []
  const spellings = nameSpellings(name)
  const variants = [
    ...spellings.flatMap((s) => wholeWordSplits(s, vocab)), // closest to how names are said
    ...spellings.map((s) => tokenize(s, vocab)).filter((t): t is string[] => t !== null)
  ]
  const lines = new Set([exact.join(' '), ...variants.map((v) => [...lead, ...v].join(' '))])
  const label = `@${normalized.replace(/ /g, '_')}`
  return [...lines].slice(0, MAX_LINES).map((line) => `${line} ${label}`)
}

// Spoken answers to a confirmation, recognised ON THIS COMPUTER (spotter.ts SpokenAnswers). Gemini
// sends no transcript while one of its actions is waiting for the user, so "yes" said aloud never
// reached us (found 2026-10-20). Measured on synthetic speech: phrases work ("yes, go ahead", "no,
// cancel it"); a lone "yes" or "no" is too short for this small model and is often missed. "Do it" is
// left out on purpose: it matched inside "don't do it" (heard as YES!). "No" wins over "yes" (spotter.ts).
export const ANSWER_WORDS = {
  YES: ['yes', 'yes go ahead', 'go ahead', 'yeah', 'allow it', 'haan'],
  NO: ['no', 'nope', 'no thanks', 'cancel', 'cancel it', 'deny', 'stop', 'dont', 'nahi', 'mat karo']
} as const

// Keywords-file lines: "▁YES ▁GO ▁A HE AD @YES" ... The label after @ is what the spotter reports.
export function answerLines(vocab: Vocab): string[] {
  const lines: string[] = []
  for (const [label, words] of Object.entries(ANSWER_WORDS)) {
    for (const phrase of words) {
      const pieces = tokenize(phrase, vocab)
      if (pieces) lines.push(`${pieces.join(' ')} @${label}`)
    }
  }
  return lines
}
