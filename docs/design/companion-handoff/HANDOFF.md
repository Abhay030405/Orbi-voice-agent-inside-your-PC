# Handoff: Dreamwalker — Companion + Home (direction 2a/2b)

## Overview
Dreamwalker is a desktop voice agent (Electron + React; Windows 11 first, then macOS/Linux). It lives on screen as a small always-on-top **Companion** and has a **Main Window** for review. Its defining trait is that you can trust it: it asks before risky actions, logs everything, can undo, and never repeats an action after a network drop. The design makes that trust visible.

This handoff covers the **chosen direction (turn 2)**:
- The **Companion**: a "Familiar" face mascot with an 11-state vocabulary plus **tool morphs**, where the face itself becomes the tool.
- The **Home / Session timeline** screen in the console layout.
- Two colour themes on one semantic token set: **Graphite (default)** and **Ember (alternate)**.
- Two third-party effects: **thinking-orbs** (inline running indicator) and **voice-glow** (command-bar voice glow).

Turn 1 (directions 1a/1b/1c) is still in the file for history. Only implement turn 2 (`#2a`, `#2b`).

Not yet designed (next rounds): Quick Panel, trusted Confirmation window, Edge Glow, Ledger, Tasks, Routines, Phone, Permissions, Privacy & Safety, Watcher, Settings, Diagnostics, Onboarding, Tray. Build Home and the Companion so they can be reused there.

## About the Design Files
The files in this bundle are **design references created in HTML**: prototypes that show the intended look and behaviour. They are **not production code to copy directly**. Recreate them in the target codebase (Electron + React 18+, as the brief specifies) using its own patterns. If no app exists yet, use Electron + React + TypeScript, with plain CSS modules or your preferred styling and a Canvas 2D companion.

To view: open `Dreamwalker Directions.dc.html` in a browser, with `support.js` next to it. The page is a pan/zoom canvas. Scroll to the section headed **"2 · Merged"**. Options are `2a` (Graphite) and `2b` (Ember).

## Fidelity
**High-fidelity.** Colours, type, spacing and companion motion are final for these two surfaces. Recreate the layout pixel-accurately. Port the companion's Canvas drawing logic exactly. `companion-renderer.reference.js` is the source of truth for geometry and timing.

---

## Screens / Views

### 1. Companion (separate transparent, frameless, always-on-top window)
- **Size**: 96–140 px square canvas (design uses 96 for the state grid and 124 for the hero). It must stay legible at 96 px over any wallpaper.
- **Window behaviour (from brief)**: draggable, snaps to screen edges, never steals focus (`focusable:false`, `skipTaskbar:true`, `setIgnoreMouseEvents` except over the body), can be hidden.
  - Hover shows a one-line tooltip with the last action.
  - Click opens the Quick Panel.
  - Right-click opens a menu: mute mic, pause watching, open full app, quit.
- **Hover tooltip**: Geist 400 11px, ink `--tx`, bg `--surf`, 1px `--line2` border, radius 6, padding 5×9. Copy example: `Opened VS Code · 2 min ago`.
- **Rendering**: Canvas 2D at devicePixelRatio, one rAF loop. Port `drawFace(ctx, w, h, o, theme)` from `companion-renderer.reference.js`.

#### Body geometry (S = min(w,h) × 0.78, centred)
- Squircle body: `S × S`, corner radius `S × 0.34`.
- Fill: Graphite `rgba(18,21,25,0.95)`; Ember `rgba(27,24,20,0.95)`.
- Two edge strokes keep it legible on any wallpaper:
  - 1px `rgba(255,255,255,0.16)` on the body edge.
  - 1px `rgba(0,0,0,0.45)` at +0.8px outside it.
- Eyes:
  - Centres at `cx ± S×0.17`, `cy − S×0.05`.
  - Each eye is a vertical pill `S×0.10` wide × `S×0.17` tall, in colour `ink` at 0.9 alpha.
- Line weight for brows, mouth and the like: `L = S × 0.045`, round caps.

