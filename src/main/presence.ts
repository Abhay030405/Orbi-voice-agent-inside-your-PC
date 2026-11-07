// PRESENCE: what the face shows, worked out in ONE place from everything main knows.
// Guide: docs/build-log/09-ui.md.
//
// The Brain only knows four states (idle/listening/thinking/speaking). The face says more: that a tool
// is running (and which kind), that it needs you, that the connection dropped, that the mic is muted.
// If each window worked this out for itself, the companion and the main window could disagree. So main
// computes it here and pushes the result; the windows only draw it.
//
// Pure function, no Electron: unit-tested in presence.test.ts.

import type { AgentState, FaceState, FaceTool, LinkStatus } from '../shared/ipc'
import { morphFor } from '../shared/morph.ts'

export interface PresenceInputs {
  agent: AgentState
  link: LinkStatus
  muted: boolean
  tool: string | null // the tool running right now, if any
  asking: { action: string; irreversible: boolean } | null // an open confirmation
  tasksRunning: number
  tainted: boolean // caution mode for the current request
  taintedBy: string | null // the tool that brought the outside content in
}

export interface Face {
  face: FaceState
  tool: FaceTool | null
  caution: boolean
  cautionSource: string | null
  label: string
}

const TOOL_WORDS: Record<FaceTool, string> = {
  app: 'Working with apps',
  term: 'Running a command',
  web: 'Searching the web',
  file: 'Working with files',
  phone: 'Using the phone',
  screen: 'Looking at the screen',
  click: 'Clicking',
  tile: 'Arranging windows'
}

// Order matters: the first rule that matches wins. "Needs you" beats everything except a dead
// connection, because an open question is the one thing the user must not miss.
export function faceFor(i: PresenceInputs): Face {
  const active = i.agent !== 'idle' || i.tool !== null
  const caution = i.tainted && active
  const cautionSource = caution ? sourceWords(i.taintedBy) : null
  const make = (face: FaceState, label: string, tool: FaceTool | null = null): Face => ({ face, tool, caution, cautionSource, label })

  if (i.link === 'disconnected') return make('offline', 'Offline: no connection to Gemini')
  if (i.asking) {
    return i.asking.irreversible
      ? make('danger', `Needs you (can't be undone): ${i.asking.action}`)
      : make('confirm', `Needs you: ${i.asking.action}`)
  }
  if (i.link === 'reconnecting') return make('reconnecting', 'Reconnecting…')
  if (i.link === 'connecting') return make('reconnecting', 'Connecting…')
  if (i.tool) {
    const morph = morphFor(i.tool)
    return morph ? make('acting', TOOL_WORDS[morph], morph) : make('thinking', 'Working…')
  }
  if (i.muted && i.agent === 'idle') return make('paused', 'Muted: not listening')
  if (i.agent === 'listening') return make('listening', 'Listening')
  if (i.agent === 'thinking') return make('thinking', 'Thinking')
  if (i.agent === 'speaking') return make('speaking', 'Speaking')
  if (i.tasksRunning > 0) {
    return make('task', `Idle · ${i.tasksRunning} task${i.tasksRunning > 1 ? 's' : ''} running`)
  }
  return make('idle', 'Idle')
}

// What outside content a tool brings in, in words ("it just read the screen").
const SOURCES: Record<string, string> = {
  web_search: 'web search results',
  read_document: 'a document',
  read_text_file: 'a file',
  list_folder: 'a folder listing',
  read_clipboard: 'the clipboard',
  take_screenshot: 'the screen',
  phone_screenshot: "your phone's screen",
  phone_notifications: 'your phone notifications',
  phone_list_files: 'file names on your phone',
  pc_ui_elements: "the names of an app's buttons",
  run_command: 'command output',
  list_windows: 'window titles',
  list_tasks: 'task output',
  get_task_output: 'task output',
  task_announcement: 'task output'
}
export function sourceWords(tool: string | null): string | null {
  if (!tool) return null
  return SOURCES[tool] ?? 'outside content'
}
