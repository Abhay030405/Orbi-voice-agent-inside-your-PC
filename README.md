# Dreamwalker

A desktop voice assistant for Softablitz 2026 (problem statement: **Be the Dreamwalker**). You say its
name ("Hey Orbi"), talk to it, and it works your Windows PC and your Android phone for you: files, apps,
windows, volume, the browser, YouTube, Word and PowerPoint, Gmail and Calendar, calls and texts. It is
built on the Gemini Live API and is designed to stay correct when things go wrong: dropped connections,
retries, misheard words and instructions hidden in web pages or emails.

**Built by:** Abhay Agarwal.

## What it does

| PS item | What Dreamwalker does |
|---|---|
| B1 Wake word + live voice | Offline wake word for any agent name (sherpa-onnx), live voice through Gemini Live, idle / listening / thinking / speaking always shown |
| B2 Interrupts | Talking over it stops the audio at once; old audio is dropped so it never answers a stale question |
| B3 Tools | 70+ tools (files, apps, windows, volume, clipboard, shell, web search, documents, YouTube, weather, phone, Google), each with a risk level and per-tool allow / ask / deny |
| B4 Confirmations, ledger, undo | Risky actions ask first (window + spoken yes/no); every action goes in a SQLite ledger; "undo that" works even after a restart; irreversible actions say so before they run |
| B5 Screen | Screenshots on request, and Gemini reasons about what it sees |
| B6 Reconnects | Session resumption + an outbox, so a dropped connection loses nothing and repeats nothing |
| A1 Exactly once | Each tool call gets an idempotency key; a retry after a drop never runs an action twice |
| A2 Background tasks | Long jobs (documents, research) run in their own process; ask about them, cancel them, run several |
| A3 Real outcomes | After acting, it checks what really happened (file there? volume changed? window focused?) and says so honestly |
| A4 Android phone | adb over USB or Wi-Fi: apps, tap / swipe / type, calls, texts, notifications, files, screenshots, same confirmation rules |
| A5 Routines | Taught by voice ("when I say back home, open Docker, open VS Code and set the volume to 30"), run by name from the laptop or the phone; each step is a normal, checked action; save and delete can be undone |
| A6 Screen watch | "Tell me when the download finishes": a background task looks at the screen every 10 s (Gemini Flash, yes/no) for up to an hour and announces it when seen, on the laptop and the phone. Asks first (the screen goes to Google); cancel like any task |
| Phone remote | Control the laptop from your phone, from anywhere: an installable web app talks to the laptop through our always-on relay. Type or say a command, get files sent to the phone, send files to the laptop, answer its questions there, stop it |
| C1 Unknown apps | Windows UI Automation + screenshots + mouse and keyboard (PC), screenshot + tap (phone). Partial |
| C2 Prompt injection | Outside content (web, email, files) switches on caution mode: every action needs a confirmation. Partial |
| C3 Hiding secrets | API keys, tokens, private keys, passwords in config files and in links are replaced with "[hidden …]" on this computer before outside content (files, clipboard, web, email, screen text) reaches Gemini or the Ledger. Not in screenshots. Partial |


## Phone remote

Open Orbi → **Phone** → **Show pairing QR code**, scan it with the phone, then "Add to Home Screen". From then on,
from anywhere: "open Docker", "send me the DBMS assignment", "send me a screenshot", "lock my laptop", or attach
a file to put it in the laptop's Downloads. Names may be rough: apps, windows and files are matched fuzzily.

- **How it connects:** the laptop dials out to a small relay (`relay/server.ts`) on an always-on Google Cloud
  VM (e2-micro, HTTPS by Caddy), and the phone opens the relay's page. Nothing at home needs an open port.
  `node relay/deploy.mjs` ships a new relay; `relay/vm-startup.sh` sets the VM up.
- **Pairing code:** made once, kept in the app's user-data folder (`remote.json`), never logged. The relay keeps no
  accounts: a laptop and its phones meet in a room named by the code's SHA-256, everything in memory.
- **Same rules as the voice:** a phone command is a normal request (Gatekeeper, Ledger, undo). Risky actions ask
  on the phone and on the laptop at once; the first answer wins and closes the other. No answer in 60 s = no.
- **Without the relay:** `DW_RELAY=off`; the app still serves the same page on `http://localhost:8787` for your
  own tunnel (`cloudflared tunnel --url http://localhost:8787`). `DW_PORT=0` turns that off too.
- **Laptop must be awake:** keep it plugged in with sleep off; a sleeping laptop shows "laptop offline".

## Run it (Windows)

You need Node.js 24+, the Google Cloud CLI, and access to a Google Cloud project with Vertex AI enabled.

