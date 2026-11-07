# Build log 11 — M4: the phone (Android over adb)

**adb** (Android Debug Bridge, Google's own developer tool) talks to a service on the phone over USB or
Wi-Fi ("wireless debugging"). The user turns it on once and taps "Allow" for this PC; Android remembers.
`npm run tools` downloads Google's platform-tools into `resources/platform-tools` (like `npm run models`).

## Pieces
| File | What |
|---|---|
| `main/phone/adb.ts` | runs adb through the safe process runner; `shell()` for text, `execOut()` for bytes (screenshots) |
| `main/phone/parse.ts` (+ test) | pure parsers for adb output, contact/app matching, and the quoting rules |
| `main/phone/link.ts` | finds the phone (USB, connected Wi-Fi, or phones announcing wireless debugging = mDNS), checks it every 30 s in ONE adb call, pushes status on change |
| `main/hands/phone.ts` | 14 tools: status, open app, screenshot, notifications, buttons, tap, swipe, type, call, prepare a text, Do Not Disturb, list/copy files both ways |
| `renderer/pages/PhonePage.tsx` | status + what to say; Home tile and status strip show it live |

## The important ideas
1. **The phone parses commands again.** `adb shell <line>` sends a command LINE that the phone's shell
   (`/system/bin/sh`) re-parses. So a message like `hi; rm -rf /sdcard` would run on the phone. Every
   value goes through `shQuote()` (single quotes; `'` becomes `'\''`) or a strict pattern (package
   names, numbers). Same lesson as the PowerShell runner on the PC (values as data, never as code).
2. **Discovery, not saved addresses.** The wireless-debugging port changes each time it's switched on
   (the address Abhay sent was already stale; adb found the phone by mDNS anyway).
3. **Safety, same as the PC.** Calls are high risk, no undo → always asked, "can't be undone" face.
   Texts are only PREPARED (Android doesn't let adb send SMS silently, and that's a good thing): the user
   sees it and presses send. Notifications, the phone's screen and its file names are outside content →
   caution mode. Files move only between the PC's allowed folders and the phone's own storage (`/sdcard`).
4. **Verify (A3)**: opening an app checks it's really on screen; a call checks the phone's call state;
   Do Not Disturb reads the setting back.
5. **Taps use the screenshot's coordinates** (720 px wide); we scale them to the phone's real pixels.

## Checked against the real phone (Motorola Signature, Android 16, over Wi-Fi), privately
55 launchable apps (WhatsApp, YouTube, Camera, Settings, Chrome, Instagram, Maps all resolved); 9
notifications parsed with titles and text; 4016 contact numbers readable; call state and Do Not Disturb
readable. Only counts and package names were printed, never message text or contacts.
Live tests through Gemini: pending (needs one app copy running).

## First real task: "install Flipkart" (and three fixes it forced)
There's no install tool, so Gemini did it by hand: screenshot, tap, home, open Play Store, tap. It went wrong:
1. **Exactly-once returned the OLD screenshot.** "Same tool + same args in the same request = retry" also
   matched a NEW look after acting, so Gemini tapped blind. Now (`RetryGuard`): identical = retry only if
   NOTHING ELSE happened in between. Gemini's instant duplicates and reconnect replays are still blocked;
   look → tap → look runs again (own ledger key `#2`).
2. **"This can't be undone" (red face) for opening an app.** No undo ≠ irreversible. Three cases now: can
   be undone / nothing permanent / can't be undone (high risk + no undo, e.g. a call). Only the last is red.
3. **A question at every tap.** Caution mode (it looked at the screen) asked each step. Now a tool FAMILY
   ('phone-control': look, tap, swipe, type, keys, open app/store) is covered by ONE yes for the rest of
   the request, low risk only; calls and texts still ask. The question names the source ("it just read
   your phone's screen") instead of a generic list.
4. **Stuck on "thinking"** after the user said no: Gemini never answered. Watchdog: 20 s of silence while
   waiting on Gemini → one nudge; 15 s more → stop waiting, idle, a timeline note.
Plus `phone_open_store`: opens the app's Play Store page, so installing is one tap.
Live check: wake → look → (instant duplicate blocked) → home (asked once, yes) → new look RUNS → back →
Flipkart's store page opened. 1 question for the whole task.

## Questions
1. Why is `adb shell "input text " + text` dangerous, and how does `shQuote` fix it?
2. Why does Dreamwalker discover the phone instead of saving its IP and port?
3. Why does "text Rahul" only prepare the message instead of sending it?
4. Why do notifications switch caution mode on?
5. Why was "same tool + same arguments = retry" wrong for screenshot → tap → screenshot, and what's the new rule?
6. Why does one yes cover low-risk phone taps for the task, but never a call?
