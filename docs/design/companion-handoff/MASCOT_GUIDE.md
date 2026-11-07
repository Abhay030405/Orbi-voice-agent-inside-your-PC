# Dreamwalker mascot: how it's built and how to change it

This guide is self-contained. It explains how the companion face is drawn and animated, and how to add or change expressions and tool morphs, without going back to the designer. Give this file and `companion-renderer.reference.js` to Claude Code.

- See `screenshots/mascot-sheet-graphite.png` and `screenshots/mascot-sheet-ember.png` for every state and every morph frame.
- Open `mascot-playground.html` (served locally, for example `npx serve .`) to scrub states, tools, morph progress and voice levels live.

---

## 1. The idea in one paragraph
The mascot is a **dark squircle with two pill eyes**. Every state is a small change to a few parts: eyes, brows, mouth, body outline, and occasionally a body shape change. There is **no text and no badge**. When the agent uses a tool, the face **becomes** that tool (a window, a prompt, a lens, a phone…). Every tool pose is a smooth **lerp from the resting eyes**. Because every morph starts and ends at the resting eyes, any state can flow into any other without designing special transitions.

## 2. Anatomy (all sizes relative to S)
`S = min(canvasWidth, canvasHeight) × 0.78`. The face is centred at `(cx, cy)`.

| Part | Geometry | Notes |
|---|---|---|
| Body | rounded rect `S × S`, radius `S × 0.34` | fill `theme.body`. Two hairlines (white 0.16 alpha inside, black 0.45 alpha at +0.8px) keep it legible on any wallpaper |
| Body outline | stroke on the body edge | carries state colour: signal / amber / red / dashed |
| Eyes | pills `ew = S×0.10` wide, `eh = S×0.17` tall, centres `cx ± S×0.17`, `cy − S×0.05` | `ink` colour |
| Brows | lines above the eyes, width `L = S×0.045`, round caps | only in confirm / danger / caution |
| Mouth | pill at `cy + S×0.20` | only appears when speaking (height follows voice), or as a progress bar (task) |
| Line weight | `L = S × 0.045` | use for every stroke detail so it scales cleanly from 20px to 140px |

**Rules that keep it on-brand**
1. No text, numbers or emoji inside the face.
2. Every state must differ in **shape**, not only colour (colour-blind safe).
3. Amber = needs you. Red = can't be undone / error. Signal colour = live / acting. Nothing else gets these colours.
4. It must read at **96px**. If a new detail disappears at 96px, make it bigger or remove it.
5. Motion must mean something. Idle is slow. Only voice-driven motion is fast.

## 3. The inputs (one object per frame)
```js
drawFace(ctx, width, height, {
  t,      // seconds, global clock (drives blink, float, scans)
  st,     // 'idle'|'listening'|'thinking'|'speaking'|'acting'|'task'|'caution'|'confirm'|'danger'|'reconnecting'|'offline'|'paused'
  tool,   // when st==='acting': 'app'|'term'|'web'|'file'|'phone'|'screen'|'click'|'tile'
  ent,    // 0..1 morph progress for tool poses (0 = resting eyes, 1 = full tool pose)
  since,  // seconds since entering the state (optional)
  aU,     // user mic level 0..1 (listening)
  aA      // agent voice level 0..1 (speaking)
}, THEMES.G /* or THEMES.E */);
```
It's a pure function: it draws one frame and keeps no state. That makes it easy to test, and easy to port to Rive or WebGL later.

