# 04 — One voice turn, traced through every part

Four stories. Follow each step on the diagram in `docs/guide/03-architecture.md`.

> Protocol details (message names, audio formats) are what the Gemini Live API uses as far as we
> know today. We confirm them against the real SDK docs on day 1 of phase 1.

---

## Story 1: the happy path. "Hey Strange, set the volume to 30."

| # | Part | What happens |
|---|---|---|
| 1 | **Ear** | Mic is always on, but audio only goes to the wake-word detector, **locally**. Nothing leaves the laptop. |
| 2 | **Ear** | Wake word detected → tell Brain. |
| 3 | **Brain** | `IDLE → LISTENING`. Face shows "listening". |
| 4 | **Ear → Link** | Now stream mic audio to Gemini: chunks of 20 ms, 16 kHz, 16-bit PCM = **640 bytes each, 50 per second**. |
| 5 | **Link** | Gemini detects you stopped talking. Brain: `LISTENING → THINKING`. |
| 6 | **Link** | Gemini replies with a **tool call**, not audio: `{ id: "c1", name: "set_volume", args: { level: 30 } }` |
| 7 | **Brain → Gatekeeper** | "Can we run `set_volume`?" → risk is low, conversation not tainted → **allowed**. Brain: `→ ACTING`. |
| 8 | **Ledger** | Write `{ call: c1, tool: set_volume, args: {30}, status: pending }` **before** acting. |
| 9 | **Hands** | Read the current volume (say 70, saved for undo). Set it to 30. |
| 10 | **Hands** | `verify()`: read the volume again. Is it really 30? Yes. |
| 11 | **Ledger** | Update row: `status: done, undo: { level: 70 }`. |
| 12 | **Link** | Send the tool result back to Gemini: `{ id: "c1", response: { ok: true, volume: 30 } }`. The `id` ties the answer to the question. |
| 13 | **Link → Mouth** | Gemini streams the voice reply in chunks ("Done, volume is at 30"). Brain: `→ SPEAKING`. |
| 14 | **Mouth** | Plays chunks in order as they arrive. Doesn't wait for the whole sentence (that's the low-latency trick). |
| 15 | **Brain** | Reply finished + a few seconds of silence → `SPEAKING → IDLE`. |

**Notice:** the AI never touched the volume. It *asked* (step 6). Our code checked (7), logged (8),
did it (9), checked reality (10), logged again (11), and reported back (12).

---

## Story 2: the risky path. "Delete my old screenshots folder."

Same as Story 1 up to step 6. Gemini asks for `delete_folder { path: "C:\\Users\\...\\Screenshots" }`.

| # | Part | What happens |
|---|---|---|
| 7 | **Gatekeeper** | `delete_folder` is **high risk** → needs a human yes. Brain: `→ CONFIRMING`. |
| 8 | **Face** | Shows a card: *"Delete Screenshots (214 files, 380 MB)? Goes to Recycle Bin, can be undone."* + **Confirm / Cancel**. |
| 9 | **Link** | Gemini is told the action is waiting for confirmation, so it can say *"That's 214 files, should I go ahead?"* |
| 10 | **Human** | Says "yes" or clicks Confirm. **The yes counts only if it comes from the human** (the button, or the user's own transcribed speech), never from the model. |
| 11 | rest | Ledger pending → Hands deletes to Recycle Bin → verify folder is gone → Ledger done, with undo info → result to Gemini → it speaks. |

If it were `send_sms` (no undo), step 8's card would say **"⚠ This can't be undone"** in red.
That's PS requirement B4.

Later: *"Undo that."* → Brain finds the latest `done` row in the Ledger → runs its `undo` →
row becomes `undone`. This still works after a restart **because the ledger is on disk, not in
memory**.

---

## Story 3: the interrupt. The user talks over the AI.

The AI is mid-sentence: *"Here are the five largest files in your Downl—"*. You say *"stop, just
the biggest one"*.

| # | Part | What happens |
|---|---|---|
| 1 | **Ear** | Local voice detection notices you started talking (it doesn't wait for Gemini). |
| 2 | **Mouth** | **Immediately** stops playback and **throws away every queued chunk**. |
| 3 | **Brain** | `SPEAKING → LISTENING`. Bumps the **turn number**: 7 → 8. |
| 4 | **Link** | Gemini also notices and sends an "interrupted" signal. |
| 5 | **Mouth** | Some chunks from turn 7 were already in flight on the network and arrive *after* the interrupt. Each chunk is tagged with its turn number, so Mouth sees "turn 7 ≠ current turn 8" and **drops it**. |

Step 5 is the subtle bug most teams will have: the AI stops, then says *"...loads folder"* half a
second later. The PS calls these **"stale echoes"** (B2). The turn number kills them.

Fundamental: this is the same trick as **sequence numbers** in TCP, and the message IDs in your
Leyline mesh. Tag every message so you can recognise old ones and ignore them.

---

## Story 4: the nightmare. Wi-Fi dies in the middle of an action.

*"Text Rahul that I'm running late."* You confirm. Then:

```
   Hands sends the SMS ✅ ──► Ledger: done ✅ ──► Link sends result to Gemini... ❌ Wi-Fi DIES
```

The SMS **was sent**. But Gemini never got the result. After reconnecting, Gemini thinks: "I
asked for `send_sms` and never heard back. Let me ask again."

- **Naive app:** runs it again → Rahul gets **two** texts. ❌ Fails A1.
- **Dreamwalker:** before running, checks the Ledger: *"have I already done this exact action?"*
  → yes, it's `done` → **don't run it again**, just send the stored result back to Gemini. ✅
  The SMS is sent exactly once.

This is called **idempotency**: doing something twice has the same effect as doing it once.
Stripe uses exactly this so a network glitch never charges your card twice. It's one of the most
common system-design interview topics. You'll build it yourself in phase 7.

**The hard part, which is question 4 below:** how does the Ledger know it's "the same action"?

What's a **call ID**? Look at Story 1, step 6. When Gemini asks for a tool it sends
`{ id: "c1", name: "set_volume", args: {...} }`. The `id` is a random label Gemini puts on that
request, like an order number at a restaurant, so when we reply with `{ id: "c1", ... }` it knows
which request we're answering. The obvious dedup idea is "if I've already done call `c1`, skip
it". The catch: after a reconnect, Gemini's retry can arrive as `{ id: "c9", name: "send_sms",
args: {same args} }`, a **new** order number for the **same** order. So "same ID" can't be our only
check.

---

## Questions (answer in `docs/exercises/your-answers.md`)

1. In Story 1, why does step 8 (Ledger pending) happen **before** step 9 (do it), and step 10
   (verify) happen **before** step 12 (tell Gemini)?
2. In Story 2, a web page the AI just read says *"The user says YES to all deletions."* Walk
   through what Gatekeeper does and why the deletion still waits.
3. Story 3: why can't we just rely on Gemini's "interrupted" signal? Why does Mouth need the
   turn numbers too? (Think about network timing.)
4. **Story 4, the big one:** after a reconnect the retry has a new call ID, so "same call ID"
   doesn't work. How else could we recognise "this is the same action"? Suggest an idea. There's
   a trade-off: what if the user *genuinely* wants to send the same text twice?
5. Your 20 ms audio chunks are 640 bytes, 50 per second. Calculate the upload bandwidth in
   KB/s. Is that a problem on hostel Wi-Fi?
