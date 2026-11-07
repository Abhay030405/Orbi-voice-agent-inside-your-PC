# Design brief: Dreamwalker, a desktop voice agent

Paste everything below the line into Claude Design.

---

## What you're designing

**Dreamwalker** is a desktop AI agent you **talk to**. It lives on your screen as a small, always-present
companion, listens for a wake word, holds a live spoken conversation (Gemini Live), and **actually does
things**: opens apps and files, manages windows, runs scripts in a terminal, searches the web, reads what's
on your screen and clicks through apps it has never seen, and controls your Android phone (calls, texts,
taps, notifications, files) over USB or Wi-Fi.

Its defining trait is not that it's clever. It's **trustworthy under pressure**: it asks before risky actions,
logs everything, can undo by voice (even after a restart), never does an action twice when the network drops,
tells the truth when something fails, and can't be hijacked by malicious text hidden in documents or web pages.
The design must make that trust **visible**.

- Platform: desktop app (Electron + React). Windows 11 first, also macOS and Linux.
- Users: power users and developers who want hands-free control of their machine and phone.
- Name origin: "Dreamwalker" comes from a Doctor Strange-themed hackathon. Take a **subtle** cue from
  mystic geometry (rings, sigils, orbits, precise thin lines), but **no Marvel branding, characters or logos**.
  It should feel like a premium instrument, not a fan project.

## Design direction: please avoid "AI slop"

Do **not** use: purple-to-blue gradients everywhere, generic glassmorphism cards, sparkle ✨ icons for
"AI", emoji as UI icons, chat-app-with-a-sidebar layouts, stock "assistant" blob avatars, or neon cyberpunk.

Aim for: **a calm, precise instrument.** Think high-end audio gear, aircraft instruments, or a mission-control
console designed by a minimalist. Dark-first (with a light theme), one signature accent colour, restrained
motion where **every animation means something** (it reflects voice amplitude, agent state, or progress).
Dense where information matters (the activity log), spacious where emotion matters (the companion).
Typography-led hierarchy. Monospace only for machine data (tool arguments, paths, commands).

Give it a distinctive point of view. Show me 2–3 visual directions on the companion + home screen first,
then carry the strongest one through everything.

## The agent's states (every surface must express these)

| State | Meaning |
|---|---|
| Idle | Listening only for the wake word; nothing leaves the computer |
| Listening | Hearing the user (show live voice level) |
| Thinking | Waiting for the model |
| Acting | Running a tool: show WHICH tool (open app, run script, phone, files...) |
| Speaking | Talking (show its voice level) |
| Needs confirmation | A risky action is waiting for the human's yes/no |
| Background task running | Something long is running while the conversation continues (with progress) |
| Reconnecting | Connection to the model dropped; recovering silently (subtle, not alarming) |
| Offline / error | Can't reach the model, or something broke |
| Paused / private | User muted the mic or paused screen watching: must be unmistakable |
| Caution mode | The agent just read untrusted content (a web page, document, SMS); extra confirmations are on |

## Surfaces to design

### 1. The Companion (most important)
An always-on-screen presence, so the user never has to open a big window.
- Small (about 96–140 px), floats above all apps in a screen corner, draggable, snaps to edges, never steals
  keyboard focus, can be hidden. Separate transparent, frameless window.
- Expresses every state above through **form and motion**, not text: e.g. rings that breathe when idle,
  open up when listening, orbit when thinking, carry a small tool glyph when acting, pulse with the voice
  amplitude when speaking, and turn a distinct "attention" colour when it needs confirmation.
- Explore **3 concepts**: (a) an abstract living sigil/orb of rotating rings, (b) a minimal character with a
  face that has expressions, (c) your own idea. It must stay legible at 96 px and over any wallpaper (light or dark).
- Interactions: hover → a one-line tooltip with the last action ("Opened VS Code · 2 min ago"); click → opens
  the Quick Panel; right-click → menu (mute mic, pause watching, open full app, quit); drag to move.
- Provide an **animation spec**: per-state loops + transitions, amplitude-driven parameters. It should be
  buildable with CSS/Canvas/WebGL or Rive (a state-machine animation tool), at 60 fps with low GPU use.

### 2. Edge Glow (Siri-style screen edges)
A full-screen, click-through overlay that lights the **edges of the whole screen** while the agent is active.
- Colour/motion per state: listening, speaking (intensity follows voice amplitude), acting, needs
  confirmation (insistent but not alarming), danger/irreversible (distinct, serious).
- Must be subtle enough to work over full-screen apps, games and videos, and has an off switch.
- It's hidden from screen capture (the agent's own screenshots must not see it).

### 3. Quick Panel (pops out from the Companion)
A compact popover (about 380 × 520) for 90% of interactions, like Spotlight meets a walkie-talkie.
- Live transcript of the current exchange (user and agent), with interim text while speaking.
- "Now doing" strip: current tool call(s) as compact cards (tool, target, status, duration).
- Background tasks with progress and a cancel button.
- Push-to-talk button (also: hold a hotkey), text input fallback, a mic level meter.
- Pending confirmation card (see 6).
- Recent actions with a one-tap **Undo**.

