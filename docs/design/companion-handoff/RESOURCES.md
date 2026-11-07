# Third-party resources (from Libraries.dev)

Both libraries are by Libraries.dev, have zero runtime dependencies and need React 18+. In this design they are **secondary effects**: the mascot stays the main identity.

---

## 1. Thinking Orbs: `thinking-orbs`
Docs: https://libraries.dev/orbs.html · npm: https://www.npmjs.com/package/thinking-orbs

```bash
npm install thinking-orbs
```
```jsx
import { ThinkingOrb } from 'thinking-orbs';

<ThinkingOrb state="searching" size={64} />
```
**Props**
- `state`: `"working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping"`
- `size`: `64` (chat-avatar scale) or `20` (inline-text scale). Each size is tuned separately.
- `speed`: multiplies the animation clock (default 1).
- `dark`: boolean. Picks the light or dark tuning.
- `paused`: boolean. Freezes the animation.

The orbs are monochrome dotted spheres on a plain 2D canvas, which fits the console's thin-line style.

**Where Dreamwalker uses it**

| Place | Orb |
|---|---|
| Home → Now rail → RUNNING task row (already in the design) | `state="working" size={20} dark` |
| Quick Panel "Now doing" strip, per running tool call | `working` (generic), `searching` (web search / screen look) |
| Reconnecting rows / Diagnostics while recovering | `connecting` |
| Routines while a routine is being taught or composed | `weaving` |
| Never | as the companion itself, or for past (finished) events. Only live things animate. |

Always pass `paused` when the user has reduced motion on.

---

## 2. Voice glow: `voice-glow`
Docs: https://libraries.dev/voice.html

```bash
npm install voice-glow
```
```jsx
import { VoiceBeam, useMicrophone } from 'voice-glow';

const mic = useMicrophone();

<VoiceBeam stream={mic.stream} processing={thinking}>
  <ChatInput />
</VoiceBeam>

<button onClick={mic.state === 'live' ? mic.stop : mic.start}>
  {mic.state === 'live' ? 'Stop' : 'Listen'}
</button>

// Without a microphone, drive it yourself (0–1, a number or a per-frame getter):
<VoiceBeam level={() => meter.current}>
  <Card />
</VoiceBeam>
```
**Props**
- `type`: geometry preset.
  - `"default"`: a ~350px chat input.
  - `"pill"`: a ~150×44 recording pill.
  - `"mobile"`: the bottom of a phone screen.
- `stream`: MediaStream to react to (wins over `level`).
- `level`: a 0–1 number, or a getter.
- `processing`: boolean. While work is in progress, the glow gathers into a beam that travels its range.
- `colorVariant`: `"colorful" | "mono" | "ocean" | "sunset" | "forest" | "candy" | "ice" | "gold"`.
- `colors`: up to 7 lobe colours.
- `bandColors`: `{ core, above, mid, below }`.
- Input chain (gain, gate, envelope): `sensitivity`, `threshold`, `attack`, `release`.
- Shape of the reaction: `reach`, `spread`, `flow`, `bend`, `idle`.
- `theme`: `"dark" | "light" | "auto"`.
- `strength`: 0–1, effect opacity.
- Also: `active`, `paused`, `scale`.

Behaviour notes:
- VoiceBeam wraps a child element and overlays a sound-reactive glow along its bottom edge.
- It auto-detects the child's border radius.
- The microphone needs a secure context (https or localhost), and `mic.start()` must be called from a user gesture.

**Where Dreamwalker uses it**

| Place | Setup |
|---|---|
| Home command bar (already in the design) | `colorVariant` = `ice` (Graphite) / `forest` (Ember), `theme="dark"`, `processing` = agent is thinking or acting |
| Quick Panel push-to-talk input | `type="default"`, `stream` = the same mic stream the agent uses |
| Push-to-talk recording pill (hotkey held, no panel open) | `type="pill"` |
| Phone screen (optional) | `type="mobile"` |

Drive it from the **same** audio graph the agent uses: `stream` while the mic is live, otherwise `level={() => agentVoiceLevel}` so it also glows when Dreamwalker speaks.

**Edge Glow note:** the full-screen Edge Glow overlay (brief §2) is a separate custom effect: a transparent, click-through, content-protected window. voice-glow is only for input components. You can still reuse its colour language: `ice` = listening and speaking. Confirm (amber) and danger (red) must be custom-built, because they carry meaning.

---

## Prototype-only shims in this folder
`dw-orb.js` and `dw-voice.js` load these packages from esm.sh into an isolated React root, so that the HTML design file can show them. **Do not ship them.** In the app, import the npm packages directly as shown above.
