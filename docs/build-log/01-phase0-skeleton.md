# Build log 1 — Phase 0: the skeleton, file by file

Goal of this phase: an Electron window running React, with a secure bridge, where the UI shows
data that **only the main process can get**. If that works, the two-process model from
`docs/guide/02-electron.md` is real and working.

## Run it

```bash
cd C:\Projects\dreamwalker
npm run dev        # opens the app. Renderer edits reload instantly; main/preload edits
                   #   rebuild and restart the app (that's the --watch flag in package.json)
npm run typecheck  # TypeScript checks both worlds (Node + browser)
npm run build      # production bundles into out/
```

You should see your hostname, CPU count and memory (asked from main), a free-memory line ticking
every second (pushed by main), and "Can this page use require? ✅ No".

---

## The map

```
dreamwalker/
├─ package.json             scripts + dependencies. "main" points Electron at out/main/index.js
├─ electron.vite.config.ts  builds 3 bundles: main, preload, renderer
├─ tsconfig.json            just points to the two below
├─ tsconfig.node.json       TypeScript rules for main + preload (Node world)
├─ tsconfig.web.json        TypeScript rules for renderer (browser world)
└─ src/
   ├─ shared/ipc.ts         THE CONTRACT: channel names + types both sides agree on
   ├─ main/index.ts         window creation, security switches, IPC handlers, heartbeat
   ├─ preload/index.ts      builds window.dreamwalker (the only door between the worlds)
   └─ renderer/
      ├─ index.html         page shell + Content-Security-Policy
      ├─ env.d.ts           tells TypeScript window.dreamwalker exists
      ├─ main.tsx           React entry (same as any Vite React app)
      └─ App.tsx            the UI
```

---

## Trace one call: `getSystemInfo()`, through 4 files

```
App.tsx              window.dreamwalker.getSystemInfo()
   │                   (looks like calling an API from React)
   ▼
preload/index.ts     ipcRenderer.invoke('system:get-info')
   │                   (puts a message in the IPC pipe and waits for the reply)
   ▼  ── process boundary: renderer → main ──
main/index.ts        ipcMain.handle('system:get-info', () => ({ hostname: os.hostname(), ... }))
   │                   (Node code: allowed to call os.hostname())
   ▼  ── reply travels back ──
App.tsx              .then(setInfo) → React re-renders
```

And `shared/ipc.ts` sits beside all of them, defining the channel name and the `SystemInfo`
shape so all three files agree.

**Website analogy:** `App.tsx` = frontend `fetch`, preload = the API client, `ipcMain.handle` =
an Express route, `shared/ipc.ts` = the API's TypeScript types.

The heartbeat is the reverse direction: main calls `webContents.send(...)` every second, the
preload's `ipcRenderer.on` receives it, and React's state updates. No request needed. This style
will carry "listening / thinking / speaking" in Phase 1.

---

## Recipe: add a new main → renderer event

