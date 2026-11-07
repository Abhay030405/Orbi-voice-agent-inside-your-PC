# Build log 4 — M1 part 1: wake word, custom agent name, and the Brain

Say **"Hey Dreamwalker"** (or whatever you named it), hear a chime, ask, get an answer, ask a
follow-up without the wake word, and after 8 s of quiet it goes back to sleep.

## The pieces

| File | Job |
|---|---|
| `main/wake/spotter.ts` | Runs the keyword spotter (sherpa-onnx, offline) on every mic chunk while idle |
| `main/wake/tokenizer.ts` | Turns "Hey Jarvis" into model tokens `▁HE Y ▁JA R VI S` (that's what makes renaming work) |
| `main/brain/brain.ts` | **The state machine**: what state we're in, where mic audio goes |
| `main/settings.ts` | Agent name + toggles, saved as JSON with an atomic write |
| `renderer/audio/ear.ts` | Mic always open while the wake word is on (audio checked locally in main) |
| `scripts/fetch-models.mjs` | `npm run models`: downloads the 5 MB model once |

## 1. Why sherpa-onnx, not Picovoice

Picovoice needs an AccessKey **inside the app**, and anyone can unpack an Electron app (`app.asar`,
docs/exercises/review-01.md). sherpa-onnx needs no key, no account, works offline on Windows/macOS/Linux, and is
Apache-2.0. The trade-off: slightly lower accuracy, which we tune with the threshold.

## 2. How a typed name becomes a wake word

The spotter listens for **tokens**, not letters. The native module couldn't tokenize at runtime
(we tested: "Cannot find ID for token HEY"), so `tokenizer.ts` does it. The model's vocabulary
is a **SentencePiece unigram** model: every token has a log-probability score, and the best split of
a word is the one with the highest total score. Found with **dynamic programming (Viterbi)**:

```
best[i] = best total score for the first i characters
best[end] = max over start of  best[start] + score(text[start..end])
```

Same shape as shortest-path DP. Verified: 17/17 phrases match Python's official library.

## 3. Measured

| Test | Result |
|---|---|
| "Hey Dreamwalker, what time is it?" (real Gemini, fake mic) | Woke at 3.7 s → heard "What time is it?" → tool → spoken answer |
| "Last night I walked in a dream…" (near-miss) | **No wake-up** in 12 s |
| Rename to Jarvis → "Hey Jarvis, what time is it?" | Woke to the new name, even after a restart |
| "R2D2", "", "a b c" as names | Rejected with a clear message |
| CPU cost | 2.3 s of audio checked in 49 ms (~2% of one core) |

## 4. Two bugs found by testing (good viva stories)

**The cut-off first word.** "Hey Dreamwalker, what time is it?" reached Gemini as "time is it?".
The spotter confirms the phrase a moment *after* it ends, and by then the user is mid-request. Fix:
**pre-roll**, a rolling buffer of the last 0.5 s of mic audio sent along on wake. Alexa and Siri do the
same. It stays in RAM, gets overwritten constantly, and is only sent after the wake word.

**The crash in your dev session.** electron-vite reads `package.json` **once at startup** to decide
which packages to load from `node_modules` at runtime. Your dev server started before
`sherpa-onnx-node` was installed, so it *bundled* it, copied the `.node` file, and left its DLLs
behind. Lesson: **restart the dev server after adding a dependency.**

**"Hey Orbi" never woke it (2026-10-19).** The spelling split was right (`▁HE Y ▁OR B I`), but
`B I` are single-*letter* pieces, and the model only matched them when the name was said "or-bye".
People say "or-bee". A name is **spoken, not spelled**, so the keywords file now has several lines per
name, all under the same label: the exact spelling, two whole words when both halves are real words
(`▁OR ▁BE`, `▁OR ▁BY`), and other spellings of an "ee" ending (I / Y / EE / E). That's at most 8
lines, because each extra line is one more way to wake by mistake.

Measured with synthetic voices (Windows' built-in text-to-speech, two voices, two speeds):

| Clips | Exact spelling only | With the variants |
|---|---|---|
| "Hey Orbi" (said "or-bye"), 6 clips | 6 woke | 6 woke |
| "Hey Orbee" (how people say it), 4 clips | **0 woke** | **4 woke** |
| 12 near-miss sentences ("hey, or maybe…", "Hey Bobby", "orbit", "or by Friday"…), plus earlier noise, silence and speech clips | 1 false wake | the same 1 |

The one false wake is "He said hey, or bye", which really is the phrase. A slow "Hey… Orbi." with a
long pause between the words still misses with both.

## 5. The Brain (state machine)

Mic audio routing, decided in one place:

```
idle + wake word on   → spotter only (never leaves the computer)
push-to-talk held     → Gemini
conversation open     → Gemini (follow-ups without the wake word, 8 s window)
speaking, barge-in off → nowhere (so it can't hear itself)
```

It's **pure TypeScript** (no Electron), so `npm test` runs 18 scenarios in under a second with
fake hooks: push-to-talk, tool-turn `turnComplete`, **stale audio after an interrupt** (PS B2), wake
only while idle, giving up after silence, follow-up window, "thinking" after the user goes quiet,
pre-roll.

**Stale echoes (B2), solved properly:** when you interrupt while the old reply is *still streaming
in*, the Brain sets `staleTurnOpen`. Every chunk of that old reply is dropped until Gemini closes the
turn (`interrupted` or `turnComplete`). Then new audio plays again.

## 6. Atomic save (settings.ts)

Write `settings.json.tmp`, then rename it over `settings.json`. A rename on the same disk happens all
at once, so a crash mid-save leaves the old file or the new one, never half a JSON file. The Ledger
(M2) needs the same guarantee, from SQLite.

## Break it on purpose

1. Set `THRESHOLD` in `spotter.ts` to `0.05`, then `0.6`. Talk normally, play a YouTube video. What changes?
2. Set `preRollChunks: 0` in `main/index.ts`, say "Hey Dreamwalker, open YouTube" quickly. What does it hear?
3. In `brain.ts`, make `interruptReply()` empty. Run `npm test`. Which tests fail, and why?
4. Rename the agent to a short common word ("Hey Man"). How often does it wake by mistake?

## Questions
1. Why does the wake word run in main and not in the renderer, and what crosses IPC?
2. What exactly is in the pre-roll, and why is sending it not a privacy problem?
3. Why can the Brain be unit-tested without starting Electron? What design choice made that possible?
4. Walk through `staleTurnOpen` for: speaking → you press Space → 2 old chunks arrive → turnComplete → new chunk.