#### State vocabulary (st)
State is always carried by **shape**, not only colour.

| State | Form | Motion | Colour |
|---|---|---|---|
| idle | resting pill eyes | blink every 4.3 s (160 ms, cosine close/open); float ±1.8% S (sin, 1.3 rad/s) | ink |
| listening | eyes widen to `eh × (1.15 + 0.35·micLevel)` | stroke alpha 0.4 + 0.5·micLevel, 1.6px | eyes + stroke = signal |
| thinking | eyes smaller (0.9w × 0.8h), raised 6% S, drifting ±5% S | three-dot ellipsis below at 6 rad/s, staggered 0.9 rad | dots = signal |
| speaking | eyes become happy arcs (215°–335°) | mouth pill `0.20S` wide, height `S × (0.035 + 0.15·agentLevel)` | mouth = signal |
| acting | see **Tool morphs** | — | stroke signal 0.55 |
| task (background) | resting eyes | mouth is a progress track `0.30S` wide; fill = progress (demo 64%) | fill = signal |
| confirm ("Needs you") | round eyes (r = 0.62·ew); brows raised outward | 1.6 s double-pulse "hop" (heartbeat curve), 3.5% S | stroke 2.2px + brows = **attention amber** |
| danger ("Can't be undone") | smaller round eyes; stern brows slanting down toward the centre; flat mouth | **no bounce**, static | stroke 2.2px + brows = **danger** |
| reconnecting | eyes dim (0.45 alpha), 0.75h | slow glance ±7% S at 0.9 rad/s | dashed stroke [2,3], white 0.32 |
| offline | eyes closed (horizontal lines) | static | danger badge top-right with a dark bar |
| paused / private | **blindfold**: light band `0.22S` across the eyes (clipped to body), two knot tails right | zero motion | band = paper/ink-light; body fill lifted (`#262A31` G / `#2B261F` E) |
| caution (overlay mode) | resting eyes, **left brow lowered** (sceptical), right brow flat | as idle | dashed amber stroke [3,3] |

Caution is a **mode overlay**, not a replacement state. In production, render the caution stroke and brow on top of whatever state is active.

#### Tool morphs (st = acting, tool = …)
Every morph is a lerp from the resting eyes (`ent = 0`) to the tool pose (`ent = 1`). Because every morph starts and ends at the resting eyes, any state can transition into any other.
- **Entry**: `ent = easeOutCubic(since / 0.45s)`.
- **Exit**: ramp `ent` back to 0 over 0.45 s before leaving the acting state.

| tool | Morph |
|---|---|
| `app` (open app) | Eyes square up (`0.13S`, radius → `0.025S`) and move down 6% S. A title-bar line draws outward from centre at `y0 + 0.25S`. Three window dots appear top-left. |
| `term` (run script) | Left eye folds into a `>` chevron (the vertical pill splays into two arms). Right eye rotates into an underscore cursor that types: 3.5 steps/s, up to 3 glyph blocks, blinking 0.7 s. |
| `web` (search) | A magnifier ring (r = 1.35·ew) and handle grow over the right eye. Both eyes scan ±7% S at 1.8 rad/s. Three result lines draw in below. |
| `file` (files) | A folder tab grows on the top-left of the body. A small sheet slides left → right every 1.25 s. The eyes look down and follow it. |
| `phone` | Body narrows to `0.64S × 1.10S` with radius `0.16S`. Speaker line top, signal-coloured home bar bottom. A ring shake (±0.05 rad, 46 rad/s) for 0.4 s of every 1.6 s. |
| `screen` (look) | Four viewfinder corners close in from 0.47S → 0.33S. Eyes become round with pupils that dilate (2.2 rad/s). A scan line sweeps vertically at 0.7 Hz. |
| `click` | Eyes glance down-right and squint. A pointer slides in to `(cx+0.12S, cy+0.10S)` and taps every 1.2 s (press scale 0.88 for the first 12%), with a ripple ring. |
| `tile` (arrange windows) | A vertical divider grows from centre. Eyes slide apart to ±0.24S, each inside an outlined pane. |

