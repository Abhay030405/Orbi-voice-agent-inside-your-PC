# Dreamwalker roadmap: every PS feature, then everything beyond

How we work from here (agreed 2026-10-19): **Claude builds and tests every phase itself**
(automated tests over CDP, fake mic, real Gemini). At the end of each **milestone**, Abhay checks it
by hand and studies that milestone as one chunk, using its `docs/` doc. Claude starts the next
milestone while Abhay studies the previous one, but never more than one milestone ahead.

Status key: ✅ done · 🟡 partial · ⬜ not started

## What the problem statement asks for

### Basic
| # | Requirement (PS wording, simplified) | Status | Milestone |
|---|---|---|---|
| B1 | Wake word → live voice conversation via Gemini Live; always show idle / listening / thinking / speaking | ✅ wake word (any name, offline), live voice, all 4 states | M1 |
| B2 | Interrupt → stop speaking immediately, discard queued audio, **no stale echoes** | ✅ instant local stop + stale audio dropped until the old turn closes (unit-tested) | M1 |
| B3 | **10+ tools** via function calling (files, apps, windows, volume, clipboard, web search, shell with timeout), each with a strict permission level | ✅ 25 tools, each with a risk level + effect; per-tool allow/ask/deny | M2 |
| B4 | Risky actions confirmed first; every action in a persistent ledger; **undo by voice, even after a restart**; irreversible actions flagged before they run | ✅ native dialog + spoken yes/no, SQLite ledger, undo_last_action, "can't be undone" warning | M2 |
| B5 | Screenshot on request; AI reasons about what's on screen | ✅ take_screenshot (image in the tool answer) + web_search; both switch on caution mode | M2 |
| B6 | Connection drops/renews → conversation continues, no gap, no repeated replies, running tasks finish correctly | ✅ resumption + outbox + continue-nudge; 4 chaos cases pass on real Gemini | M1 |

### Advanced
| # | Requirement | Status | Milestone |
|---|---|---|---|
| A1 | Network drops mid-tool-call → every action happens **exactly once** | ✅ idempotency key (request + tool + args) in a UNIQUE column; chaos-tested | M3 |
| A2 | Long tasks run in background; progress reports; cancel/redirect by voice; several at once | ✅ start/list/cancel tasks, own process each, announced when done | M3 |
| A3 | After each action, check the **real** outcome; report failures truthfully, recover or ask | ✅ every changing tool checks the real result (files, volume, clipboard, focus, apps, tasks) | M3 |
| A4 | Control the Android phone over USB/Wi-Fi: apps, tap/swipe/type, calls, SMS, notifications, screenshots, files, settings; same confirmation rules | ✅ adb over Wi-Fi/USB, auto-discovery, 15 tools (apps, Play Store, screenshot, tap/swipe/type, keys, call, prepared texts, notifications, files both ways, Do Not Disturb), same rules; tested on a Motorola Signature (Android 16) | M4 |
| A5 | Teach a multi-step routine by voice, name it, run it later; saved across restarts, editable | ⬜ | M6 |
| A6 | Light watch on the screen; speaks up on real anomalies (errors, unsaved work); judged on misses AND false alarms | ⬜ | M5 |

### Bonus
| # | Requirement | Status | Milestone |
|---|---|---|---|
| C1 | Operate apps it has never seen by **looking at the screen** and using mouse/keyboard/touch; every step verified; no app-specific code | 🟡 PC: UI Automation (buttons by name) + screenshots + mouse/keyboard; phone: screenshot + tap. Gemini did 12 × 7 in Calculator by itself (14 s, 1 question). Next: a verify-after-each-step loop, harder apps | M5 |
| C2 | Prompt injection in documents/pages/messages never triggers an unconfirmed action or a data leak | 🟡 caution mode after outside content, native dialog, tools not on the bridge; injection test suite in M5 | M2 + M5 |
| C3 | Passwords/keys on screen, in files, or on the phone are detected and hidden **locally** before anything goes to Gemini | ⬜ | M5 |

