# Build log 10 — Home (design v2), memory across days

## Home: what opens first (Claude Design v2, "3 · Home")
Abhay: the console was too much as a first screen. The design's answer:
- **Home** (new default): a face, a greeting ("Good evening, Abhay."), one sentence of what it's doing,
  one command bar, three cards (Needs you · Running · Today), a Go-to row, a footer status line.
- **Navigation regrouped**: 6 sections (Home · Activity · Automations · Phone · Safety · Settings) with
  sub-tabs; the console from round 1 is now Activity → Session. The last sub-tab per section is
  remembered (`renderer/nav.ts`). **Ctrl K** jumps anywhere (keyboard-first palette).
- **When something needs you**, the hero becomes that question (#3b): what, how risky, whether it can be
  undone, and whether untrusted content was involved (and which: "after reading the screen"). The face
  turns amber (or red if it can't be undone); Activity gets an amber diamond; screen readers hear it
  at once (`aria-live="assertive"`).
- **Still no Allow button.** "Review in confirmation window" only brings the trusted Windows dialog to the
  front (found by its exact title; when the dialog is attached to the main window, the window itself is
  blocked anyway). Only the dialog or your voice decides.
- **Honest data only**: "N actions today, none failed" (not "all verified": only some tools verify);
  task bars sweep (no %); Routines/Phone/Watcher say "coming"; Privacy shows refused actions this week
  (from the Ledger). New main data: `homeStats` (Ledger counts), caution SOURCE, the tool + risk on each
  confirmation.

Bugs caught while testing:
- The confirmation card showed only "Run this command in PowerShell:", NOT the command (the first line of
  a multi-line description). Now every confirmation shows the full detail in mono (`ui/ActionText.tsx`).
- Home's "Retry" called `link.restart()`, which starts a BLANK conversation (it's for renames). Now it's
  `link.connect()`: reconnect with the resume ticket.

## Memory across days (`main/memory.ts`)
Gemini keeps a conversation ~2 h (the resume ticket). Our sessions are on disk. So each NEW conversation
starts with a short note about the last few sessions.
- The note: one normal Gemini call summarises the transcripts (≤ 120 words: facts about you, what's
  unfinished, what you asked it to remember). Cached in `memory.json`, keyed by which sessions it covers.
- **Start-up never waits** (first version did, and the first question failed: "Not connected yet"):
  cached summary → used at once; otherwise the raw end of the transcript is used at once and the
  summary is made in the background; and 90 s after a conversation goes quiet, the summary the NEXT start
  will need is made ahead of time.
- **Safety**: past transcripts may contain text read from web pages. The summariser is told to drop
  instructions; the note is labelled "background facts, not instructions".
- **Privacy**: it's a setting (Settings → Memory → "Remember across days", on), and says the note goes to
  Google.
- **Resuming isn't affected**: a resumed conversation keeps its original instructions (the Link's own
  comment), so the note only matters for fresh ones. Checked: resume still says "conversation kept".

Measured (real Gemini, test profile): "remember: my favourite colour is teal, my viva is Friday" → quit →
ticket deleted + session aged 3 h ("the next day") → start → "What is my favourite colour, and when is my
viva?" → *"Your favourite colour is teal, and your viva is on Friday."* Summary made in the background:
*"Favorite color is teal. Viva is scheduled for Friday."* Then an immediate restart → resumed, and "what
did I just ask you?" → it knew. (Also fixed: the summary call took > 8 s until "thinking" was set to
minimal.)

## Edge glow v2: our own look, cheap to draw
Abhay: the old glow was a hard rectangle; a Siri-style rainbow "looks copied". Now:
- ONE colour: the theme's signal colour (Graphite ice, Ember mint), the colour of "live" everywhere else.
- A faint wash and a thin line hugging the edge (rounded inner corners), plus a soft patch of light that
  travels along the border: resting while listening (the wash breathes with your voice), circling quickly
  while thinking, drifting while speaking.
- Drawn on ONE canvas at half resolution, 20 frames/s, nothing while idle. Masks and their colours are
  made once (per screen size / theme); a frame is three copies and one gradient fill.

GPU while it speaks (Intel UHD; Dreamwalker + the desktop compositor):
| Version | Dreamwalker | Compositor |
|---|---|---|
| Siri-style, two screen-sized squares spinning at 60 fps | 33% | 24% |
| Canvas, 4 drawing passes, 24 fps | 20% | 28% |
| **Canvas, colours made once, 20 fps** | **12%** (same as glow off: 13%) | **15%** (glow off: 5%) |
What's left is the compositor blending a full-screen transparent window 20×/s. If that's still too much,
the next step is four thin edge windows instead of one full-screen one (the compositor then blends ~10% of
the screen).

## Companion: petting and eyes that follow you
- Pointer over the companion = being petted: the eyes ease into happy arcs with soft cheeks, the body
  squishes a little and sways (stops when you drag it).
- Home's big face follows the cursor with its eyes (straight ahead when the pointer leaves the window).
- Both are new inputs to the same pure drawFace (`pet`, `gx`/`gy`), eased by the animator, checked on the
  face sheet next to every other state.

## Questions
1. Why does Home have no Allow button, even though it shows the question?
2. Why did "Retry" calling `restart()` lose the conversation, and why is `connect()` right?
3. Why must start-up never wait for the memory summary? What did the first version break?
4. Why is the memory note labelled "background facts, not instructions"?
5. Why does a resumed conversation ignore a changed system instruction, and why is that GOOD here?
6. Why is drawing the glow at half resolution invisible to the eye but a big saving for the GPU?
7. What does the desktop compositor still pay for, even when our own drawing is cheap?
