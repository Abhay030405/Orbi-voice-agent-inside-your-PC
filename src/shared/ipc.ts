// The contract between main and renderer.
//
// Both sides import this file, so if main changes the shape of a message, TypeScript breaks the
// renderer build instead of the app breaking at runtime. Like a typed API spec shared by a
// frontend and backend. Only types and plain constants here: no Node, no DOM.

// Channel names. One place, so a typo can't silently send to a channel nobody listens on.
export const IPC = {
  // renderer asks, main answers (invoke / handle)
  getSystemInfo: 'system:get-info',
  getSnapshot: 'app:get-snapshot',
  updateSettings: 'settings:update',
  getRecentActions: 'ledger:recent',
  sayText: 'link:say-text',
  playTestTone: 'audio:test-tone',
  setMuted: 'mic:set-muted',
  undoAction: 'ledger:undo', // a click on Undo: runs undo_last_action through the normal tool path
  cancelTask: 'tasks:cancel', // a click on Cancel: runs cancel_task the same way
  listTools: 'tools:list',
  copySession: 'session:copy', // put the whole conversation on the clipboard as text
  refreshPhone: 'phone:refresh', // look for the phone again now
  homeStats: 'home:stats', // today's numbers for Home (from the Ledger)
  retryConnection: 'link:retry', // Home's "Retry" when offline
  focusConfirmation: 'confirm:focus', // bring the confirmation dialog to the front (never answers it)
  remoteInfo: 'remote:info', // the phone remote: relay, online, pairing link
  // Only answered when main runs with DREAMWALKER_DEBUG=1 (tests). Otherwise invoke() just fails.
  debugDropLink: 'debug:drop-link',
  debugCloseMain: 'debug:close-main',
  debugWindows: 'debug:windows',
  debugCallTool: 'debug:call-tool',
  debugInjectAudio: 'debug:inject-audio',

  // main pushes (send / on)
  heartbeat: 'system:heartbeat',
  agentState: 'agent:state',
  linkStatus: 'link:status',
  audioChunk: 'audio:chunk',
  audioInterrupted: 'audio:interrupted',
  transcript: 'transcript',
  toolActivity: 'tool:activity',
  settings: 'settings:changed',
  wakeStatus: 'wake:status',
  woke: 'agent:woke',
  tasks: 'tasks:changed',
  presence: 'presence:changed', // what the face shows (main window + companion)
  sessionEvent: 'session:event', // one timeline entry, new or updated (same id = replace)
  clearHistory: 'history:clear', // Settings: clear conversations, action log and memory (asks first)
  health: 'link:health',
  phoneStatus: 'phone:status',
  remoteStatus: 'remote:status', // the phone remote's connection changed (RemoteInfo)
  windowVisible: 'window:visible', // main → main window: shown (true) / hidden or minimised (false)

  // renderer tells main, no reply (send / on)
  playbackDone: 'audio:playback-done',
  audioLevel: 'audio:level', // main window → main: how loud (0..1), ~30×/s while active
  overlayLevel: 'overlay:level', // main → edge glow window
  overlayState: 'overlay:state', // main → edge glow window (and the companion)
  overlayTheme: 'overlay:theme', // main → edge glow window: which colour
  companionOpen: 'companion:open', // companion → main: open the main window
  companionMenu: 'companion:menu', // companion → main: show the menu at the cursor
  companionHover: 'companion:hover', // companion → main: pointer is over the face (stop clicking through)
  companionDrag: 'companion:drag', // companion → main: move the window by (dx, dy)
  companionDragEnd: 'companion:drag-end', // companion → main: let go; snap to the nearest edge
  confirmShow: 'confirm:show', // main → confirmation window: the question
  confirmAnswer: 'confirm:answer', // confirmation window → main: yes / no (only that window is believed)
  confirmSize: 'confirm:size', // confirmation window → main: fit the window to its content
  micStart: 'mic:start',
  micAudio: 'mic:audio',
  micStop: 'mic:stop',
  wakeNow: 'mic:wake-now', // the Start button: a hands-free conversation, as if it heard its name
  endConversation: 'mic:end', // the same button while it listens: stop now
  stopReply: 'mic:stop-reply', // the Stop button: silence the answer and end the conversation
  startTalking: 'mic:start-talking' // main → page: the tray / companion menu's "Start talking"
} as const

export interface SystemInfo {
  hostname: string
  platform: string // 'win32' | 'darwin' | 'linux'
  cpuCount: number
  totalMemMB: number
}

