# 02 — Electron: how a desktop app actually works

## The problem

A website runs inside the browser's **sandbox**. That's a wall on purpose: a random site must
not be able to read your files or kill your processes. Our app needs to do exactly those things:
open apps, change volume, delete files, run commands, talk to a phone over USB.

So we need **two things at once**:
- a nice UI (we know how to do that: React)
- full access to the operating system (a website can't)

## The options

| Option | UI | OS access | For us |
|---|---|---|---|
| Plain website | React | ❌ none | Useless for this PS |
| Python (PySide/Tkinter) | New UI toolkit to learn | ✅ | New language + new UI library, during a hackathon |
| Tauri | React | ✅ via **Rust** | Have to learn Rust. Too much at once |
| Flutter / .NET / JavaFX | New language | ✅ | Same problem |
| **Electron** | **React** | ✅ via **Node.js** | Reuses what you know. **Chosen** |

Bonus reason specific to this PS: Electron's UI side is Chromium, and Chromium's mic API has
**echo cancellation** built in. Without it, the assistant hears its own voice from the speakers
and thinks you're interrupting it. In Python we'd have to build that ourselves.

## The big idea: two kinds of processes

First, an OS fundamental. A **process** is a running program with its **own private memory**. Two
processes can't read each other's variables. To talk, they must send messages. That's called
**IPC: Inter-Process Communication**.

An Electron app is several processes:

```
┌────────────────────────────── Your Electron app ──────────────────────────────┐
│                                                                               │
│   MAIN process (Node.js)                    RENDERER process (Chromium)       │
│   ─────────────────────                     ──────────────────────────        │
│   • exactly ONE                             • one per window                  │
│   • full OS access: files, shell,           • runs React = your UI            │
│     processes, network, USB/adb             • mic + speaker (Web Audio)       │
│   • creates windows                         • sandboxed like a website        │
│   • our "brain + hands" live here           • CANNOT touch the OS directly    │
│                                                                               │
│              ▲                                          ▲                     │
│              │            IPC messages                  │                     │
│              └──────────────── PRELOAD ─────────────────┘                     │
│                        (tiny bridge script)                                   │
│                  exposes ONLY the functions we choose                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Main process:** a normal Node.js program. Anything Node can do, it can do: `fs` for files,
  `child_process` for running commands, `net` for sockets. This is where tools, the ledger
  (database), the phone connection and the AI session live.
- **Renderer process:** basically a Chrome tab showing your React app. It's sandboxed. It can't
  `require('fs')`. This is where the UI and the **audio** (mic in, speaker out) live.
- **Preload script:** runs before React loads and builds a **small, explicit bridge**:
  `window.dreamwalker.confirm(id)`, `window.dreamwalker.onStateChange(cb)`, etc. The renderer can
  only call what the preload exposes. Nothing else.

### Why the split is a security feature (viva answer)

Our app reads untrusted stuff: web pages, documents, text on screen. The PS literally says judges
will hide malicious instructions in documents. If the UI process had full OS access, then **any
bug that lets content run code in the UI** (an XSS bug, like in websites) would mean "attacker
can delete your files".

With the split, the UI can only press the few buttons the preload exposes. The dangerous power
stays in main, behind our permission checks. This is **least privilege**: give each part only the
power it needs. Same idea as not running everything as root/admin.

The Electron settings that enforce this (we'll set them in phase 0):
- `contextIsolation: true`: the preload's world and the page's world are separate
- `nodeIntegration: false`: no `require` in the renderer
- `sandbox: true`: the renderer is sandboxed like a normal Chrome tab

## IPC in 30 seconds

Two styles. You'll use both:

```ts
// 1. Request → response (like fetch): renderer asks, main answers
//    renderer:
const result = await window.dreamwalker.getLedger()
//    main:
ipcMain.handle('ledger:get', () => ledger.recent(50))

// 2. Events (like a WebSocket push): main tells renderer something happened
//    main:
win.webContents.send('agent:state', 'speaking')
//    renderer:
window.dreamwalker.onState((s) => setState(s))
```

For **audio** (a 20 ms chunk, ~50 times a second) we'll use a faster channel called a
`MessagePort`, which can hand over binary buffers without copying them. Details in phase 1.

## Where React fits

Exactly like your websites: components, `useState`, hooks. The only difference is that instead
of `fetch('/api/...')` to a server, you call `window.dreamwalker.something()`, and the "server"
is the main process on the same machine.

| Website world | Electron world |
|---|---|
| Browser tab | Renderer process |
| Backend server (Express) | Main process |
| HTTP / fetch | IPC (`invoke` / `handle`) |
| WebSocket push | `webContents.send` events |
| API routes you choose to expose | Preload bridge you choose to expose |

You already understand this architecture. Electron just runs the "server" on the user's own
machine.

---

## Questions (answer in `docs/exercises/your-answers.md`)

1. In your own words: what's a process, and why can't the renderer just read a variable from the
   main process?
2. Your friend says "Electron is just a website wrapped as an exe." Give two concrete things our
   app does that a website **cannot**, and say which process does them.
3. Why do we put the mic and speaker code in the **renderer** and not in main? (Hint: echo.)
4. A judge hides `<img src=x onerror="deleteAllFiles()">` in a document the app displays. With
   `contextIsolation` + `sandbox` on, why does nothing bad happen?
5. Map it: which Electron piece is like your Express backend, and which is like your API routes?
