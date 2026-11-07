# Build log 6 — M1 part 3: the edge glow, and "one Dreamwalker at a time"

While the agent is listening, thinking or speaking, the **edges of your whole screen glow**, even
when Dreamwalker's window is hidden behind other apps. Blue = listening, amber = thinking, green =
speaking, and the glow pulses with the voice volume.

## How it's built

| Piece | File | Job |
|---|---|---|
| The glow window | `main/overlay.ts` | Transparent, full-screen, click-through, always on top, never takes focus, hidden from screen capture |
| The glow page | `renderer/overlay.html`, `renderer/overlay/` | One element + CSS. No React: it must animate smoothly at 60 fps |
| Its preload | `preload/overlay.ts` | Can only **receive** state + volume. Least privilege |
| Volume | `audio/mouth.ts`, `audio/ear.ts` | An `AnalyserNode` reads the sound wave; RMS ("root mean square") = how loud |
| Wiring | `main/index.ts` | Brain state → glow; main window sends volume ~30×/s → main forwards it |

### The window settings that make it work
```ts
transparent: true, backgroundColor: '#00000000'  // only what we draw is visible
focusable: false                                 // can never steal your keyboard focus
win.setAlwaysOnTop(true, 'screen-saver')         // above everything, even full-screen apps
win.setIgnoreMouseEvents(true)                   // every click passes through to the app below
win.setContentProtection(true)                   // excluded from screenshots/recordings
win.showInactive()                               // appear without taking focus
```
When idle, it fades out, then is hidden, so it costs nothing.

### Smoothing the pulse
Volume arrives ~30×/s and is jumpy. Every animation frame (60/s), the glow moves toward the target
level: **fast when rising** (feels responsive), **slow when falling** (feels calm). This is
exponential smoothing: `shown += (target − shown) × rate`.

## Measured
| Check | Result |
|---|---|
| Glow state while the agent speaks | `speaking`, opacity 1, level 0.159 following the voice |
| Glow render (its own page) | ring + haze on all four edges |
| A normal desktop screenshot at the same moment | **no glow visible**: excluded from capture ✅ |

## Two bugs found while building it

**1. A shared chunk would have broken both windows.** Both preloads imported the channel names, so
the bundler moved them into a separate `chunks/ipc-….js` file. A **sandboxed preload can't load
other files**. Fix: the overlay preload uses a **type-only** import (`import type`), which is checked
at compile time and disappears from the bundle. Each preload is again one file that requires only `electron`.

**2. Two Dreamwalkers at once.** Testing next to your `npm run dev` copy gave
`Unable to move the cache: Access is denied` and audio-device errors. Two copies fight over files,
mic and speakers, and **both would answer the wake word**. Fix: `app.requestSingleInstanceLock()`.
A second launch focuses the first window and quits. Tests use `DREAMWALKER_PROFILE=test` for their
own data folder (and so their own lock).

## Processes, again (your question)
`spawn()` asks Windows to start a **new process**, which gets **its own PID and its own memory**.
Measured: `node.exe` 55 MB, the `powershell.exe` it started 78 MB, side by side. The parent never
"hosts" the child. Danger is only code run **inside** main (`eval`, `require` of untrusted code,
`execSync` freezing the event loop).

## Questions
1. Why can't the glow window have `focusable: true`? What would happen every time it appeared?
2. Why is content protection important for *this* project specifically (think B5 and C1)?
3. Why does a sandboxed preload have to be a single file, and how did a type-only import fix it?
4. What exactly goes wrong if two Dreamwalkers run at once? Name three things.

---

# Part 2: the system tray, the floating companion, and "close = hide"

## What it does
- **Tray icon** (by the clock). Its colour follows the state. It's **drawn in code**: a dot encoded
  as a PNG with Node's built-in `zlib` (`main/trayIcon.ts`), so there are no image files and it can
  change colour live. Menu: Open · Listen for wake word · Edge glow · Floating companion · Quit.
- **Companion orb** (`main/companion.ts`, `renderer/companion/`): 112 px, always on top, bottom-right.
  **Click** the core = open Dreamwalker. **Drag** the ring = move it. **Right-click** = the same menu as the tray.
  Its preload can do exactly two things: ask to open the main window, ask for the menu.
- **Closing the main window hides it.** Dreamwalker keeps running in the tray and keeps listening
  (answer to the Phase 0 question). Only **Quit** exits.

## Design details worth defending
- **Drag vs click on one small orb:** `-webkit-app-region: drag` makes Windows treat the ring like a
  title bar (drag to move), but drag regions swallow clicks. So the core opts out with `no-drag` and is
  a normal button.
- **Main checks who's asking:** every IPC message carries its sender. `companion:open` and
  `companion:menu` are only obeyed when they come from the companion window itself (`companion.owns()`).
- **One validator for settings:** the UI (over IPC) and the tray menu both call `applySettings()`.
  Two copies of validation logic always drift apart.
- **`backgroundThrottling: false` on the main window:** the mic and speakers live there, and Chromium
  would otherwise slow down timers in a hidden window.

## Measured (debug hooks: `DREAMWALKER_DEBUG=1`)
| Step | Main window | Companion |
|---|---|---|
| start | visible | visible |
| click X | **hidden**, app still running | visible |
| click the orb | **visible** again | visible |
| companion off / on | unchanged | hidden / visible |
| **"Hey Dreamwalker, what time is it?" while hidden** | woke, heard it, ran the tool ✅ | |

## Bugs found while testing
1. **A page-side `window.close()` skips the `close` event** (Electron treats it as the page closing
   itself). The real X button goes through `BrowserWindow.close()`, which fires it. The test was
   changed to use that path (`debugCloseMain`).
2. **Destroyed windows:** if the companion or glow window gets closed, the classes now forget it and
   recreate it when needed. Sending to a destroyed window throws "Object has been destroyed".
3. **`document.visibilityState` lies when `backgroundThrottling` is off.** Electron keeps it
   "visible" by design, so visibility is checked in main (`debugWindows`).

## More questions
5. Why can't the companion's whole orb be a drag region?
6. Why does main check `event.sender` for the companion's messages? What could happen otherwise?
7. Why must the main window keep running (not be destroyed) when you click X?