export interface Heartbeat {
  freeMemMB: number
  uptimeMin: number
  at: number // ms since epoch, stamped by main
}

// A union type, not `string`: a typo like 'listning' is a compile error, not a silent UI bug.
// These are the four states the PS (B1) says must always be shown.
export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking'

// 'reconnecting' = the connection dropped and we're getting it back (B6). Not an error yet.
export type LinkStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface LinkStatusUpdate {
  status: LinkStatus
  detail?: string // e.g. close code + reason, or an error message
}

// One step of a tool call, shown in the UI so you can SEE the agent working. Read-only: the UI
// can watch tools run but never start one (docs/guide/03-architecture.md, D4b).
export interface ToolActivity {
  callId: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'waiting' | 'done' | 'failed' // waiting = asking the user to confirm
  result?: Record<string, unknown>
  at: number // ms since epoch
}

// A piece of what was said. Gemini sends transcripts in small fragments, so the UI appends
// consecutive fragments from the same speaker into one line.
export interface TranscriptPiece {
  role: 'user' | 'model'
  text: string
}

// Per-tool permission, like Claude Code: always allow / ask every time / never.
export type ToolPolicy = 'allow' | 'ask' | 'deny'

export interface Settings {
  agentName: string // the wake word is "Hey <agentName>"
  wakeWordEnabled: boolean
  voiceBargeIn: boolean // let the user interrupt by talking (needs good echo cancellation)
  edgeGlow: boolean // light up the screen edges while the agent is active
  companion: boolean // the small floating face in the screen corner
  theme: Theme
  userName: string // for the greeting ("Good evening, Abhay."); empty = no name
  memory: boolean // remember across days: a short note about recent sessions goes to each NEW conversation
  // Tool name → policy. Missing = the default (low risk runs, high risk asks). Caution mode still
  // asks even for 'allow' (docs/build-log/07-gatekeeper-ledger-tools.md).
  permissions: Record<string, ToolPolicy>
}

// Two colour themes on one set of token names (docs/build-log/09-ui.md). Graphite is the default.
export type Theme = 'graphite' | 'ember'

// What the FACE shows. Richer than AgentState: it also knows about the connection, confirmations,
// tools, tasks and mute. Main works it out in one place (main/presence.ts) and every face copies it,
// so the companion, the title bar and the status cell can never disagree.
export type FaceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'acting' // a tool is running: the face turns into the tool (FaceTool)
  | 'task' // idle, with background tasks running
  | 'confirm' // needs you: waiting for a yes/no
  | 'danger' // needs you, and the action can't be undone
  | 'reconnecting'
  | 'offline'
  | 'paused' // mic muted: blindfolded
export type FaceTool = 'app' | 'term' | 'web' | 'file' | 'phone' | 'screen' | 'click' | 'tile'

export interface Presence {
  face: FaceState
  tool: FaceTool | null // set when face is 'acting'
  caution: boolean // caution mode is on for the current request (outside content came in)
  cautionSource: string | null // what brought it in, in words: "a web page", "the screen"…
  label: string // the same thing in words: "Running a command", "Needs you: Delete …"
  muted: boolean
  lastAction: { text: string; at: number } | null // for the companion's hover tooltip
  theme: Theme
}

// The floating companion: receives presence + loudness, and can ask main for: open the main window,
// show the menu, stop clicking through (pointer over the face), move the window.
export interface CompanionApi {
  onPresence(callback: (presence: Presence) => void): () => void
  onLevel(callback: (level: number) => void): () => void
  openMain(): void
  showMenu(): void
  hover(over: boolean): void
  drag(dx: number, dy: number): void
  dragEnd(): void
}

// The confirmation window (main/gatekeeper/confirmWindow.ts). It is shown one question, and its only
// power is one answer to THAT question. Main accepts answers from this window alone.
export interface ConfirmView {
  id: number
  agentName: string
  theme: Theme
  action: string // may have several lines: the sentence, then the exact detail (a command, a path)
  tool?: string
  risk: 'low' | 'high'
  undoable: boolean
  irreversible: boolean
  reason: string
  note?: string
  timeoutMs: number
}
export interface ConfirmApi {
  onShow(callback: (view: ConfirmView) => void): () => void
  answer(id: number, answer: 'yes' | 'no'): void
  fit(height: number): void
}