Extending: future tools (SMS vs call, type text, routine) should follow the same rule: a lerp from the resting eyes, legible at 96 px, no text, and no badge.

#### Voice amplitude
- `aU` = user mic level 0..1 (listening).
- `aA` = agent TTS output level 0..1 (speaking).
- In the app, feed these from AnalyserNode RMS with attack ≈ 30 ms and release ≈ 120 ms. The demo uses a synthetic `amp()` function.

#### Reduced motion
When `prefers-reduced-motion` is on (or the app setting is enabled):
- Freeze time-based motion: no float, blink, scan or shake.
- Hold amplitude at a fixed 0.55.
- Snap morphs to `ent = 1`.
- **State changes still apply** (they are information). The Tweaks panel has a `reducedMotion` toggle to preview this.

#### Performance target
60 fps with low GPU use:
- One rAF loop and Canvas 2D only.
- Skip offscreen or hidden canvases.
- Throttle to ~15 fps while idle (idle motion is slow).
- Rive is also an option; the parameter list above maps directly to Rive state-machine inputs: `state`, `tool`, `morph`, `micLevel`, `voiceLevel`, `progress`, `caution`.

### 2. Main Window — Home / Session timeline
Frameless window, 1200 × 780 in the mock, radius 12, 1px `--line2` border, shadow `0 30px 80px rgba(0,0,0,.5)`, bg `--bg`. Column structure, top to bottom:

**a) Title bar** (44px, bottom border `--line`):
- Left:
  - Companion face canvas, 26px, state idle.
  - "Dreamwalker", Geist 500 13px `--tx`.
- Nav: text tabs with a 22px gap, Geist 12.5px, inactive 400 `--tx2`. The active tab is 500 `--tx` with a 2px `--acc` bottom border flush to the bar edge.
  - Tabs: Session · Ledger · Tasks · Routines · Phone · Permissions · Privacy · Watcher · Settings · Diagnostics.
- Right: window controls, each 46px wide, `--tx3`. The bar is a drag region; the controls are not.

**b) Status cluster** (grid `1.5fr 1fr 1fr 1fr 1.2fr auto`, bottom border, cells separated by 1px `--line` right borders, padding 12px 20px):
- Each cell has a label, a value and a sub-line:
  - Label: Geist Mono 500 10px, letter-spacing .12em, `--tx3`, uppercase.
  - Value: Geist 400 13.5px `--tx`.
  - Sub-line: Geist Mono 400 11px `--tx2`.
- Cells:
  1. STATE: 40px face canvas (live agent state) + "Idle · 1 task running".
  2. MODEL: "Gemini Live" / `eu-west · 182 ms`.
  3. PHONE: "Pixel 8" / `Wi-Fi · 76%`.
  4. WATCHING: "On" / `sensitivity: med`.
  5. MIC · WAKE WORD: a 10-bar level meter (3px bars, gap 2, max 14px tall; active bars `--acc`, rest `--line3`) / `on-device · hold Ctrl Space`.
  6. Buttons:
     - "Pause watching" and "Mute", each with a 13px glyph.
     - Style: Geist 500 12px, 1px `--line3` border, radius 6, padding 7×11.

**c) Body**: grid `minmax(0,1fr) 340px`.

*Left: timeline column* (padding 22px 28px 0):
- Header row:
  - Title: "Session 14", Geist 400 22px, letter-spacing −0.01em.
  - Meta: "Today from 09:41 · 23 actions · 0 failed", 12.5px `--tx3`.
  - Filter chips on the right: All · Speech · Tools · Screen · Phone · Tasks · Asked.
    - Active chip: bg `--tx`, text `--bg`.
    - Inactive chip: 1px `--line2` border, text `--tx2`, radius 6, 11.5px.
