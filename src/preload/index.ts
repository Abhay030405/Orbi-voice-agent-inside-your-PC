// PRELOAD: the bridge. Runs before the page loads, with access to a small part of Electron.
// Its only job: build `window.dreamwalker` with exactly the functions in DreamwalkerApi.
//
// Rule: NEVER expose ipcRenderer itself (e.g. `exposeInMainWorld('ipc', ipcRenderer)`).
// That would let any script in the page send ANY message on ANY channel, which defeats the
// whole point of the bridge. Expose specific functions with specific channels only.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type DreamwalkerApi } from '../shared/ipc'

// Every subscription is the same shape: wrap the callback (so the page never sees the raw
// IpcRendererEvent, which carries Electron internals), listen, and return a remover.
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DreamwalkerApi = {
  getSystemInfo: () => ipcRenderer.invoke(IPC.getSystemInfo),
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  getRecentActions: (limit) => ipcRenderer.invoke(IPC.getRecentActions, limit),
  sayText: (text) => ipcRenderer.invoke(IPC.sayText, text),
  playTestTone: () => ipcRenderer.invoke(IPC.playTestTone),
  setMuted: (muted) => ipcRenderer.invoke(IPC.setMuted, muted),
  undoAction: (ledgerId) => ipcRenderer.invoke(IPC.undoAction, ledgerId),
  cancelTask: (taskId) => ipcRenderer.invoke(IPC.cancelTask, taskId),
  listTools: () => ipcRenderer.invoke(IPC.listTools),
  copySession: () => ipcRenderer.invoke(IPC.copySession),
  homeStats: () => ipcRenderer.invoke(IPC.homeStats),
  refreshPhone: () => ipcRenderer.invoke(IPC.refreshPhone),
  retryConnection: () => ipcRenderer.invoke(IPC.retryConnection),
  focusConfirmation: () => ipcRenderer.invoke(IPC.focusConfirmation),
  remoteInfo: () => ipcRenderer.invoke(IPC.remoteInfo),
  debugDropLink: () => ipcRenderer.invoke(IPC.debugDropLink),
  debugCloseMain: () => ipcRenderer.invoke(IPC.debugCloseMain),
  debugWindows: () => ipcRenderer.invoke(IPC.debugWindows),
  debugCallTool: (name, args, retry) => ipcRenderer.invoke(IPC.debugCallTool, name, args, retry),
  debugInjectAudio: (pcm) => ipcRenderer.invoke(IPC.debugInjectAudio, pcm),

  onHeartbeat: (callback) => subscribe(IPC.heartbeat, callback),
  onAgentState: (callback) => subscribe(IPC.agentState, callback),
  onLinkStatus: (callback) => subscribe(IPC.linkStatus, callback),
  onAudioChunk: (callback) => subscribe(IPC.audioChunk, callback),
  onToolActivity: (callback) => subscribe(IPC.toolActivity, callback),
  onAudioInterrupted: (callback) => subscribe(IPC.audioInterrupted, callback),
  onTranscript: (callback) => subscribe(IPC.transcript, callback),
  onSettings: (callback) => subscribe(IPC.settings, callback),
  onWakeStatus: (callback) => subscribe(IPC.wakeStatus, callback),
  onWoke: (callback) => subscribe(IPC.woke, callback),
  onTasks: (callback) => subscribe(IPC.tasks, callback),
  onPresence: (callback) => subscribe(IPC.presence, callback),
  onSessionEvent: (callback) => subscribe(IPC.sessionEvent, callback),
  onHealth: (callback) => subscribe(IPC.health, callback),
  onRemoteStatus: (callback) => subscribe(IPC.remoteStatus, callback),
  onPhoneStatus: (callback) => subscribe(IPC.phoneStatus, callback),
  onWindowVisible: (callback) => subscribe(IPC.windowVisible, callback),

  playbackDone: () => ipcRenderer.send(IPC.playbackDone),
  reportLevel: (level) => ipcRenderer.send(IPC.audioLevel, level),
  micStart: () => ipcRenderer.send(IPC.micStart),
  micAudio: (pcm) => ipcRenderer.send(IPC.micAudio, pcm),
  micStop: () => ipcRenderer.send(IPC.micStop),
  wakeNow: () => ipcRenderer.send(IPC.wakeNow),
  endConversation: () => ipcRenderer.send(IPC.endConversation),
  stopReply: () => ipcRenderer.send(IPC.stopReply),
  onStartTalking: (callback) => subscribe(IPC.startTalking, callback)
}

contextBridge.exposeInMainWorld('dreamwalker', api)
