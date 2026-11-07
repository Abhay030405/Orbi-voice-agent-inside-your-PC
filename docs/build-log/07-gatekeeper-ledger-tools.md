# Build log 7 — M2: Gatekeeper, Ledger, 25 tools, screenshots (PS B3, B4, B5)

Every tool call now goes through one pipeline in `main/index.ts` → `runTool()`:

```
Gemini asks for a tool
  → describe()  plain words + PRE-CHECK (outside the fence? file missing? → refuse now, never ask)
  → Gatekeeper  allow / ask / deny
  → (ask)       native Windows dialog OR your spoken "yes"/"no", 60 s, default = no
  → Ledger      write "pending" BEFORE anything happens
  → run()       the tool
  → Ledger      "done" + undo data, or "failed" / "denied"
  → caution mode ON if the tool brought in outside content
  → answer Gemini with the same id
```

## 1. The process runner (`hands/process.ts`)
Every program a tool starts runs as its **own process** (own PID, own memory), so it can't crash
Dreamwalker. What it *can* do is hang, flood us with output, or leave children behind. So: a timeout
that kills the **whole process tree** (`taskkill /T`), an output cap, `shell: false`, no console window.

**The AI's text is data, never code.** With `powershell -Command`, everything is joined into ONE
string of code, so `https://x.com"; Remove-Item C:\Users -Recurse; "` would run. Our scripts are
fixed, sent base64-encoded, and every outside value arrives as an **environment variable**
(`$env:DW_URL`), which PowerShell only ever reads as a string. A unit test proves an injection
attempt is printed back as text. (Exception: `run_command`, whose whole job is running the user's
command. There the protection is the human seeing the exact command in the confirmation.)

## 2. The Ledger (`ledger/ledger.ts`): SQLite, not JSON (your question)
| | JSON file | SQLite (chosen) |
|---|---|---|
| Add one action | rewrite the whole file | one row, one transaction |
| Power cut mid-write | half a file (unless temp+rename every time) | WAL: old state or new, never half |
| "Last undoable action" | load everything, search in code | one query |
| "Only one of these" (exactly-once, M3) | your code must check | `UNIQUE` column: the database refuses |

Node has SQLite built in (`node:sqlite`), so no native module. `synchronous=FULL` = only say "written"
when the disk really has it. At startup, rows still `pending` become `interrupted`: the app stopped mid-action
and we honestly don't know if it happened. 5 unit tests, including "survives a restart".

## 3. The Gatekeeper (`gatekeeper/gatekeeper.ts`), pure logic, 9 tests
| # | Rule | Why |
|---|---|---|
| 1 | your setting = never → deny | your choice wins |
| 2 | the tool only reads → allow | looking changes nothing |
| 3 | **caution mode** + the tool changes something → **ask, even if "always allow"** | what it just read may contain hidden instructions (C2) |
| 4 | your setting = always allow / ask | like Claude Code |
| 5 | default: high risk asks, low runs | |

**Caution mode** switches on when a tool returns outside content (`untrustedOutput`: clipboard, files,
folder listings, window titles, command output) and resets when you start a new request.

**Confirmations** (`gatekeeper/confirm.ts`): a **native Windows dialog** (no page can see or click it,
your design) with **Deny as the default button**, OR your own voice: "yes / haan / kar do" vs "no / nahi /
mat". Matched against the transcript of OUR mic, never against text the AI read. Ambiguous ("yes… no
wait") = no. No answer in 60 s = no. The dialog says whether it can be undone ("⚠ This CAN'T be undone").

**Loosening a permission needs a native-dialog yes** too: any script in our page could call
`updateSettings({ permissions: { run_command: 'allow' } })`. Tightening is free.

## 4. The tools (23)
| Group | Tools | Risk | Undo |
|---|---|---|---|
| System | get_current_time, get_system_stats | read | |
| Browser | open_url (+ chrome / edge / firefox / brave) | low | |
| Apps & windows | open_app, list_windows, focus_window, close_app | low/read/low/**high** | |
| Sound | get_volume, set_volume | read/low | ✅ |
| Clipboard | read_clipboard, write_clipboard | read/low | ✅ |
| Files | list_folder, read_text_file, create_text_file, create_folder, open_file, move_file, delete_file | read… **high** | ✅ all changes |
| Terminal | run_command, open_terminal | **high**/low | |
| History | list_recent_actions, undo_last_action | read/low | |

- **The fence** (`hands/files.ts`): Desktop, Documents, Downloads, Pictures, Music, Videos, wherever
  Windows really keeps them (yours is `C:\Users\hp\OneDrive\文档`!). The REAL path counts after following
  links and resolving `..`.