- Timeline rows: grid `60px 28px minmax(0,1fr)`, 14px vertical gap.
  - Column 1: time in Geist Mono 11px `--tx3`.
  - Column 2: a node marker sitting on a 1px `--line2` vertical spine at x = 73px.
  - Column 3: content.
- **Node markers** (shape encodes type, never colour alone):

  | Type | Marker |
  |---|---|
  | you (speech) | 9px hollow circle, 1.5px `--tx2` border |
  | agent (speech) | 8px filled circle `--tx2` |
  | tool | 8px rounded square `--acc` |
  | screen | 9px hollow rounded square, 1.5px `--acc` |
  | confirmation | 9px diamond `--att` |
  | network | 10×2 bar `--tx3` |

- **You (speech)**:
  - Label "YOU · VOICE": Geist 500 10.5px, .08em letter-spacing, uppercase, `--tx3`.
  - Quote: Geist 300 18px/1.4 `--tx`, wrapped in curly quotes.
- **Agent (speech)**:
  - Label "DREAMWALKER" in `--acc`.
  - Text: Geist 400 15px/1.45 `--tx2`.
- **Tool card**:
  - Container: bg `--surf`, 1px `--line`, radius 8, padding 10px 14px, flex row, gap 12.
  - Contents, left to right:
    - 16px glyph in `--tx2`.
    - **Human sentence**: Geist 500 13.5px `--tx` (e.g. "Opened draft-v7.docx").
    - Machine line (flex 1, ellipsis): Geist Mono 11.5px `--tx3`, `tool_name · target`.
    - Duration: Geist Mono 11.5px `--tx3`.
    - Verification: 12px check glyph + "Verified", Geist 500 11.5px `--acc`.
    - Optional Undo button: bg `--tx`, text `--bg`, radius 6, padding 5×10, with an undo glyph.
- **Confirmation record**:
  - Container: 1px `--attLine` border, radius 8, padding 14×16.
  - Label "ASKED FIRST · HIGH RISK": `--att`, 10.5px uppercase.
  - Action: Geist 15.5px `--tx`, "Delete 214 files from Screenshots · 380 MB".
  - Reversibility line: 12.5px `--tx2`, "Goes to Recycle Bin — can be undone".
  - Outcome on the right: mic glyph + `Allowed · you said "yes" · 09:44:31`.
- **Screen look card**:
  - Container: a tool card with a 200×112 screenshot thumbnail.
  - Detected secrets appear **visibly blurred** (`filter: blur(2px)` blocks) with an amber mono label "masked · password" / "masked · API key".
  - Then the look/click lines and "Verified · audio is playing".
- **Network row**:
  - Text: "Lost the connection for 1.4 s and picked up where it left off."
  - Dashed-border mono chip: `tabs.mute · retry skipped: already done`.
- The bottom of the column fades (120px gradient `--fade` → `--bg`).
- **Command bar** pinned above the fade:
  - Container: absolute, 28px from the sides, 16px from the bottom, 52px tall, radius 12, bg `--surf`, 1px `--line2`.
  - Contents, left to right:
    - Placeholder: "Type a command, or hold Ctrl Space to talk", 13.5px `--tx3`.
    - Mic-source label (`mic: simulated` / `mic: live`), mono 11px.
    - Kbd chip "Ctrl Space".
    - 36px round push-to-talk button: bg `--acc`, mic glyph in `--bg`.
  - The **voice-glow** overlay fills the bar.

*Right: "Now" rail* (340px, bg `--sunk`, left border `--line`, padding 22, 26px gap between sections):
- Section labels: Geist Mono 500 10px, .12em letter-spacing, `--tx3`.
- **WAITING ON YOU**:
  - Empty state copy: "Nothing right now. Risky actions show up here and in their own window."
  - When something is pending, the pending confirmation goes here.
- **RUNNING**: task card (bg `--surf`, 1px `--line`, radius 8, padding 14):
  - Title row: **thinking-orb 20px state="working"** + "Run test suite" + "64%".
  - Command in mono: `pnpm test --filter api`.
  - Progress bar: 3px tall, track `--line2`, fill `--acc`, radius 2.
  - Footer: "3:12 · ~1:50 left", plus Redirect and Cancel buttons (outline, radius 6).
