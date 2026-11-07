// The page's copy of what main knows, as one React hook. Subscribe FIRST, then pull the snapshot:
// in the other order, an update arriving between the two steps would be lost. (Main's pushes are
// delivered in order, so a push that arrives after the snapshot is always newer than it.)

import { useEffect, useState } from 'react'
import type {
  AgentState,
  Heartbeat,
  LinkHealth,
  LinkStatusUpdate,
  PhoneStatus,
  Presence,
  SessionEvent,
  Settings,
  SystemInfo,
  TaskInfo,
  WakeStatus
} from '../shared/ipc'
import { windowVisible } from './visibility'

export interface DwState {
  agentState: AgentState
  link: LinkStatusUpdate
  settings: Settings
  wake: WakeStatus
  tasks: TaskInfo[]
  presence: Presence
  phone: PhoneStatus
  session: SessionEvent[]
  health: LinkHealth
  beat: Heartbeat | null
  info: SystemInfo | null
  ledgerVersion: number // bumps when an action finishes, so ledger views know to reload
}

// An event with an id we already have REPLACES it (a tool card running → done, a line of speech growing).
function upsert(list: SessionEvent[], event: SessionEvent): SessionEvent[] {
  const i = list.findIndex((e) => e.id === event.id)
  if (i === -1) return [...list, event].slice(-300)
  const next = list.slice()
  next[i] = event
  return next
}

export function useDreamwalker(): DwState | null {
  const [state, setState] = useState<DwState | null>(null)

  useEffect(() => {
    const api = window.dreamwalker
    // A push that arrives before the snapshot's reply is OLDER than the snapshot (pushes and replies
    // travel the same ordered pipe, and main took the snapshot after sending it), so it's dropped.
    const apply = (change: (s: DwState) => DwState): void => setState((s) => (s ? change(s) : s))

    const offs = [
      api.onAgentState((agentState) => apply((s) => ({ ...s, agentState }))),
      api.onLinkStatus((link) => apply((s) => ({ ...s, link }))),
      api.onSettings((settings) => apply((s) => ({ ...s, settings }))),
      api.onWakeStatus((wake) => apply((s) => ({ ...s, wake }))),
      api.onTasks((tasks) => apply((s) => ({ ...s, tasks }))),
      api.onPresence((presence) => apply((s) => ({ ...s, presence }))),
      api.onHealth((health) => apply((s) => ({ ...s, health }))),
      api.onPhoneStatus((phone) => apply((s) => ({ ...s, phone }))),
      // Once a second; it re-renders the page, so skip it while the window isn't on screen.
      api.onHeartbeat((beat) => windowVisible() && apply((s) => ({ ...s, beat }))),
      api.onSessionEvent((event) => apply((s) => ({ ...s, session: upsert(s.session, event) }))),
      api.onToolActivity((a) => {
        if (a.status === 'done' || a.status === 'failed') apply((s) => ({ ...s, ledgerVersion: s.ledgerVersion + 1 }))
      })
    ]
    void api.getSnapshot().then((snap) => setState({ ...snap, beat: null, info: null, ledgerVersion: 0 }))
    // Requested after the snapshot, so its reply comes after it too (same ordered pipe).
    void api.getSystemInfo().then((info) => apply((s) => ({ ...s, info })))
    return () => offs.forEach((off) => off())
  }, [])

  return state
}

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour12: false })
export const shortClock = (at: number): string =>
  new Date(at).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })

// Electron prefixes invoke errors with "Error invoking remote method '…': Error: ".
export const cleanError = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^.*Error: /, '')

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