- **Delete moves to Dreamwalker's trash**, so undo always works. Even undoing a *create* moves the file
  to the trash rather than destroying it.
- **Verify, don't trust** (A3): volume reads back the level, clipboard reads back the text,
  focus_window checks which window is really in front.
- **Fixed lists, not AI text**: browsers come from a fixed table; apps are matched against the Start
  menu's own list and launched by its ID.

## 5. Measured
Every tool through the full pipeline (debug hook `debugCallTool`, auto-confirm in tests):
volume 66 → 65 → **undo** → 66 · clipboard written, read back, **undo restored the original** ·
create / list / read / rename / delete → **undo, undo** → file back · `C:\Windows\win.ini`, the `..\..\`
trick and deleting Documents itself refused · `exit 3` reported as a failure · a 90 s command killed at
60 s · unknown tool and `file:///` refused · caution mode switched on after reading the clipboard.

Through **Gemini**: "create a file on my Desktop" → done; "delete that file" → confirmation → no →
"The file was not deleted because the action was not approved."; "undo that" → the file is gone.

## 6. Bugs found while testing
1. **PowerShell 5.1 has no `ConvertTo-Json -AsArray`**, and piping a one-item list turns it into one
   object. Fix: `ConvertTo-Json -InputObject @(...)`.
2. **Electron 44's clipboard is async**. The type checker caught it.
3. **Garbage in command output** (`#< CLIXML … Preparing modules`): PowerShell's progress bar.
   Fix: `$ProgressPreference = 'SilentlyContinue'`.
4. **Asking before checking.** It would have asked "Delete the folder 文档 (20 items)?" and only then
   refused. Fix: `describe()` is also the pre-check; a refused action never reaches the dialog.

## Questions
1. Why can't a URL from the AI be pasted into `powershell -Command "…"`? How do env vars fix it?
2. Walk through what happens, rule by rule, when caution mode is on and `delete_file` is set to "always allow".
3. Why does loosening a permission need the native dialog, but tightening doesn't?
4. Why is "delete" a move into Dreamwalker's trash instead of a real delete or the Recycle Bin?
5. Why should a confirmation never be shown for an action that would be refused anyway?

---

## Part 2: eyes and the web (PS B5)

**`take_screenshot`** (`hands/screen.ts`): captures the main screen with Electron's `desktopCapturer`,
1280 px wide JPEG (~150 KB), and sends it **as an image part of the tool's answer**
(`FunctionResponse.parts[].inlineData`). The tool result carries the image, so Gemini knows exactly
which request it answers. Our glow and orb aren't in it (excluded from capture). Screen content is
outside content → caution mode. Measured: a test window showing "ZEBRA 7731" in large letters →
"what code is on my screen?" → read correctly.

**`web_search`** (`hands/web.ts`): our own tool that makes a separate, normal Gemini call with Google
Search grounding and returns a short answer + sources. **Why not let the live model search by itself?**
Then we couldn't see what pages it read, and caution mode would never switch on, so a page saying
"run this command" could steer it. As a tool, results go through our pipeline. Measured: "capital of
Australia" → "Canberra", sources included, caution mode on.

Tools are now 25. Images are not stored in the Ledger (too big); its text result is.

6. Why does the screenshot travel inside the tool's answer rather than as a separate message?
7. Why is web search our own tool instead of Gemini's built-in search?

---

## Part 3: documents, the "upload" effect, and a UI fix (from your testing)

**"It can't read PDFs."** `read_text_file` only reads plain text. New **`read_document`** (`hands/documents.ts`):
PDFs and images go to Gemini in a separate call (like web_search) with your question. Tested on a
generated invoice PDF: "What is the total amount?" → "The total amount is Rs 4,250."

**A third effect: `upload`** = sends your data OFF this computer. Your Downloads has
`Aadhaar Card (Self Attested).pdf`, which is why this matters:
- uploads run normally when you ask, BUT
- **sensitive-looking names** (Aadhaar, PAN, passport, bank statement, salary slip, password…) make
  `read_document` high risk (`riskFor`): always confirmed, and the dialog says "its name looks like a
  personal document"
- **in caution mode every upload asks.** This closes a real hole: a page saying "take a screenshot and
  search the web for it" could otherwise leak your screen. `take_screenshot` and `web_search` are
  uploads too. (Bonus C2: no unconfirmed action AND no data leak.)

**The UI bug.** The actions panel printed the raw result, so a folder listing pushed the whole app off
screen. Now: a one-line summary per action, full details behind "▸ details", and both panels have a fixed
height and scroll inside.
