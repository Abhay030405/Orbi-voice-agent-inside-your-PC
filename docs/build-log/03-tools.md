# Build log 3 — Phase 2a: the tool loop (this is what makes it an agent)

Without tools Dreamwalker can only talk. With tools it **acts**. Everything advanced in this PS
(confirmations, ledger, undo, exactly-once, phone control) is built on this one loop.

## The loop

```
You: "What time is it?"
   │
   ▼
Gemini: "I have a tool for that" ──► toolCall { id: "c1", name: "get_current_time", args: {} }
                                          │
                     main: findTool → tool.run(args) → { ok: true, local: "3:03 pm" }
                                          │
   ◄──────── sendToolResponse { id: "c1", name: "get_current_time", response: {...} }
   │
   ▼
Gemini speaks: "It's 3:03 in the afternoon."     (or calls ANOTHER tool first)
```

Measured: tool call at 500 ms, tool done 40 ms later, voice at 1.4 s.

**The AI never runs anything.** It sends a *request* with a name and arguments. Our code finds the
tool, runs it, and answers with the **same id** (so Gemini knows which request this answers,
like an order number). That's D4: the model proposes, the code disposes.

## The files

| File | Job |
|---|---|
| `main/hands/tool.ts` | **What a tool is**: name, description, parameters, risk, run |
| `main/hands/system.ts` | The tools: `get_current_time`, `open_url` |
| `main/hands/index.ts` | The registry: the list, lookup by name, the "menu" for Gemini |
| `main/link/gemini.ts` | Gives Gemini the menu at connect; receives `toolCall`; sends results |
| `main/index.ts` → "The tool loop" | Receives calls, runs them, answers. The Gatekeeper + Ledger go here later |

## Four design rules in this code

**1. The description is a prompt.** Gemini decides *when* to use a tool only by reading its
`description`. "Open a web page in the user's default browser… Use it when the user asks to open,
show, or go to a website" is what makes "open YouTube" work. A vague description = wrong tool or
no tool.

**2. Gemini only sees the menu.** `toolDeclarations()` sends name + description + parameters.
Gemini never sees `run` or `risk`. It knows what a tool is *for*, never how it works.

**3. Failure is a result, not a crash.** A tool returns `{ ok: false, error: "..." }` instead
of throwing, because Gemini must be able to tell the user *truthfully* what went wrong (the PS:
"never claim a ritual is complete when it failed"). And if a tool *does* throw, `runTool` catches
it and still answers. Otherwise Gemini would wait forever for a result.

**4. Arguments come from a stranger.** `args` is written by the AI, and the AI can be tricked by
text it reads. So `open_url` checks the URL itself: must parse, must be `https:`. Try
"Open file:///C:/Windows" in the app: the tool refuses, and Gemini tells you why.

## Bug we hit: idle while Gemini was about to speak

Logged message order around a tool call:
```
toolCall → generationComplete → turnComplete (~340 ms later) → modelTurn ×12 (voice) → turnComplete
```
A turn that asks for a tool **also ends with `turnComplete`**, and that one arrived *after* we'd
already answered the tool. Our code read it as "reply finished" and went idle, then the voice came.

Fix: `toolTurnsOpen` counts tool-request turns, and each one's `turnComplete` is skipped. Only
the final one ends the reply. Lesson: **name things by what they really mean.** `turnComplete`
means "this message is done", not "the reply is done". We found it by logging the real message
order instead of guessing.

## Your exercise: add a tool yourself

Add **`get_system_stats`**: free memory (MB), total memory (MB), uptime (minutes), CPU count. You
already wrote this logic in Phase 0, so now it becomes a tool.

1. Copy the shape of `getCurrentTime` in `hands/system.ts`. No parameters, `risk: 'low'`.
2. Write a description that makes Gemini use it for "how much RAM is free?" or "how long has my
   laptop been on?"
3. Add it to `TOOLS` in `hands/index.ts`. **That's the only other change.** Notice that you don't
   touch the Link, IPC or UI. That's the payoff of the registry design.
4. Restart dev and type: "How much memory is free and how long has my laptop been on?"

Then answer:
1. Why does a tool return `{ ok: false, error }` instead of throwing?
2. Gemini sends `{ url: "file:///C:/Windows" }` to `open_url`. Walk through what happens, line by line.
3. What would go wrong if `sendToolResults` used a different `id` than the request?
4. Why did we skip some `turnComplete`s, and how did we find out we needed to?
