# Build log 2 — Phase 1a: make Gemini speak through your speakers

Goal: click a button → main asks Gemini to say something → Gemini's voice comes out of your
speakers. No mic yet. That's slice 1b.

---

## Part 1: what sound is, in code

### A "sample"

Sound is air pressure wobbling back and forth. A microphone turns it into a voltage that wobbles
the same way. To store it digitally, we **measure that wobble many times per second**. Each
measurement is one **sample**: a single number meaning "the speaker cone should be *this far*
out right now".

```
pressure
   ▲      •  •                    each • is one sample:
   │   •        •                 a number like 12034 or -8812
   │ •            •
───┼•───────────────•──────────►  time
   │                  •       •
   │                     •  •
```

### Sample rate

**How many samples per second.** More samples = more detail.

| Rate | Who uses it | Why |
|---|---|---|
| 16,000 / s (16 kHz) | **Gemini wants your mic at this** | Enough for clear speech, small to send |
| 24,000 / s (24 kHz) | **Gemini sends its voice at this** | A bit nicer quality for output |
| 44,100 / 48,000 / s | Music, your laptop's speakers | Full hearing range |

The rule: a sample rate can capture sounds up to **half** its value (the Nyquist limit, from your
signals class). Human speech is mostly under 8 kHz → 16 kHz is enough.

### PCM, 16-bit

**PCM** (Pulse Code Modulation) = "just the raw list of samples, nothing compressed". No MP3, no
headers. Each sample is a **16-bit signed integer** (Int16): a number from **-32,768 to 32,767**,
**2 bytes** each.

So one second of Gemini's voice = 24,000 samples × 2 bytes = **48,000 bytes** (~47 KB).

### What the browser wants instead

The Web Audio API doesn't use Int16. It wants **Float32 between -1.0 and +1.0**. So for every
sample: `float = int16 / 32768`. That one line is the whole conversion.

---

## Part 2: chunks, and why playing them naively stutters