## Beyond the PS (Abhay's list)
| Feature | Where |
|---|---|
| Siri-style glowing screen edges while listening/speaking | ✅ M1 (pulses with voice, hidden from capture; visual polish in UI round 2) |
| Compact floating widget (always on top) + system tray | ✅ UI round 1: the Claude Design face (11 states, 8 tool morphs), click-through, drag + snap, tooltip, mute in tray |
| Claude-Code-style permission settings: allow-list, "always ask", per-tool levels | ✅ M2 logic + UI round 1 Permissions tab |
| Open/create/edit files, open terminals, run scripts | ✅ M2 (fenced to your folders; commands always confirmed) |
| Interact with YouTube etc.: click, play, read what's on screen | M5 (via C1) |

## Milestones

**M1: Solid voice core.** Wake word · state machine with turn numbers (kills stale echoes) ·
reconnect + session resumption (B6) · Siri edge glow · widget + tray.
*Needs from Abhay: Picovoice AccessKey (in a local `.env`), plus choosing the wake word.*

**M2: Hands + safety.** Gatekeeper (risk levels, native OS confirm dialog, allow-list settings,
taint after untrusted content) · Ledger (SQLite, write-ahead) · undo by voice after restart ·
10+ tools: files, apps, windows, volume, clipboard, web search, shell with timeout, screenshot.
*Order inside M2: Gatekeeper and Ledger BEFORE any dangerous tool exists.*

**M3: Can't break it.** Exactly-once (idempotency key = user turn + tool + args) ·
verify real outcomes · background tasks with progress + cancel. Plus a "chaos" test script that
kills the network mid-tool-call.

**UI round 1 ✅ (2026-10-19, moved up at Abhay's request)**: companion face, Home console (status,
timeline, Now rail, command bar), Ledger/Tasks/Permissions/Settings/Diagnostics tabs, Graphite + Ember
themes, mute (`docs/build-log/09-ui.md`).
**UI round 2, part 1 ✅ (design v2)**: Home as the first screen, 6 sections + sub-tabs, Ctrl K, "needs you"
Home, Privacy page; plus memory across days (`docs/build-log/10-home-memory.md`).
**UI round 2, still to do**: edge glow v2 (Siri-style, WIP patch in docs/design), Quick Panel, onboarding
(agent name, your name, voice picker with preview), tray visuals.

**M4: The phone.** adb over USB and Wi-Fi: apps, input, calls, SMS, notifications, screenshots,
files, settings. *Needs from Abhay: Android phone with USB debugging on.*

**M5: Eyes.** Screen watcher (A6) · look-and-click computer use (C1) · local secret masking (C3)
· prompt-injection test suite (C2).

**M6: Polish.** Routines (A5) · README
(setup, platforms, limitations, every library and AI tool disclosed) · installers for
Windows/macOS/Linux (cross-platform bonus) · demo script.

**M7 (stretch, Abhay's idea 2026-10-19): Remote Dreamwalker, AI-assisted remote access from your phone.**
Not screen streaming (TeamViewer/AnyDesk/Chrome Remote Desktop do that: you drive Windows with your thumb).
You *ask*, from your phone, and the home PC does it, under the same safety rules. Same direction as
Anthropic's Claude Dispatch and Claude Code Remote Control, built into our own agent.
- *Use cases:* check on long jobs (build/render/download) and get pinged when done (A2 tasks) · approve a
  risky step from the phone instead of it timing out at an empty desk · "send me that PDF" straight to the
  phone · "screenshot the render window" (single-window capture) · "stop the Steam download / lock my PC /
  shut down after the upload" · "open my project and start the dev server, I'm 10 minutes away".
- *Scope (minimal, ~2–3 days):* a small relay (the PC is behind the home router, the phone can't reach it
  directly) · phone pairing by QR code with a per-device key · a phone web page (PWA): text chat, live
  status, task-done notifications, confirmations · a "remote off" switch on the PC.
- *Safety (the point of the demo):* every remote request runs with caution mode ON (every change asks, on the
  phone) · nothing high-risk without a phone confirmation that can't be faked (signed with the device key)
  · exactly-once + reconnect matter even more on mobile networks (A1/B6) · Ledger source `remote`, undoable.
- *Order:* after M4 (the phone is already paired by then) and M5/M6. Cut if PS requirements aren't done.