- **UNDO RECENT**: rows separated by 1px `--line`.
  - Each row: glyph + description 13px `--tx` + mono time + "Undo" in `--acc` 500.
  - Below the rows: `Or say "undo that". Undo whole session` (the second part underlined).
- **LINK HEALTH** (pinned to the bottom): three metrics, value Geist 18px, label 10.5px `--tx3`.
  - `182 ms` first audio · `1` reconnect · `0` duplicates.

## Interactions & Behavior
- **Agent state** drives:
  - every companion canvas: the floating companion, the title-bar face and the status-cluster face;
  - the STATE cell text;
  - the voice-glow `processing` flag, which is true while thinking or acting.
- **Command bar**:
  - Hold Ctrl+Space for push-to-talk; the text input is the fallback.
  - With the mic live, voice-glow follows the real `MediaStream`. Otherwise it follows a level getter fed by the agent's audio levels.
- **Undo**: per-card Undo, "Undo whole session", and the voice command "undo that". All of them go through the Ledger. Undo must survive restarts.
- **Filter chips**: filter the timeline by event type. Single-select, with "All" as the default.
- **Timeline cards**: clicking one should open its detail (args JSON, result, verification, ledger id). The 1b inspector pattern is a good model for a later round.
- Motion tokens:
  - Morph 450 ms ease-out cubic.
  - Blink 160 ms every 4.3 s.
  - Idle float period ≈ 4.8 s.
  - Confirm pulse 1.6 s heartbeat (peaks at 10% and 28% of the period).
  - Reconnect glance 0.9 rad/s.
- Accessibility:
  - Every state must also appear as text: the status cell, a tooltip, and `aria-live="polite"` on state changes. Use `assertive` only for confirm and danger.
  - Contrast meets AA with the tokens below.
  - Everything must be reachable by keyboard.
  - Respect reduced motion as described above.

## State Management
- `agentState`: `idle | listening | thinking | acting | speaking | confirm | danger | task | reconnecting | offline | paused`, plus `cautionMode: boolean` as an overlay.
- `activeTool`: `app | term | web | file | phone | screen | click | tile | null`.
- `morph` (0..1): animated locally by the renderer, not stored in app state.
- `micLevel` and `voiceLevel`: per-frame values read from the audio graph; do not store them in React state.
- `backgroundTasks[]`: `{ id, title, command, progress, elapsed, eta }`.
- `session.events[]`: `{ time, type, … }`, where type is one of speech-you, speech-agent, tool, screen, confirm, net, phone, task.
- `undoStack` (persisted), `filter`, `theme: 'graphite' | 'ember'` (+ light variants to come), `micLive`.

## Design Tokens
Both themes use the same semantic names. Hex values:

| token | Graphite (default) | Ember |
|---|---|---|
| card / desk | `#0A0C0E` | `#100E0B` |
| bg | `#0E1013` | `#15130F` |
| sunk | `#0C0E11` | `#110F0C` |
| surf | `#14171B` | `#1C1915` |
| surf2 | `#1A1E23` | `#242019` |
| line | `#1F242A` | `#2A251F` |
| line2 | `#2A3038` | `#3A332B` |
| line3 | `#323840` | `#4A4239` |
| tx (ink) | `#E6E8EB` | `#EFEAE2` |
| tx2 | `#A2A9B2` | `#B5AC9F` |
| tx3 | `#7C848E` | `#857B6F` |
| acc (signal) | `#7FD3E6` | `#74D9B2` |
| att (needs you) | `#F2B54A` | `#F4B860` |
| err (danger) | `#F0705A` | `#F0715A` |
| attLine | `rgba(242,181,74,.45)` | `rgba(244,184,96,.45)` |
| tile (state tile bg) | `#121418` | `#1A1713` |
| companion body | `rgba(18,21,25,.95)` | `rgba(27,24,20,.95)` |
| companion body (paused) | `#262A31` | `#2B261F` |