// The ONLY things the edge-glow window can do: receive state and loudness. It never sends.
export interface OverlayApi {
  onState(callback: (state: AgentState) => void): () => void
  onLevel(callback: (level: number) => void): () => void
  onTheme(callback: (theme: Theme) => void): () => void
}

export interface WakeStatus {
  state: 'listening' | 'off' | 'unavailable'
  phrase: string // e.g. "Hey Dreamwalker"
  detail?: string // why it's unavailable, e.g. "run npm run models"
}

// One Ledger row, as the UI sees it (main/ledger/ledger.ts has the full story).
export interface LedgerEntryView {
  id: number
  tool: string
  description: string
  status: string
  source: string
  result: Record<string, unknown> | null
  undo: unknown
  note: string | null
  createdAt: number
}

// A background task (A2), as the UI sees it.
export interface TaskInfo {
  id: number
  title: string
  command: string
  folder: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  startedAt: number
  endedAt?: number
  seconds: number
  lastLine: string
  exitCode?: number | null
}

// One entry of the session timeline (Home). Main keeps the list, so a reloaded page gets it back.
export type SessionEvent =
  | { kind: 'you'; id: string; at: number; text: string; via: 'voice' | 'text' }
  | { kind: 'agent'; id: string; at: number; text: string }
  | {
      kind: 'tool'
      id: string // the call id
      at: number
      tool: string
      sentence: string // plain words, e.g. "Set the volume to 40%"
      target: string // the main argument (path, url, command…), for the mono machine line
      status: 'running' | 'waiting' | 'done' | 'failed' | 'denied'
      ms?: number
      verified?: boolean
      error?: string
      ledgerId?: number
      undoable?: boolean
    }
  | {
      kind: 'confirm'
      id: string
      at: number
      action: string
      reason: string
      undoable: boolean
      tool?: string // which tool asked (absent for settings changes)
      risk?: 'low' | 'high'
      untrusted?: string | null // caution mode was on: what outside content was read before
      irreversible?: boolean // can't be undone (vs. simply nothing to undo)
      answer?: 'yes' | 'no' | 'timeout'
      answeredAt?: number
    }
  | { kind: 'net'; id: string; at: number; text: string; chip?: string }

// Numbers that show the B6/A1 work is doing its job.
export interface LinkHealth {
  model: string
  region: string
  firstAudioMs: number | null // last request: from the end of what you said to its first sound
  reconnects: number
  duplicatesBlocked: number // repeated tool calls the exactly-once check refused to run again
}

// The phone (M4, main/phone/link.ts), as the UI sees it.
export interface PhoneStatus {
  state: 'searching' | 'connected' | 'none' | 'unauthorized' | 'no-adb' | 'error'
  detail?: string
  model?: string
  android?: string
  battery?: number | null
  charging?: boolean
  wifi?: boolean
  screenOn?: boolean | null
  foreground?: string | null // package name of the app on screen
  via?: 'wifi' | 'usb'
}

// The phone remote (main/phoneBridge.ts), as the Phone page shows it. pairUrl holds the pairing code:
// it is shown as a QR code for the user's own phone and never logged.
export interface RemoteInfo {
  relay: string | null
  online: boolean // the laptop is connected to the relay right now
  localPort: number | null
  pairUrl: string | null
}

// Home's "Today" card and Go-to tiles: counts from the Ledger (this computer's history).
export interface HomeStats {
  today: number // actions today (not counting reads)
  todayFailed: number
  last: { id: number; text: string; at: number; undoable: boolean } | null // newest change today
  refusedThisWeek: number // actions refused (denied) in the last 7 days
  customRules: number // tools with a non-default permission
}

// A tool, as the Permissions page shows it.
export interface ToolInfo {
  name: string
  description: string
  risk: 'low' | 'high'
  effect: 'read' | 'write' | 'upload'
}

// The current values of everything main pushes. The UI subscribes FIRST, then asks for this once,
// so it can't miss the starting state (pushes sent before React subscribed are simply lost).
export interface Snapshot {
  agentState: AgentState
  link: LinkStatusUpdate
  settings: Settings
  wake: WakeStatus
  tasks: TaskInfo[]
  presence: Presence
  session: SessionEvent[]
  health: LinkHealth
  phone: PhoneStatus
}

