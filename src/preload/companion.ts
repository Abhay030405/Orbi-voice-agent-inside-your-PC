// PRELOAD for the companion. It can receive presence + loudness, and ask main for: open the main
// window, show the menu, stop clicking through (the pointer is over the face), and move the window.
// Nothing else is reachable from this window.
// Type-only import for the same reason as preload/overlay.ts: each sandboxed preload must be a
// single self-contained file.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CompanionApi, IPC } from '../shared/ipc'

const PRESENCE: (typeof IPC)['presence'] = 'presence:changed'
const LEVEL: (typeof IPC)['overlayLevel'] = 'overlay:level'
const OPEN: (typeof IPC)['companionOpen'] = 'companion:open'
const MENU: (typeof IPC)['companionMenu'] = 'companion:menu'
const HOVER: (typeof IPC)['companionHover'] = 'companion:hover'
const DRAG: (typeof IPC)['companionDrag'] = 'companion:drag'
const DRAG_END: (typeof IPC)['companionDragEnd'] = 'companion:drag-end'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: CompanionApi = {
  onPresence: (callback) => subscribe(PRESENCE, callback),
  onLevel: (callback) => subscribe(LEVEL, callback),
  openMain: () => ipcRenderer.send(OPEN),
  showMenu: () => ipcRenderer.send(MENU),
  hover: (over) => ipcRenderer.send(HOVER, over),
  drag: (dx, dy) => ipcRenderer.send(DRAG, dx, dy),
  dragEnd: () => ipcRenderer.send(DRAG_END)
}

contextBridge.exposeInMainWorld('dreamwalkerCompanion', api)