Gemini doesn't send one big audio file at the end. It **streams small chunks** as it generates
them (that's how we get ~1 s to first audio instead of waiting for the full reply).

**Naive way:** play each chunk the moment it arrives.

```
chunk 1 arrives → play (lasts 40 ms)
                     chunk 2 arrives 55 ms later (Wi-Fi hiccup) → 15 ms of SILENCE → click/stutter
```

Network delay isn't constant; it jitters (remember **jitter** from `docs/exercises/review-01.md`?). Chunks
arrive in bursts and gaps, so playing on arrival gives a choppy, clicky voice. Same thing as a
YouTube video freezing on bad Wi-Fi.

**Our way: schedule on a timeline, with a small cushion.**

Web Audio has a precise clock (`ctx.currentTime`). Instead of "play now", we say "play at exactly
time T", and keep a **playhead**: the moment the last scheduled chunk ends.

```
playhead ──►|chunk 1|chunk 2|chunk 3|     each new chunk is scheduled to start exactly where
            t=0.05  0.09    0.13          the previous one ends → no gaps, no overlaps
```

- New chunk arrives → `start(playhead)`, then `playhead += chunk duration`.
- If we've fallen behind (playhead is already in the past because chunks stopped coming), restart
  the playhead at `now + 50 ms`. That 50 ms is a tiny **jitter buffer**: a cushion so the next
  chunk has time to arrive. Bigger cushion = smoother but more delay. That trade-off again.

YouTube does the same thing at a bigger scale: it buffers a few seconds ahead.

---

## Part 3: the flow of slice 1a

```
  RENDERER                                MAIN                                   ☁ GEMINI
  ────────                                ────                                   ────────
  [Say it] button
     │ window.dreamwalker.sayText("...")
     ├──────── invoke ───────────────────► state → thinking
     │                                    link.sayText(text) ──────────────────► generates voice
     │                                                       ◄──── audio chunk (base64) ──┤
     │                                    decode base64 → bytes                           │
     │                                    first chunk? state → speaking                   │
     │◄────────── 'audio:chunk' ──────────┤                                               │
  Mouth.enqueue(bytes)                                       ◄──── more chunks ───────────┤
     │ Int16 → Float32 → schedule                            ◄──── turnComplete ──────────┘
     │                                    remember: Gemini is done sending
  last scheduled chunk finishes playing
     │ window.dreamwalker.playbackDone()
     └──────── send ─────────────────────► Gemini done AND playback done → state → idle
```

**Why does the renderer have to report `playbackDone`?** Gemini sends audio *faster than real
time*. Its `turnComplete` can arrive while 3 more seconds of voice are still queued in the
speakers. Only the Mouth knows when sound actually stops. Main only switches to idle when **both**
are true: Gemini finished sending, **and** the speakers finished playing.

---

## Bug we hit: the badge stuck on "connecting…" (a race condition)

First version: main **pushed** the current state when the page finished loading. Logs showed
main really did send `idle`, yet the badge never showed it, while the Gemini status (sent right
after it) did show up.

Cause: React 19 renders and runs `useEffect` a little **after** the page's load event. The two
pushes landed on either side of the moment React subscribed: the first was lost, the second
caught. The outcome depended on timing, so it's a **race condition**. On a slower or faster
laptop it could break differently.

Fix: the standard **subscribe, then snapshot** pattern:
1. React subscribes to updates. From here on, nothing can be missed.
2. React asks main for a snapshot of the current values (`getSnapshot()`).

Order matters: snapshot first then subscribe leaves a gap where an update can slip through.
This is the same pattern as loading a chat app: open the WebSocket for new messages *first*,
then fetch the message history.

Lesson: **"the receiver is ready" is something only the receiver knows.** So the receiver should
ask (pull), instead of the sender guessing when to push.

---

## Who writes what

| File | Who | What |
|---|---|---|
| `renderer/audio/mouth.ts` | Claude | Int16 → Float32, playhead scheduling, stop |
| `main/testTone.ts` | Claude | Generates a beep as PCM, to test the Mouth without Gemini |
| IPC wiring (shared, preload, main index, App) | Claude | New channels: `sayText`, `audio:chunk`, `playbackDone`, test tone |
| **`main/link/gemini.ts`** | **You** | **The Gemini Live session: connect, receive audio, send text** |

**Testing order:**
1. Click **"Play test beep"**. You should hear a beep and see the badge go `speaking` → `idle`.
   This proves Mouth + IPC work, with no Gemini involved.
2. Write the Link (below). Click **"Say it"**. Gemini speaks.

If step 2 fails but step 1 works, the bug is in the Link. **Test one layer at a time.**

---

## Your task: write `src/main/link/gemini.ts`

The file has a skeleton with the class shape and TODOs. You fill in `connect()`, the message
handler, and `sayText()`. Here's the SDK surface you need (this is what our latency probe used):

```ts
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai'

// 1. A client. Create it ONCE and reuse it (the probe showed reuse halves connect time).
const ai = new GoogleGenAI({ vertexai: true, project: '...', location: '...' })

// 2. Open a live session (a WebSocket under the hood). Resolves to a Session.
const session: Session = await ai.live.connect({
  model: '...',
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: 'You are Dreamwalker, ...'   // optional: personality + rules
  },
  callbacks: {
    onopen: () => {},
    onmessage: (msg: LiveServerMessage) => {},     // EVERYTHING from Gemini arrives here
    onerror: (e) => {},
    onclose: (e) => {}                              // e.code, e.reason
  }
})

// 3. Inside onmessage: audio and "I'm done" signals.
msg.serverContent?.modelTurn?.parts        // array; a part with inlineData.data = base64 audio
msg.serverContent?.turnComplete            // true when Gemini finished this reply

// base64 string → raw bytes (Node):
const bytes = new Uint8Array(Buffer.from(base64String, 'base64'))

// 4. Send text as if the user said it:
session.sendClientContent({
  turns: [{ role: 'user', parts: [{ text: 'Say hello!' }] }],
  turnComplete: true
})
```

The config values (project, region, model) are in `main/config.ts`. Import them, don't
hard-code them.

### Update: Claude wrote the Link (Abhay's call), so here's how to study it

Measured on first run: `connected`, then **793 ms to first audio** (the connection was already open,
pre-connecting paid off), 14 chunks ≈ 2.1 s of voice, and `idle` only once the speakers finished.

AI-era coding isn't typing every line yourself. It's being able to **read** code, **predict** what
it does, **break** it on purpose, and **change** it. The viva tests exactly that. Do these 5 steps
on `src/main/link/gemini.ts`:

**1. Read it with one question per line: "what makes this line run?"**
Some lines run once (constructor), some on every connect, some on every message from Gemini.
Mark each line in your head as *once / per connect / per message / per click*.

**2. Predict, then run.** Before clicking "Say it", write down the order you expect the terminal to
print `[link] ...` lines and the badge to change. Then run it. Wherever you were wrong is exactly
the part you didn't understand yet.

**3. Break it on purpose (one at a time, undo after each).** Predict the result *before* running:
- a) Change `onmessage: (msg) => this.handleMessage(msg)` to `onmessage: this.handleMessage`.
- b) Set the model in `config.ts` to `'gemini-banana'`. What does the status line say, and why
  does it never show "connected" first? (Hint: why did we wait for `setupComplete`?)
- c) Remove `?? []` after `.parts`. Does it break immediately? When *would* it break?
- d) Change `turnComplete: true` to `false` in `sayText`. What does Gemini do now?

**4. Change it yourself (small features, you write them):**
- e) Give it a different voice. Look up `speechConfig` in the SDK types:
  `node_modules/@google/genai/dist/node/node.d.ts`, search `prebuiltVoiceConfig`.
- f) Log how long each reply took to start: time from `sayText` to the first `onAudio`. Print it
  as `[link] first audio after 793 ms`.

**5. Explain it back in 5 lines, without looking:** what the Link does, why the client is created
only once, why we don't trust `onopen`, why arrow functions, and what `closed` protects against.

### Questions (answer in chat after it works)

1. Gemini sends audio as **base64 text** inside JSON. Why not raw bytes? And what does base64 cost
   us in size? (Hint: every 3 bytes become 4 characters.)
2. Main sends each chunk to the renderer as a `Uint8Array`. Why decode base64 **in main** instead
   of sending the base64 string and decoding in the renderer?
3. What should happen if `sayText` is called while the session isn't connected yet?