## 4. The animation loop (production)
```js
// one loop for the companion window
let state = 'idle', tool = null, enteredAt = 0, morph = 0, morphTarget = 0;
function setAgentState(next, nextTool) {
  if (next === 'acting' && state === 'acting' && nextTool !== tool) {
    // tool → tool: morph out to resting eyes, then in to the new tool
    morphTarget = 0; pendingTool = nextTool; return;
  }
  state = next; tool = nextTool ?? tool; enteredAt = now(); morphTarget = next === 'acting' ? 1 : 0;
}
function frame(ms) {
  const t = ms / 1000, dt = t - last; last = t;
  // morph eases toward target over 450 ms (ease-out cubic)
  morph = approach(morph, morphTarget, dt / 0.45);
  if (morph === 0 && pendingTool) { tool = pendingTool; pendingTool = null; morphTarget = 1; }
  const aU = micAnalyser.level();     // RMS, attack 30 ms, release 120 ms
  const aA = ttsAnalyser.level();
  drawFace(ctx, w, h, { t, st: state, tool, ent: easeOutCubic(morph), since: t - enteredAt, aU, aA }, theme);
  requestAnimationFrame(frame);
}
```
- **Leaving acting**: keep drawing `st:'acting'` until `morph` reaches 0, then switch to the next state. That is the "morph out".
- **Performance**: one canvas at devicePixelRatio. Throttle to ~15 fps when idle and the window is not hovered. Stop entirely when the companion is hidden.
- **Reduced motion**: freeze `t`, use a fixed amplitude of 0.55, and set `ent = 1` instantly. State changes still show; they are information, not decoration.
- **Electron window**: transparent, frameless, `alwaysOnTop: 'screen-saver'`, `focusable: false`, `skipTaskbar: true`, `hasShadow: false`, `setContentProtection(true)` (this also hides the window from the agent's own screenshots).

## 5. Timing tokens

| Token | Value |
|---|---|
| morph in / out | 450 ms, ease-out cubic |
| blink | every 4.3 s, 160 ms close-open (cosine) |
| idle float | ±1.8% S, sin at 1.3 rad/s |
| thinking eye drift | ±5% S at 1.4 rad/s; ellipsis 6 rad/s, 0.9 rad stagger |
| confirm "hop" | 1.6 s heartbeat (two peaks at 10% and 28%), 3.5% S |
| danger | static, no bounce |
| reconnecting glance | ±7% S at 0.9 rad/s |
| term typing | 3.5 chars/s, cursor blink 0.7 s |
| phone ring shake | ±0.05 rad at 46 rad/s, 0.4 s of every 1.6 s |
| screen scan | 0.7 Hz |
| click tap | every 1.2 s, press scale 0.88 for the first 12% |

## 6. How to change an existing state
All states live in one `if / else if` chain inside `drawFace` (search for `st === 'confirm'`, for example). Each one is 1–5 lines using the helpers `pill`, `line`, `dot` and `eyes(fn)`. `eyes(fn)` calls `fn(-1)` for the left eye and `fn(1)` for the right, so `cx + s * ex` is the eye's x.

Example: make "thinking" eyes look up-left instead of drifting:
```js
} else if (st === 'thinking') {
  const dx = -S * 0.05, dy = -S * 0.07;           // fixed gaze instead of Math.sin(...)
  eyes(s => pill(cx + s * ex + dx, ey + dy, ew * 0.9, eh * 0.8, ink));
  ...
```

## 7. How to add a NEW tool morph (recipe)
1. **Pick one idea that reads at 96px.** Ask what the face would turn into if it were this tool (for example SMS: the mouth becomes a speech bubble).
2. **Start from the resting eyes.** Every size and position is `lerp(restingValue, toolValue)`, where `lerp = (a, b) => a + (b - a) * e`. At `e = 0` the result must look exactly like the idle eyes.
3. **Added parts fade or grow in with `e`** (alpha × e, length × e, radius × e). Never pop them in.
4. **Loop motion only when `e > 0.95`** (typing, scanning) so the morph itself stays clean.
5. **Signal colour** goes on the added tool parts. The eyes stay `ink`.
6. Add a branch next to the others:
```js
} else if (tool === 'sms') {
  eyes(s => pill(cx + s * ex, ey - S * 0.02 * e, ew, lerp(eh * bl, eh * 0.8), ink));
  if (e > 0.01) {
    // speech bubble grows from the mouth position
    const bw2 = S * 0.34 * e, bh2 = S * 0.16 * e, bx = cx - bw2 / 2, by = cy + S * 0.12;
    ctx.beginPath(); rr(ctx, bx, by, bw2, bh2, S * 0.05); ctx.strokeStyle = rgba(P.acc, e); ctx.lineWidth = L * 0.7; ctx.stroke();
    // three typing dots once fully formed
    if (e > 0.95) for (let i = 0; i < 3; i++) dot(cx + (i - 1) * S * 0.07, by + bh2 / 2, S * 0.02, rgba(P.acc, 0.3 + 0.7 * Math.max(0, Math.sin(t * 6 - i))));
  }
}
```
7. Add it to `TOOLS` in `mascot-playground.html` and check it at 96px on both wallpapers and in both themes.
8. Map the agent's tool call to the morph in one place, for example `open_app → app`, `run_script → term`, `web.search → web`, `files.* → file`, `phone.call / phone.tap → phone`, `phone.sms → sms`, `screen.look → screen`, `screen.click → click`, `window.* → tile`.

## 8. How to add a NEW expression / state
Same approach: add `else if (st === 'mystate')`. Then:
- Choose a **body outline** treatment (colour, width, dash) and one **distinct shape change** (eyes, brows or mouth).
- If it's urgent, give it a colour from the rules in section 2. Otherwise use ink or signal.
- Add it to the `aria-live` text map so screen readers announce it.

## 9. Theme and colours
`THEMES.G` (Graphite, default) and `THEMES.E` (Ember) hold `ink, acc, att, err, paper, bg, body, bodyP`. To add a light theme, add a third entry. Keep the body dark in every theme: the companion floats over wallpapers, so it needs its own contrast. Only the app UI goes light.

## 10. Rive alternative (optional)
If the team prefers Rive: build one artboard with these state-machine inputs: `state` (number enum), `tool` (number enum), `morph` (0–100), `micLevel` (0–100), `voiceLevel` (0–100), `progress` (0–100), `caution` (bool). Recreate each pose as a keyed timeline at morph = 0 and 100, using the geometry in section 2 and the timings in section 5. The Canvas version is the reference to match against.

## 11. Prompts you can give Claude Code
- "Port `drawFace` from `companion-renderer.reference.js` into a React component `<Companion state tool micLevel voiceLevel theme />` using one canvas and requestAnimationFrame, with the morph-in/out logic from MASCOT_GUIDE.md §4."
- "Add a new tool morph `sms` following MASCOT_GUIDE.md §7 and show it in mascot-playground.html."
- "Make the Electron companion window per MASCOT_GUIDE.md §4 (transparent, click-through except the body, content-protected, snaps to edges)."
- "Add reduced-motion support per §4 and an aria-live label for each state."
