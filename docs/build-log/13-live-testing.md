# 13 · Live testing with real Gemini (2026-10-19/20)

Unit tests prove the parts. This round drove the **whole app** with real Gemini, by voice, through
about 40 everyday requests: browser, YouTube, Office, files, research, settings and the phone. Almost
every bug below was invisible to the unit tests.

## How it was tested

1. **Out loud first.** Windows' built-in voice (Zira) said "Hey Orbi, …" through the laptop speakers,
   and the app heard it on the real mic. It worked, but only 50–80% of the time: tinny speakers, and
   at volume 42 the mic level was too low for Gemini's voice detector.
2. **Straight into the mic input.** A debug-only hook (`debugInjectAudio`, `DREAMWALKER_DEBUG=1`)
   plays a 16 kHz recording into the *same* place mic audio goes: the wake word, Gemini, and spoken
   yes/no. The real mic is ignored while it plays. Nothing about the app is faked, only the microphone.
3. A driver script speaks a request, then follows the session (heard / tools / questions / reply) over
   the debug port until Orbi is quiet. Flows run in a batch; results go to a log.

Viva line: *"We tested the voice pipeline end to end with real Gemini by injecting recorded speech into
the microphone path. Everything after the mic is the real app."*

## What broke, and the fix

| Found | Why | Fix |
|---|---|---|
| "Hey Orbi" never woke it | "Orbi" split into letter pieces `OR B I`; people say "or-bee" | Several pronunciations per name (04-wake-word.md) |
| VS Code task asked 4 times | A follow-up kept the *previous* request's caution mode (YouTube page) | A follow-up is a new request |
| "Bring Chrome to the front?" | Asked even though nothing can go wrong | `harmless` tools never ask |
| Screenshot asked after reading a page | Treated as a data leak, but it only goes to Gemini, which already read it | `modelOnly` uploads allowed in caution mode; a *search* still asks |
| A new question cancelled the open one (= "no") | One window, replaced | Questions queue; a queued one is skipped if the first yes covers it |
| Spoken "yes" never counted | Gemini sends **no transcript** while its action waits | Local yes/no spotting (same engine as the wake word), "no" wins |
| "Don't do it" heard as YES | The phrase "do it" matched first | "do it" removed from the yes list |
| Clicks refused: "that's Dreamwalker's window" | Our window covered Chrome; Gemini clicked by position | A window's screenshot brings that window forward first |
| YouTube videos not clickable by name | The element list stops at 150 items; YouTube's first 150 are menus | `find` searches up to 1000 controls |
| "Hey" answered, request lost | The follow-up window closed in the middle of "Hey Orbi" | The window stays open while the mic hears speech |
| A YouTube ad "talked" to Orbi | The open mic heard the video, Gemini answered it (once in Hindi) | No follow-up window while another app plays sound (Windows' per-app meters) |
| "I've successfully skipped the ad", no tool called | Confused by the leaked audio | Honesty check in code: a done-claim with no tool call → a correction |
| "I cannot click" after a timeout | It read "denied" as "impossible" | Denials carry a hint: you can, the user just didn't confirm |
| Web search took 11–13 s | Default "thinking" on the search model | Minimal thinking: 3.5–4.8 s, same answers |
| "I can't check the battery" | The tool had no battery | Windows power status + CPU load |
| Word → a .txt file; PowerPoint → "I can't" | No document tool | `create_document` (.docx / .pptx) |
| Word document was 82 words | The voice model wrote the content itself, in a hurry | `about` mode: Gemini Flash drafts it (841 words, 6 sections) |
| Room talk (in Hindi) got answered | The open follow-up mic hears everyone | Proactive audio + "only answer when talked to": 3/3 chatter ignored, 3/3 requests done |
| "Tell me a story about a robot…" → opened Paint | The wake word matched late ("a ro-bot"); Gemini got only the end | 2 s of audio from before the wake word (was 0.5 s) |
| "Close Word, PowerPoint…": 5 questions, most "failed" | Waited for the PROGRAM to exit; Edge's title hides a zero-width space | Close the exact window, check the window; one question listing every window |
| A long test conversation stopped answering | Hundreds of resumed turns | Fresh conversation fixed it; worth a "new conversation" button |

## Numbers

- 40+ flows. After fixes: browser, YouTube, Office, files, research, settings, phone all worked end to end.
- Typical request: 14-20 s from the first word to the end of the spoken answer (TTS speech ~4 s of that).
- Web search 4-5 s. Research agent: plan + 3-5 searches + a 500-word Word document in ~60 s, in the background.
- Questions per PC task: 1 (was 4-5).

## Ideas that came out of it

- **Long jobs as a background agent** (Abhay): "research phones by budget and make a Word doc" runs as a
  background task (`start_research`), while the conversation goes on.
- **Direct tools beat screen driving** for common jobs: two-sum by clicking took 15 steps and 50 s; by
  `create_text_file` + `open_file` it took 2 steps and 21 s. Screen driving stays the fallback for everything else.
