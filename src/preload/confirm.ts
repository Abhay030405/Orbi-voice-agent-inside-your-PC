// PRELOAD for the confirmation window. It can receive the question, and send ONE answer to it (plus its
// content height, so the window fits). Main believes answers from this window only, for the question
// it is showing right now (main/gatekeeper/confirmWindow.ts).
// Type-only import for the same reason as preload/overlay.ts: each sandboxed preload must be a
// single self-contained file.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ConfirmApi, ConfirmView, IPC } from '../shared/ipc'

const SHOW: (typeof IPC)['confirmShow'] = 'confirm:show'
const ANSWER: (typeof IPC)['confirmAnswer'] = 'confirm:answer'
const SIZE: (typeof IPC)['confirmSize'] = 'confirm:size'

const api: ConfirmApi = {
  onShow: (callback) => {
    const listener = (_event: IpcRendererEvent, view: ConfirmView): void => callback(view)
    ipcRenderer.on(SHOW, listener)
    return () => ipcRenderer.removeListener(SHOW, listener)
  },
  answer: (id, answer) => ipcRenderer.send(ANSWER, id, answer),
  fit: (height) => ipcRenderer.send(SIZE, height)
}

contextBridge.exposeInMainWorld('dreamwalkerConfirm', api)