### 4. The Main Window (opened only when needed)
Sections (navigation style is up to you, but please not a generic left sidebar of icons):

**a) Home / Session timeline.** One chronological stream mixing: what the user said, what the agent said,
tool calls as rich cards (args, result, duration, verified ✓ / mismatch), screenshots it looked at (with
blurred secrets visible as blurred), phone actions, background-task updates, confirmations and their
outcome. Filter by type. This is the "what did my agent actually do?" view.

**b) Ledger (activity log).** The permanent, auditable record. Dense table/list. Per entry: time, tool,
target, who triggered it (voice / typed / routine / watcher), status (pending, done, failed, undone,
**retry skipped: already done**, cancelled), risk level, reversible or "can't be undone", verification result.
Undo one entry, or **undo a whole session**. Survives restarts. Search, filter, export.

**c) Tasks.** Running and recent background tasks: progress, logs, cancel, "redirect" (change what it's doing).

**d) Routines.** Multi-step routines the user taught by voice ("Study mode: open VS Code, mute phone,
close YouTube"). List, run, edit steps (reorder, change, delete), rename, see last run result.

**e) Phone.** Connected Android device: connection method (USB / Wi-Fi pairing flow with a code), status,
battery, live screen thumbnail, recent phone actions, notifications feed, permissions for calls, SMS, files.

**f) Permissions** (modelled on Claude Code's permission system). Every tool listed with its risk level and
a per-tool policy: **Always allow · Ask every time · Never**. Scopes: allowed folders for file tools,
command patterns for the shell tool (e.g. allow `git status`, ask for everything else). Presets on top:
Cautious / Balanced / Power user. Explain clearly that **caution mode overrides "always allow"** after the
agent reads untrusted content. Show the history of decisions.

**g) Privacy & Safety.** What's sent to the model and what never leaves the device. Secret-masking preview
(screenshot with detected passwords/keys blurred). "Forbidden apps" the agent must never look at. A log of
**blocked prompt-injection attempts** ("A web page tried to instruct me to delete files; ignored").
Pause watching. Data retention.

**h) Watcher.** The optional "keeps an eye on your screen" mode: on/off, sensitivity, recent alerts
("Unsaved document about to close", "Build error in terminal") with **Useful / False alarm** feedback.

**i) Settings.** Wake word (with a test meter), voice, mic/speaker devices, push-to-talk key, model and
region, start with the OS, companion size/position, edge glow on/off, theme.

**j) Diagnostics.** Connection health: latency to first audio, reconnects, session resumes, dropped/
retried tool calls, live audio meters. For power users and for the demo.

### 5. Onboarding (first run)
Short and confident: mic permission → wake word test ("say it three times") → model sign-in → choose
a permission preset → optional: connect your phone → meet the Companion. Skippable after step 2.

### 6. Confirmation design (security-critical, please get this right)
Risky actions (delete, send SMS, place a call, run a shell command, anything irreversible) need a human yes.
For security, the confirmation appears in a **separate, trusted window** that no web content can reach.
Design its content and layout:
- What exactly will happen, in plain words ("Delete 214 files from Screenshots, 380 MB").
- Reversible? "Goes to Recycle Bin, can be undone" vs. a clear **"This can't be undone"**.
- Why it's asking (risk level), and whether **untrusted content was involved** in this request.
- Buttons: Allow once · Deny · (where permitted) Always allow this. A spoken "yes" also works; show that.
- Also design how the Companion, Edge Glow and Quick Panel look while a confirmation is pending.

### 7. System tray
Icon with state, plus a menu: show/hide companion, mute mic, pause watching, open Dreamwalker, quit.

## Key flows to prototype
1. Wake word → speak → agent acts (opens an app) → speaks result, seen entirely from the Companion + Edge Glow.
2. Risky request → confirmation → done → "undo that" by voice.
3. Wi-Fi drops mid-action → reconnecting → recovers, with the ledger showing "retry skipped: already done".
4. "Play some lofi on YouTube" → agent looks at the screen, clicks the right video, verifies it's playing.
5. Reading a malicious PDF → caution mode → blocked instruction appears in Privacy & Safety.
6. Teaching a routine by voice, then running it by name.
7. Phone: "Text Rahul I'm running late" → confirmation → sent from the phone.

## Deliverables
- 2–3 visual directions (Companion + Home), then the chosen one carried through.
- Design system: colour tokens (dark + light, plus all state colours), type scale, spacing, radii, elevation,
  iconography (custom, consistent; no emoji), motion tokens (durations, easings), core components.
- Every surface above, with its key states (empty, loading, active, error, offline, paused, caution).
- Companion: the state set + transitions + an animation spec a developer can implement.
- Edge Glow: colour and motion spec per state.
- Clickable prototype of flows 1 and 2 at minimum.
- Accessibility: WCAG AA contrast, reduced-motion versions of every animation, full keyboard use, and
  states never conveyed by colour alone.