Rules:
- Amber means "needs you" and nothing else.
- Danger (red) is reserved for irreversible actions and errors.
- The signal colour means live or verified.

Why Graphite is the default: amber stands out more on cool graphite than on warm charcoal.

**Typography**: Geist (300/400/500) for UI, Geist Mono (400/500) **only** for machine data (tool names, paths, commands, times, metrics). Sizes in use:

| Use | Spec |
|---|---|
| Display | 42 / 300 / −0.02em |
| Section title | 22 / 400 |
| User quote | 18 / 300 / 1.4 |
| Agent text | 15 / 400 / 1.45 |
| Card title | 13.5 / 500 |
| Body | 13 |
| Small | 12.5 / 12 / 11.5 |
| Labels | 10–10.5 uppercase, .08–.16em |

**Radius**: 6 (buttons, chips), 8 (cards), 10 (state tiles), 12 (window, command bar), 50% (push-to-talk button).

**Spacing**: 4 · 6 · 8 · 10 · 12 · 14 · 18 · 22 · 26 · 28 · 40.

**Elevation**: window `0 30px 80px rgba(0,0,0,.5)`. Everything else is flat, separated by borders.

## Assets
- **Glyphs**: custom stroked icons drawn on canvas. See `glyph()` in `companion-renderer.reference.js`: app, term, phone, web, file, screen, tile, check, undo, mic, wave, net, caution.
  - Grid: 1 unit = s; stroke ≈ 0.09·s; round caps and joins.
  - For production, convert them to an SVG icon set with identical geometry.
  - No emoji, no sparkle "AI" icons.
- **Screenshot thumbnails**: placeholders (striped). Use real captures with server-side secret masking.
- **thinking-orbs** (`npm i thinking-orbs`, MIT): `<ThinkingOrb state="working" size={20} dark />` in running-task rows. Map `connecting` → reconnecting rows. Don't use it in place of the mascot. Pause it under reduced motion.
- **voice-glow** (`npm i voice-glow`): wraps the command bar, `<VoiceBeam stream={mic.stream} level={getter} processing={isThinkingOrActing} colorVariant={theme==='graphite'?'ice':'forest'} theme="dark">`. Use `useMicrophone()` from the package; it needs a secure context and a user gesture to start.
- Fonts: Geist and Geist Mono (Google Fonts / Vercel, OFL). Bundle them locally in Electron.

## Files
- `MASCOT_GUIDE.md`: **how the mascot and its animations are built, and how to change them or add new expressions and tool morphs.** Includes copy-paste prompts for Claude Code.
- `mascot-playground.html`: live scrubber for every state, tool, morph value and voice level. Serve it locally (`npx serve .`).
- `RESOURCES.md`: thinking-orbs and voice-glow (Libraries.dev). Install, props, and where each is used.
- `screenshots/2a-graphite.png`, `screenshots/2b-ember.png`: full layout of each theme. Canvas faces and glyphs come out blank in these captures; see the mascot sheets.
- `screenshots/mascot-sheet-graphite.png`, `screenshots/mascot-sheet-ember.png`: every state, plus each tool morph at ent 0 / .25 / .5 / .75 / 1.
- `Dreamwalker Directions.dc.html`: the full design canvas. **Turn 2 (`#2a` Graphite, `#2b` Ember) is the spec.** Turn 1 is history. Open it in a browser with `support.js` alongside.
- `companion-renderer.reference.js`: the extracted Canvas renderer (`drawFace`, `glyph`, `THEMES`, timing helpers). This is the source of truth for companion geometry and motion.
- `dw-orb.js`, `dw-voice.js`: prototype-only web-component shims that load thinking-orbs and voice-glow from a CDN in an isolated React root. **In the real app, import the npm packages directly**; these files only show the intended props and wiring.
- `support.js`: runtime needed to open the design file. Not for production.