```bash
npm install
npm run models                      # once: wake-word model (5 MB)
npm run tools                       # once, for the phone: Google's adb (platform-tools)
gcloud auth application-default login
npm run dev
```

There is no API key anywhere: Gemini is reached with your own gcloud login (Application Default
Credentials). By default it uses project `dreamwalker-softablitz` in `us-central1`; to use your own project,
set `DREAMWALKER_GCP_PROJECT` (and `DREAMWALKER_GCP_LOCATION`) before `npm run dev`.

- **Gmail, Calendar, Drive:** one-time setup in [docs/google-setup.md](docs/google-setup.md).
- **Phone:** turn on USB debugging, plug it in (or pair over Wi-Fi), and say "connect my phone".

Other commands: `npm test` (unit tests), `npm run typecheck`, `npm run build`.

## How it is built

Electron app in TypeScript. The main process holds everything that can act; the windows (React) only show
state and send audio. Tools are never exposed to the windows.

| Part | Folder | Job |
|---|---|---|
| Ear, Mouth | `src/renderer/audio/` | Mic at 16 kHz to Gemini, Gemini's voice to the speakers |
| Wake | `src/main/wake/` | Offline wake word and the noise gate |
| Link | `src/main/link/` | The Gemini Live connection, resumption and the outbox |
| Brain | `src/main/brain/` | The conversation state machine |
| Gatekeeper | `src/main/gatekeeper/` | Risk policy, caution mode, confirmations |
| Ledger | `src/main/ledger/` | SQLite record of every action, idempotency keys, undo |
| Hands | `src/main/hands/`, `src/main/phone/`, `src/main/google/` | The tools |
| Tasks, agents | `src/main/tasks/`, `src/main/agent/` | Background jobs, the document and research agents |
| UI | `src/renderer/` | Home console, companion face, confirmation window, edge glow |

The docs in [`docs/`](docs/README.md) explain each part, the design decisions and the tests.

## Libraries, APIs and AI tools (disclosure)

### Runtime libraries and APIs
| Library / API | Version | License | What for |
|---|---|---|---|
| `@google/genai` | 2.30.0 | Apache-2.0 | Gemini Live API (voice) and the search / document calls |
| `sherpa-onnx-node` | 1.13.8 | Apache-2.0 | On-device wake word and spoken yes/no answers to confirmations |
| sherpa-onnx KWS model (zipformer, gigaspeech 3.3M int8) | kws-models release | Apache-2.0 | The wake-word model, downloaded by `npm run models` |
| `docx` | 9.13.0 | MIT | Writes Word documents |
| `pptxgenjs` | 4.0.1 | MIT | Writes PowerPoint decks |
| `react`, `react-dom` | 19.x | MIT | UI |
| `voice-glow` | 0.3.0 | MIT | The glow along the command bar, driven by our own voice levels |
| `fuzzball` | 2.2.6 | MIT | Fuzzy name matching (port of Python's thefuzz): apps, windows, `find_files`. Brings `lodash`, `heap`, `setimmediate` (MIT) |
| `qrcode-generator` | 2.0.4 | MIT | The pairing QR code on the Phone page |
| `thinking-orbs` | 0.3.2 | MIT | The "working" indicator on background tasks |
| `@fontsource-variable/geist`, `geist-mono` | 5.3.0 | OFL-1.1 | Fonts, bundled locally |
| Android platform-tools (adb) | latest | Android SDK license | Phone control, downloaded by `npm run tools` |
| Open-Meteo API | web API | CC BY 4.0, no key | Weather |
| Gmail, Calendar and Drive APIs | REST | Google APIs Terms | The user's own mail, calendar and Drive, after they sign in |

### The relay (runs on our VM, not in the app)
| Software / service | License | What for |
|---|---|---|
| Google Compute Engine (e2-micro, us-central1) | Google Cloud Terms | The always-on VM |
| Node.js 24 | MIT | Runs `relay/server.ts` (no npm packages) |
| Caddy | Apache-2.0 | HTTPS in front of the relay; gets the certificate by itself (Let's Encrypt / ZeroSSL) |
| sslip.io | free DNS service | A hostname for the VM's IP, needed for the certificate |

Build tools (not shipped): Electron, electron-vite, Vite, `@vitejs/plugin-react`, TypeScript, `@types/*`.

### AI tools
| Tool | How it was used |
|---|---|
| Claude Code (Claude Opus) | AI coding assistant used throughout development: code, tests and docs |
| Claude Design | Designed the companion face and the Home screen; the face renderer is a TypeScript port of its reference code (`docs/design/`) |
| Gemini Live (`gemini-3.8-live`), Gemini Flash | The assistant's brain at runtime: that is the product, as the PS asks |
