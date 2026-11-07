# Dreamwalker docs

Everything you need to understand, explain and defend Dreamwalker. Start at the top, go down.

```
docs/
├─ README.md            ← you are here: map + reading order
├─ ROADMAP.md           ← every PS requirement, its status, the milestones
├─ guide/               ← CONCEPTS. Read in order, before the code.
├─ build-log/           ← WHAT WAS BUILT, in the order it was built: design, measurements, bugs, tests
├─ research/            ← measurements that drove decisions
├─ exercises/           ← your answers + reviews
└─ design/              ← the design brief for the UI
```

## Reading order

### 1. Concepts (`guide/`), ~1 hour
| # | File | You'll learn |
|---|---|---|
| 1 | [guide/01-start-here.md](guide/01-start-here.md) | How we work, the phase plan |
| 2 | [guide/02-electron.md](guide/02-electron.md) | Processes, IPC, main vs renderer, why the split is a security feature |
| 3 | [guide/03-architecture.md](guide/03-architecture.md) | The 8 parts (Ear, Mouth, Face, Link, Brain, Gatekeeper, Hands, Ledger) and the design decisions |
| 4 | [guide/04-one-voice-turn.md](guide/04-one-voice-turn.md) | One conversation traced through every part; interrupts; exactly-once |

### 2. What was built (`build-log/`), in order
| # | File | Built | Key ideas |
|---|---|---|---|
| 1 | [build-log/01-phase0-skeleton.md](build-log/01-phase0-skeleton.md) | Electron + React skeleton, secure bridge | Two tsconfigs, IPC recipe, least privilege |
| 2 | [build-log/02-speak.md](build-log/02-speak.md) | Gemini speaks through the speakers | Samples, PCM, jitter, gapless scheduling, a race condition |
| 3 | [build-log/03-tools.md](build-log/03-tools.md) | The tool loop: it becomes an agent | Function calling, tool shape, failure as a result |
| 4 | [build-log/04-wake-word.md](build-log/04-wake-word.md) | Offline wake word, any agent name, the Brain | Viterbi tokenizer, pre-roll, state machine, unit tests |
| 5 | [build-log/05-reconnect.md](build-log/05-reconnect.md) | Surviving connection drops (PS B6) | Session resumption, outbox, chaos testing |
| 6 | [build-log/06-edge-glow.md](build-log/06-edge-glow.md) | Edge glow, tray, companion orb, single instance | Click-through windows, capture exclusion, RMS, close-to-tray, sender checks |
| 7 | [build-log/07-gatekeeper-ledger-tools.md](build-log/07-gatekeeper-ledger-tools.md) | Gatekeeper, Ledger (SQLite), confirmations, 26 tools, screenshots, documents | Injection-safe processes, WAL, caution mode, upload effect, the file fence |
| 8 | [build-log/08-exactly-once-verify-tasks.md](build-log/08-exactly-once-verify-tasks.md) | Exactly-once, verified outcomes, background tasks | Idempotency keys, chaos testing, streaming processes |
| 12 | [build-log/12-pc-control.md](build-log/12-pc-control.md) | Controlling the PC: UI Automation, clicks, typing | Accessibility trees, DPI, long-running helpers |
| 11 | [build-log/11-phone.md](build-log/11-phone.md) | The phone over adb | Shell quoting, discovery, verify, retry rule |
| 10 | [build-log/10-home-memory.md](build-log/10-home-memory.md) | Home (design v2), sections, Ctrl K, memory across days | Honest UI data, trusted confirmations, background summaries |
| 9 | [build-log/09-ui.md](build-log/09-ui.md) | The new UI: companion face, Home console, themes | Derived state in one place, upserts, click-through windows, canvas DPR, supply-chain checks |

### 3. Supporting material
| File | What |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Status of every PS item (B1–B6, A1–A6, C1–C3) + extras |
| [research/latency-probe.md](research/latency-probe.md) | Which Gemini region/model, measured speeds |
| [exercises/your-answers.md](exercises/your-answers.md) | Your answers to the early questions |
| [exercises/review-01.md](exercises/review-01.md) | Corrections, viva-ready versions |
| [design/claude-design-brief.md](design/claude-design-brief.md) | The brief given to Claude Design for the UI |

## How to study a build-log entry
Each one ends with **Break it on purpose** experiments and **Questions**. For each entry:
1. Read it, then open the files it lists and find each idea in the code.
2. Do at least two of the break-it experiments and predict the result before running.
3. Answer the questions out loud, as if in the viva. If one stumps you, that's what to re-read.

## Commands you'll need
```bash
npm run models     # once: download the wake-word model (5 MB)
npm run dev        # run the app (main/preload changes restart it, renderer hot-reloads)
npm test           # unit tests: Brain, tokenizer, outbox, process runner, ledger, gatekeeper (~3 s)
npm run typecheck  # TypeScript, both worlds
DREAMWALKER_DEBUG=1 DREAMWALKER_TRACE=1 npm run dev   # test hooks + log every Gemini message
```
