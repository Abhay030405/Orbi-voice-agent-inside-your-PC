# Libraries and AI tools (running list for the README)

The event rule: every library and AI tool must be disclosed. This list is kept up to date as we go;
the final README copies it.

## Runtime libraries (shipped in the app)
| Library | Version | License | What for |
|---|---|---|---|
| `@google/genai` | 2.30.0 | Apache-2.0 | Gemini Live API (voice) and the search/document calls |
| `sherpa-onnx-node` | 1.13.8 | Apache-2.0 | On-device wake word, and spoken "yes, go ahead" / "no, cancel" answers to confirmations (keyword spotting) |
| `docx` | 9.13.0 | MIT | Writes Word documents (`create_document`) |
| `pptxgenjs` | 4.0.1 | MIT | Writes PowerPoint decks (`create_document`) |
| Open-Meteo API (open-meteo.com) | web API | CC BY 4.0 data, free, no key | Weather and place search (`get_weather`) |
| Google Gmail, Calendar and Drive APIs | REST APIs | Google APIs Terms | The user's own mail, calendar and Drive file names, after they sign in (`gmail_*`, `calendar_*`, `drive_search`) |
| sherpa-onnx KWS model (zipformer, gigaspeech 3.3M int8) | kws-models release | Apache-2.0 | The wake-word model, downloaded by `npm run models` |
| `react`, `react-dom` | 19.x | MIT | UI |
| `voice-glow` | 0.3.0 | MIT | The glow along the command bar's bottom edge, driven by our own voice levels (it never opens the mic) |
| `thinking-orbs` | 0.3.2 | MIT | The small dotted "working" indicator on running background tasks |
| `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | 5.3.0 | OFL-1.1 | Geist and Geist Mono fonts, bundled locally |
| `fuzzball` | 2.2.6 | MIT | Fuzzy name matching (JS port of Python's thefuzz) for apps, windows and `find_files`; its dependencies `lodash`, `heap`, `setimmediate` are MIT |
| `qrcode-generator` | 2.0.4 | MIT | The phone remote's pairing QR code (Phone page); no dependencies |

## The phone remote's relay (our VM, not shipped in the app)
Google Compute Engine (e2-micro), Node.js 24 (MIT, no npm packages), Caddy (Apache-2.0) for HTTPS with Let's
Encrypt / ZeroSSL certificates, sslip.io (free DNS for the VM's IP). Code: `relay/`.

Before installing `voice-glow` and `thinking-orbs` (new packages, one maintainer each) we downloaded
their tarballs and checked them: no install scripts, no network calls, no `eval`, no dependencies.

## Build tools (not shipped)
Electron, electron-vite, Vite, `@vitejs/plugin-react`, TypeScript, `@types/*`.

## AI tools
| Tool | How it was used |
|---|---|
| Claude Code (Claude Opus) | Pair-programming: wrote and tested code with Abhay, wrote these docs |
| Claude Design | Designed the companion face (states, tool morphs) and the Home screen. Its handoff is in `docs/design/companion-handoff/`; the face renderer is a TypeScript port of its reference code |
| Gemini Live (`gemini-3.8-live`) and Gemini Flash | The assistant's brain at runtime (that's the product, per the PS) |
