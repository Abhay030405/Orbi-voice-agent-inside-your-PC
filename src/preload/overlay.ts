// PRELOAD for the edge-glow window. Least privilege: it can only RECEIVE the agent's state, the
// current loudness and the colour theme. No sending, no settings, nothing else, because a full-screen window has no
// business doing anything but drawing.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
// TYPE-only import, on purpose. A normal import of `IPC` would make the bundler move the shared
// constants into a separate chunk file that BOTH preloads load, and a sandboxed preload can't load
// other files (it must be one self-contained file). The annotations below still make TypeScript
// check that these strings match the contract in shared/ipc.ts.
import type { IPC, OverlayApi } from '../shared/ipc'

const STATE_CHANNEL: (typeof IPC)['overlayState'] = 'overlay:state'
const LEVEL_CHANNEL: (typeof IPC)['overlayLevel'] = 'overlay:level'
const THEME_CHANNEL: (typeof IPC)['overlayTheme'] = 'overlay:theme'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: OverlayApi = {
  onState: (callback) => subscribe(STATE_CHANNEL, callback),
  onLevel: (callback) => subscribe(LEVEL_CHANNEL, callback),
  onTheme: (callback) => subscribe(THEME_CHANNEL, callback)
}

contextBridge.exposeInMainWorld('dreamwalkerOverlay', api)