Use this every time main needs to **push** something to the UI without being asked: agent state
changes, transcript text, "tool started", "tool finished", etc. Same 4 places, same order, every
time. Example: an `agent:state` event (we'll actually need this one in Phase 1).

**Step 1: `shared/ipc.ts`, the contract**
```ts
export const IPC = {
  // ...existing channels...
  agentState: 'agent:state'                 // 1a. the address
} as const

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking'   // 1b. the payload shape

export interface DreamwalkerApi {
  // ...existing...
  onAgentState(callback: (state: AgentState) => void): () => void          // 1c. the subscription
}
```
Naming convention: events the UI *listens to* start with `on...` and **return an unsubscribe
function**.

**Step 2: `main/index.ts`, the sender**
```ts
function emitAgentState(win: BrowserWindow, state: AgentState): void {
  win.webContents.send(IPC.agentState, state)
}
// later, anywhere in main:  emitAgentState(win, 'listening')
```
Why wrap `send` in a function? `webContents.send(channel, ...args)` accepts **anything**; it isn't
typed. If you call it directly you could send `'listning'` (typo) or a number and TypeScript
wouldn't notice. The wrapper's parameter type `state: AgentState` makes the compiler check every
call. (Same reason the heartbeat code writes `const beat: Heartbeat = {...}` before sending.)

**Step 3: `preload/index.ts`, the receiver**
```ts
onAgentState: (callback) => {
  const listener = (_event: IpcRendererEvent, state: AgentState): void => callback(state)
  ipcRenderer.on(IPC.agentState, listener)
  return () => ipcRenderer.removeListener(IPC.agentState, listener)
}
```
This is the **same shape every time**: wrap → `on` → return a remover. Only the channel and the
payload type change. (The wrapper hides the raw `_event` object from the page.)

**Step 4: `App.tsx`, the consumer**
```tsx
const [state, setState] = useState<AgentState>('idle')
useEffect(() => window.dreamwalker.onAgentState(setState), [])
```
The `useEffect` returns the unsubscribe function, so React removes the listener on unmount.

### Rules for what you can send

- **Only plain data crosses the process boundary**: strings, numbers, booleans, plain
  objects, arrays, `Date`, `Uint8Array`/buffers. Electron copies the value into the other process
  (the "structured clone" algorithm), like `JSON.stringify` but smarter.
- **Functions, class instances with methods, and DOM objects can't be sent.** A function can't
  be copied into another process's memory. If you need the renderer to "call back", that's a
  separate IPC channel.
- **Changing a payload shape means restarting main.** The renderer hot-reloads, but main is a
  separate process running the old code until it restarts. With `--watch`, electron-vite does that
  restart for you.

### The three IPC directions (cheat sheet)

| Direction | Renderer side (preload) | Main side | Use for |
|---|---|---|---|
| Renderer asks, main answers | `ipcRenderer.invoke(ch, args)` → Promise | `ipcMain.handle(ch, fn)` | "get me X", "do Y and tell me the result" |
| Main pushes, renderer listens | `ipcRenderer.on(ch, listener)` | `win.webContents.send(ch, data)` | state changes, live updates |
| Renderer tells main, no reply | `ipcRenderer.send(ch, data)` | `ipcMain.on(ch, fn)` | fire-and-forget (we'll rarely use this) |

---

## Five design choices in these files (viva material)

**1. Why two tsconfigs?**
Main runs in Node (has `fs`, no `window`). Renderer runs in Chromium (has `window`, no `fs`). With
one shared config TypeScript would happily let you write `require('fs')` in React. It would
compile and then crash at runtime, because the sandbox blocks it. Two configs make that mistake a
**compile error**. Catching bugs at compile time instead of runtime is the whole point of
TypeScript.

**2. Why `shared/ipc.ts`?**
Channel names are strings. A typo (`'system:get-inf'`) wouldn't error; the call would just hang
forever. Defining them once and importing them everywhere means a typo can't happen, and changing
a message shape breaks the build on both sides instead of silently at runtime.

**3. Why never `exposeInMainWorld('ipc', ipcRenderer)`?**
That hands the page a raw pipe to main: any channel, any message. A single injected script could
then call any handler. We expose **specific functions** instead. Least privilege again.

**4. Why block navigation and new windows?**
Later the app shows untrusted content (web search results, documents). If a malicious link
navigated our window to `evil.com`, that page would be running inside our app. One line each
in `main/index.ts` stops it.

**5. Why a Content-Security-Policy in `index.html`?**
Even if untrusted text somehow ended up injected as HTML, CSP stops the browser from loading any
script that isn't from our own bundle. It's a second wall behind React's own escaping.
Defence in depth.

Small lesson from setup: new npm versions **block packages' install scripts** unless you approve
them, a defence against supply-chain attacks (malicious packages running code during
`npm install`). Electron 44 doesn't need one; it downloads Chromium the first time it runs.

---

## Your exercise (you write this, I review)

### Exercise 1: add `getUptime()` end to end (required)

Make the UI show "Laptop uptime: N minutes", using Node's `os.uptime()` (returns seconds).

Do it in this order and **watch what TypeScript does after each step**:
1. `shared/ipc.ts`: add a channel name to `IPC` and `getUptime(): Promise<number>` to `DreamwalkerApi`.
2. Run `npm run typecheck`. **It fails in the preload.** Read the error. Why does it fail there?
3. `preload/index.ts`: add the function.
4. `main/index.ts`: add the `ipcMain.handle`.
5. `App.tsx`: call it and show it.

Lesson: the compiler becomes your checklist. Once you add something to the contract, TypeScript
tells you every place that has to change. That's how we'll add 10+ tools without forgetting a
piece.

### Exercise 2: the `agent:state` event

*(This used to be `openUrl` on the bridge. Abhay pointed out that tools should never be on
`window.dreamwalker` at all: the Gemini connection lives in main, so tool calls go
Link → Brain → Gatekeeper → Hands without touching the renderer. Not exposing them shrinks the
attack surface. `openUrl` comes back in Phase 3 as an internal tool, and it still validates
`https:`, because a prompt-injected AI is also an untrusted caller.)*

Follow the **"Recipe: add a new main → renderer event"** above to add `agent:state`:
1. Contract in `shared/ipc.ts` (channel, `AgentState` type, `onAgentState` in `DreamwalkerApi`).
2. Run `npm run typecheck`. **Read the preload error.**
3. Preload receiver.
4. Main sender `emitAgentState(win, state)`. For now, fake it: cycle
   idle → listening → thinking → speaking every 2 seconds with a `setInterval`
   (Phase 1 replaces this with real states).
5. `App.tsx`: show the current state big at the top, with a different colour per state.

Question to think about: **`confirm(actionId)` will be the most dangerous function on the
bridge.** If a page script can call it, it can approve deletions by itself. How can main be sure
a "yes" came from a real human?

---

## Questions (answer in chat when you're done)

1. Exercise 1, step 2: why did TypeScript complain about the **preload**, not about main or App?
2. Exercise 2: how can main be sure a confirmation came from a real human, not a page script?
3. The heartbeat's `useEffect` returns `window.dreamwalker.onHeartbeat(setBeat)`. What would
   go wrong if `onHeartbeat` didn't return an unsubscribe function? (Hint: React StrictMode runs
   effects twice in dev.)
