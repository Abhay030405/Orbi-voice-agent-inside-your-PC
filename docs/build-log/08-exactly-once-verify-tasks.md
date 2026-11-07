# Build log 8 — M3: can't break it (PS A1, A2, A3)

## A1: exactly-once (`ledger/idempotency.ts`)
After a dropped connection Gemini may ask for the same tool again, **with a new call id**. So we
compare *what* is asked, not the id:

```
key = <request id> | <tool> | <arguments, keys sorted>
```
- **request id** = a random UUID per user request. Reconnects, retries and nudges keep it; you asking
  again ("send it again") makes a new one. Random, not a counter: a counter restarts at 1 on every app
  start and would collide with yesterday's keys.
- The key goes into the Ledger's `idem_key` column, which is **UNIQUE**: the database itself refuses a second copy.
- The check runs **before** the Gatekeeper, so a retry is neither repeated nor asked about again.
- Reads are exempt (reading twice is harmless). **Failed** actions give their key back (a real retry
  can run); **done** and **denied** are final (a retry gets "already done" / "you said no").
- "Undo that" twice in one request counts as a retry (safety first); to undo several actions, Gemini
  passes each action's id.

Measured: create file → retry in the same request → *"this exact action was already done for this
request; it was not repeated"*; same for volume; a new request runs. Chaos: the connection killed right
after `set_volume`, 3 times → each executed **exactly once**, the session resumed, the reply completed.
(There, the outbox re-delivered the result, so Gemini didn't even re-ask. Exactly-once is the
second safety net.)

## A3: verify the real outcome
Each tool checks the world after acting, instead of trusting that the call worked:
| Tool | Check |
|---|---|
| set_volume | reads the volume back |
| write_clipboard | reads the clipboard back |
| focus_window | asks Windows which window is really in front |
| create_text_file / create_folder | it exists, with the right size |
| move_file | source gone AND destination there |
| delete_file | gone from its folder AND safely in the trash |
| open_app | waits up to 6 s for its window. If none: "I launched it, but couldn't see its window yet" |
| close_app | waits for the program to really exit |
| run_command / tasks | exit code |
| cancel_task | waits until the process really ended |

Results say `verified: true`, or report honestly what didn't happen. The system instruction already
says: never claim more than the tool result says.

## A2: background tasks (`tasks/tasks.ts`, `hands/taskTools.ts`)
- `start_task(title, command)` returns **at once**, so the conversation goes on. Same rules as
  `run_command` (high risk, exact command in the confirmation).
- Each task is its **own process** with its own output buffer, so several run at once without mixing
  (unit-tested: A's output never contains B's). Max 4, 30-minute limit.
- `list_tasks` (progress = time + latest output line), `get_task_output`, `cancel_task` (verified).
- When a task ends, Dreamwalker **says so by itself**, but only once it's idle, never over you. That note
  carries task output, which is outside text → caution mode for that turn.
- The process runner gained `startProgram()` (start now, stream output, cancel any time);
  `runProgram()` is now just "start + wait", so there's one copy of the safety logic.
- Quitting cancels every task: no orphan processes.

Measured through Gemini: "in the background wait 6 s then print finished" → reply at 4.6 s *"I've
started the background task"*; "what's running?" → *"currently running"*; at 13.5 s, unprompted:
*"The background task 'test task' has now finished."*

## Questions
1. Why does the key use a request id instead of the call id? What goes wrong with each choice?
2. Why must the request id be random rather than a counter?
3. Why is a *failed* action allowed to run again, but a *denied* one isn't?
4. Why does the "task finished" announcement wait until the agent is idle?
5. Why does the announcement switch on caution mode?