// Everything the UI is allowed to call. The preload builds an object of exactly this shape and
// exposes it as `window.dreamwalker`. If it isn't listed here, the UI can't do it.
export interface DreamwalkerApi {
  getSystemInfo(): Promise<SystemInfo>
  getSnapshot(): Promise<Snapshot>
  // Clears today's conversations, the action log and memory (a backup copy is kept); asks first.
  clearHistory(): Promise<{ cleared: boolean; actions: number }>
  // Rejects with a readable message if the change isn't allowed (e.g. a name that can't be a wake
  // word). Low-stakes settings only: permission settings (M2) will need a trusted confirmation,
  // since a page script could call this too.
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  // The action history (read-only). Newest first.
  getRecentActions(limit?: number): Promise<LedgerEntryView[]>

  // Send text to Gemini as if the user said it. Dev/test entry point until the mic exists.
  // Anything sent here has user authority, so risky actions it triggers still face the
  // Gatekeeper's native confirmation dialog (see docs/guide/03-architecture.md, D4b).
  sayText(text: string): Promise<void>
  playTestTone(): Promise<void>
  setMuted(muted: boolean): Promise<void> // mute = the mic is closed; nothing is heard, not even the wake word
  undoAction(ledgerId: number): Promise<Record<string, unknown>>
  cancelTask(taskId: number): Promise<Record<string, unknown>>
  listTools(): Promise<ToolInfo[]>
  // Copies the session as plain text; returns how many entries and where the session is saved on disk.
  copySession(): Promise<{ entries: number; savedAt: string }>
  homeStats(): Promise<HomeStats>
  refreshPhone(): Promise<PhoneStatus>
  retryConnection(): Promise<void>
  focusConfirmation(): Promise<void>
  remoteInfo(): Promise<RemoteInfo>
  // Test hook for B6: close the Gemini connection as if the network died. Rejects unless main was
  // started with DREAMWALKER_DEBUG=1, so in a normal run a page script can't use it.
  debugDropLink(): Promise<void>
  debugCloseMain(): Promise<void> // same as clicking the window's X; debug runs only
  // Which windows are visible, and where the companion is; debug runs only.
  debugWindows(): Promise<{ main: boolean; companion: boolean; companionBounds: { x: number; y: number; width: number; height: number } | null }>
  // retry=true = the same request repeating the call (tests exactly-once). Debug runs only.
  debugCallTool(name: string, args: Record<string, unknown>, retry?: boolean): Promise<Record<string, unknown>>
  // Play a recording INTO the microphone input (16 kHz Int16 mono), as if spoken; debug runs only.
  debugInjectAudio(pcm: Uint8Array): Promise<void>

  // Subscriptions return an "unsubscribe" function, same pattern as a React useEffect cleanup.
  onHeartbeat(callback: (beat: Heartbeat) => void): () => void
  onAgentState(callback: (state: AgentState) => void): () => void
  onLinkStatus(callback: (update: LinkStatusUpdate) => void): () => void
  onAudioChunk(callback: (pcm: Uint8Array) => void): () => void // 24 kHz Int16 mono PCM
  onToolActivity(callback: (activity: ToolActivity) => void): () => void
  onAudioInterrupted(callback: () => void): () => void // stop playback NOW, drop the queue
  onTranscript(callback: (piece: TranscriptPiece) => void): () => void
  onSettings(callback: (settings: Settings) => void): () => void
  onWakeStatus(callback: (status: WakeStatus) => void): () => void
  onWoke(callback: () => void): () => void // wake word heard: play the cue
  onTasks(callback: (tasks: TaskInfo[]) => void): () => void
  onPresence(callback: (presence: Presence) => void): () => void
  onSessionEvent(callback: (event: SessionEvent) => void): () => void
  onHealth(callback: (health: LinkHealth) => void): () => void
  onRemoteStatus(callback: (info: RemoteInfo) => void): () => void
  onPhoneStatus(callback: (status: PhoneStatus) => void): () => void
  // The page can't tell by itself: with backgroundThrottling off, document.hidden is always false.
  onWindowVisible(callback: (visible: boolean) => void): () => void

  // The speakers finished playing everything queued so far.
  playbackDone(): void
  // Current loudness 0..1 (mic while listening, voice while speaking), for the edge glow.
  reportLevel(level: number): void

  // Push-to-talk. Mic audio has the same authority as typed text (sayText): it IS the user.
  micStart(): void
  micAudio(pcm: Uint8Array): void // 16 kHz Int16 mono PCM, 20 ms per chunk
  micStop(): void

  // The Start button: the same as hearing the wake word (it opens the mic itself if the wake word is off).
  wakeNow(): void
  endConversation(): void
  stopReply(): void
  onStartTalking(callback: () => void): () => void
}
