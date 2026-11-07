# Build log 5 — M1 part 2: surviving connection drops (PS B6)

PS B6: *"The communion continues without interruption when the connection to the oracle is renewed
or lost. The master hears no gap and no repeated replies, and every ritual that was already running
finishes correctly."*

## Results (real Gemini, connection killed on purpose)

| Case | Drop happens… | Result |
|---|---|---|
| A | between two turns | Resumed in ~0.5 s; asked "what was my secret word?" → **"Mango."** |
| B | 50 ms after asking "what time is it?" | 1 tool call, full answer |
| C | mid-sentence ("One…") | **"two… three… twelve"**: continued, no repeat, no gap |
| D | right after the tool ran | 1 tool call, full answer |

How to re-run: start with `DREAMWALKER_DEBUG=1` (enables the `debugDropLink()` test hook, which is
otherwise unreachable) and `DREAMWALKER_TRACE=1` (logs every message in and out).

## The building blocks

**1. Session resumption.** While connected, Gemini keeps sending a **resume handle**. Reconnecting
with it restores the conversation. Measured: the first handle only arrives at the end of the first
turn, so a drop before that gets a *fresh* session (case C was exactly that).

**2. The outbox (`link/outbox.ts`).** With `transparent: true`, Gemini reports the number of the last
message it consumed. Measured facts that shaped the code:
- messages are numbered **from 1, per connection** (setup isn't counted)
- the count **restarts** after reconnecting
- confirmations come only **at the end of each turn**

Everything we send stays in the outbox until confirmed. After a reconnect we replay what's left, and
messages sent while offline are queued and delivered once we're back. 5 unit tests.

**3. Reconnect with backoff.** Waits 0.5 s → 1 s → 2 s … max 8 s between attempts, so a dead network
isn't hammered. After 2 failed *resumes* (e.g. an expired handle) it opens a fresh session and tells
the Brain the context is lost, so nothing waits forever.

**4. Planned shutdowns (`goAway`).** Gemini warns before closing a connection. We switch to a
resumed session at the next end of turn (or 3 s before the deadline), not mid-sentence.

**5. Generation numbers.** Every connection gets a number, and callbacks from older connections ignore
themselves. Otherwise an old socket's late "closed" event would knock the new one offline.

## Four bugs the chaos tests found (none were visible in normal use)

1. **"Ready" before the session existed.** Gemini's `setupComplete` arrived *before* the SDK's
   `connect()` returned the session object, so the replay saw "no session" and re-queued everything
   forever. Fix: replay when we have *both* (`flushIfReady`).
2. **An answer being generated is not saved.** The resumed session remembers the question but not a
   half-generated answer, and doesn't restart it on its own. Fix: if we're still owed an answer, nudge.
3. **Re-sending the question restarts the answer.** Since confirmations only come at end of turn, the
   question was "unconfirmed" mid-answer and got re-sent, so Gemini answered it again from "One".
   Fix: if an answer had started, hold the question back and send *"you were asked X, you had said Y,
   continue from there"* (built from the transcripts).
4. **Counters from the dead connection.** "Skip the next turnComplete (it closes a tool request)"
   waited for a message that would only ever have come on the old connection, and would have
   swallowed the real answer's turnComplete. Fix: `brain.resumedAfterDrop()` resets them. Related:
   Gemini sends `generationComplete` as soon as it's done, but delays `turnComplete` until playback
   would finish, so `generationComplete` is the reliable "answer is complete" signal.

Also fixed: if the **speaker device** errors, the Mouth now reports "done" instead of leaving the
agent stuck in "speaking" (it happened during testing).

## Known limit (handled in M3)
If the drop lands exactly between "the tool ran" and "Gemini got the result", a resumed session can
ask for the same tool again. Harmless for `get_current_time`, a real problem for "send SMS". That's
**A1, exactly-once**: the Ledger will recognise the repeat (same user turn + tool + args) and return
the saved result instead of running it twice.

## Questions
1. Why can't we just re-send everything after a reconnect? Give the exact case where that causes a repeat.
2. Why is `generationComplete` a better "answer finished" signal than `turnComplete` after a drop?
3. What would go wrong without generation numbers on connections?
4. Why does the debug hook only exist when `DREAMWALKER_DEBUG=1`? Who could misuse it otherwise?

---

## Follow-up fixes (from your testing)

**"It forgot our conversation after I closed the window."** Closing the window doesn't touch the
connection; the dev server *restarting* did (every save of a main-process file restarts the app, and
each start was a brand-new Gemini session). Fix: the latest resume handle is saved to
`%APPDATA%\dreamwalker\session.json` (atomic write) and resumed at startup if it's under 2 hours old
(Gemini's documented validity). Measured: told it "BANANA", killed the app, started again, asked:
**"BANANA"**. An invalid or expired handle is rejected by Gemini (`1007: Invalid history snapshot
handle`), and we fall back to a fresh session in 0.5 s without a "please repeat that" message, since
nothing was in progress at startup. Renaming the agent clears the saved handle (new persona = new session).

**"The screen keeps glowing ~5 s after it stopped talking."** Two causes:
1. We waited for `turnComplete`, which Gemini delays until it *thinks* playback ended. Now an answer
   is finished at **`generationComplete` + our speakers drained**. The late `turnComplete` still comes,
   so the Brain counts how many it owes (`turnClosesOwed`) and swallows them. A counter, not a flag,
   because if you ask again quickly, two can be outstanding. Unit-tested, including "the late close
   arrives after you already asked something new".
2. The 8 s follow-up window glowed at full brightness. Now it's 6 s, and the listening glow is
   **soft while you're silent**, brightening with your voice.
