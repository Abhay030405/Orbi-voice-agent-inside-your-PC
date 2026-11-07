# 01 — Start here

You're building **Dreamwalker**: a desktop app you talk to, which actually does things on your
laptop and your Android phone, and **stays correct when things break**.

**The full reading order and a map of every doc is in [`docs/README.md`](../README.md).** Each doc
ends with questions; write answers in `docs/exercises/your-answers.md` (plain notes, Hinglish is
fine). **If you can't answer a question, that's the part to re-read.**

---

## How we work together

For every module:

1. **Problem.** What breaks if this module doesn't exist?
2. **Options.** Two or three ways to solve it.
3. **Choice + why.** Which one we picked and the trade-off.
4. **You explain it back** (in `docs/exercises/your-answers.md`).
5. **Code.** For the *core* modules (state machine, ledger, permissions, exactly-once) **you
   write it** and I guide and review. For boilerplate (window setup, build config) I write it and
   explain every line.
6. **Test it by breaking it.** The judges will try to break it, so we do it first.

The rule: if you can't explain a line in the viva, it doesn't go in.

---

## The roadmap

Build order protects the demo. **Basic features must work reliably before we touch advanced.**
A Dreamwalker that crashes once in front of the judges loses to a boring app that never crashes.

| Phase | What | PS items | Core concept you'll learn |
|---|---|---|---|
| 0 | Scaffold: Electron window + React + IPC hello-world | — | OS processes, IPC |
| 1 | Hear and speak: wake word → Gemini Live → voice back, state shown | B1 | Streaming, WebSockets, audio buffers |
| 2 | Interrupt: user talks → it shuts up instantly | B2 | Queues, cancellation |
| 3 | Hands: 10+ tools via function calling, each with a permission level | B3 | API design, least privilege |
| 4 | Ledger: confirm risky actions, log everything, undo by voice after restart | B4 | Databases, write-ahead logging |
| 5 | Eyes: screenshot on request, AI explains it | B5 | Image pipelines |
| 6 | Survive disconnects: reconnect silently, no gaps, no repeats | B6 | Session resumption, retries |
| 7 | Exactly-once: drop the network mid-action, the action still happens once | A1 | **Idempotency** (huge interview topic) |
| 8 | Background tasks: long jobs run while you keep talking, cancel by voice | A2 | Concurrency, task IDs |
| 9 | Verify: check the real result after each action, never lie "Done" | A3 | Postconditions |
| 10 | Phone: control Android over adb | A4 | Android internals |
| 11 | Routines: "teach" multi-step commands by voice, saved | A5 | Persistence, macros |
| 12 | Watcher: speaks up when the screen shows an error | A6 | Precision vs recall |
| 13 | Bonus: prompt-injection defence, secret masking, unknown apps | C1–C3 | AI security |

Phases 0–7 are the **must-win** part. 8–13 are where we pull ahead.

---

## Do these today (things only you can do)

1. **Message the coordinators** (numbers on the last page of the PDF). Send something like:
   > Hi, team for Softablitz here. Quick questions: (1) Is TypeScript OK under "Electron
   > (JavaScript)"? (2) Can we start coding before the dev period, or only after? (3) What are the
   > exact dev-period dates? Thanks!

   Question 2 matters: some hackathons disqualify code written before the start. Until they
   answer, we only write **learning docs and throwaway experiments**, not the real repo.
2. ~~Get a Gemini API key~~ **Done differently:** we use Vertex AI on your Google Cloud project
   `dreamwalker-softablitz` (your $300 credits). Your code logs in with your gcloud login
   (Application Default Credentials), so **no API key exists to leak**. Viva point: "we use
   short-lived OAuth tokens from the developer's login, not a long-lived secret in a file."
3. **Make a free Picovoice account** (console.picovoice.ai) to get an access key for the wake word.
4. Read files 01–03 and fill in `docs/exercises/your-answers.md`.
