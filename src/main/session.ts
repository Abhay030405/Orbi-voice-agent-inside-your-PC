// SESSION LOG: the timeline on the Home screen. What you said, what it said, every tool card,
// every confirmation, every network blip, in order. Guide: docs/build-log/09-ui.md.
//
// It lives in MAIN, not in the page: reloading or reopening the window gets the whole session back
// (the page asks for it in the snapshot). Each change is pushed as one event; an event with an id the
// page already has REPLACES it (a tool card goes running → done; a line of speech grows).
//
// Pure: no Electron. Unit-tested in session.test.ts.

import type { SessionEvent } from '../shared/ipc'

type ToolEvent = Extract<SessionEvent, { kind: 'tool' }>
type ConfirmEvent = Extract<SessionEvent, { kind: 'confirm' }>

const MAX_EVENTS = 300
// Speech fragments within this gap of the previous one, from the same side, are the same line.
const GLUE_MS = 10_000

export class SessionLog {
  private readonly events: SessionEvent[] = []
  private nextId = 1
  private lastSpeechAt = 0
  private readonly onChange: (event: SessionEvent) => void
  private readonly now: () => number

  // `saved`: the events of a recent session read back from disk (main/index.ts), so a restart keeps
  // the timeline. New ids continue after the highest saved one.
  constructor(onChange: (event: SessionEvent) => void, now: () => number = Date.now, saved: SessionEvent[] = []) {
    this.onChange = onChange
    this.now = now
    // A saved session can end mid-action (a crash, a force-quit, or quitting inside the 2 s save delay).
    // Whatever was still running or waiting then is NOT still running now: say so, like the Ledger does.
    this.events.push(...saved.slice(-MAX_EVENTS).map(settle))
    for (const e of this.events) {
      const n = /^s(\d+)$/.exec(e.id)
      if (n) this.nextId = Math.max(this.nextId, Number(n[1]) + 1)
    }
  }

  list(): SessionEvent[] {
    return [...this.events]
  }

  // A transcript fragment. Gemini sends speech in small pieces ("Hel", "lo the", "re"): glue a piece
  // onto the newest event when that event is the same speaker and nothing else happened in between.
  heard(role: 'user' | 'model', text: string): void {
    const kind = role === 'user' ? 'you' : 'agent'
    const last = this.events.at(-1)
    const at = this.now()
    const glue =
      last !== undefined &&
      last.kind === kind &&
      (last.kind !== 'you' || last.via === 'voice') &&
      at - this.lastSpeechAt < GLUE_MS
    this.lastSpeechAt = at
    if (glue) {
      this.replace({ ...last, text: last.text + text } as SessionEvent)
      return
    }
    this.add(
      kind === 'you'
        ? { kind, id: this.id(), at, text: text.trimStart(), via: 'voice' }
        : { kind, id: this.id(), at, text: text.trimStart() }
    )
  }

  // Typed text is always its own line.
  typed(text: string): void {
    this.lastSpeechAt = 0
    this.add({ kind: 'you', id: this.id(), at: this.now(), text, via: 'text' })
  }

  toolStarted(callId: string, tool: string, args: Record<string, unknown>, sentence = humanize(tool)): void {
    this.add({
      kind: 'tool',
      id: callId,
      at: this.now(),
      tool,
      sentence,
      target: mainArgument(args),
      status: 'running'
    })
  }

  toolUpdate(callId: string, patch: Partial<Omit<ToolEvent, 'kind' | 'id'>>): void {
    const event = this.find(callId)
    if (event?.kind === 'tool') this.replace({ ...event, ...patch })
  }

  confirmAsked(
    id: string,
    action: string,
    reason: string,
    undoable: boolean,
    meta: { tool?: string; risk?: 'low' | 'high'; untrusted?: string | null; irreversible?: boolean } = {}
  ): void {
    this.add({ kind: 'confirm', id, at: this.now(), action, reason, undoable, ...meta })
  }

  confirmAnswered(id: string, answer: NonNullable<ConfirmEvent['answer']>): void {
    const event = this.find(id)
    if (event?.kind === 'confirm') this.replace({ ...event, answer, answeredAt: this.now() })
  }

  net(text: string, chip?: string): void {
    this.add({ kind: 'net', id: this.id(), at: this.now(), text, ...(chip ? { chip } : {}) })
  }

  private id(): string {
    return `s${this.nextId++}`
  }

  private find(id: string): SessionEvent | undefined {
    // Newest first: the event being updated is almost always one of the last few.
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].id === id) return this.events[i]
    return undefined
  }

  private add(event: SessionEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.onChange(event)
  }

  private replace(event: SessionEvent): void {
    const i = this.events.findIndex((e) => e.id === event.id)
    if (i === -1) return
    this.events[i] = event
    this.onChange(event)
  }
}

// "get_volume" → "Get volume". Used until the tool's own describe() gives a real sentence.
export function humanize(tool: string): string {
  const words = tool.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The argument that says WHAT the tool works on, for the card's mono line.
const MAIN_KEYS = ['path', 'from', 'url', 'command', 'name', 'query', 'title', 'level', 'taskId', 'id']
export function mainArgument(args: Record<string, unknown>): string {
  const key = MAIN_KEYS.find((k) => args[k] !== undefined && args[k] !== '')
  const value = key ? args[key] : Object.values(args).find((v) => typeof v === 'string' && v !== '')
  if (value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

// The whole session as plain text, for "Copy conversation" (paste it anywhere, e.g. into a chat).
export function sessionText(events: SessionEvent[], agentName: string): string {
  const time = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour12: false })
  const lines = events.map((e) => {
    switch (e.kind) {
      case 'you':
        return `[${time(e.at)}] You (${e.via}): ${e.text.trim()}`
      case 'agent':
        return `[${time(e.at)}] ${agentName}: ${e.text.trim()}`
      case 'tool': {
        const outcome = e.status === 'done' ? (e.verified ? 'done, verified' : 'done') : e.status
        const target = e.target ? ` · ${e.target}` : ''
        return `[${time(e.at)}]   → ${e.sentence} (${e.tool}${target}): ${outcome}${e.error ? ` (${e.error})` : ''}`
      }
      case 'confirm':
        return `[${time(e.at)}]   ? Asked first: ${e.action.split('\n')[0]} → ${e.answer ?? 'waiting'}`
      case 'net':
        return `[${time(e.at)}]   ~ ${e.text}${e.chip ? ` (${e.chip})` : ''}`
    }
  })
  const day = events[0] ? new Date(events[0].at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')
  return [`Dreamwalker session, ${day}`, '', ...lines].join('\n')
}

export function settle(e: SessionEvent): SessionEvent {
  if (e.kind === 'tool' && (e.status === 'running' || e.status === 'waiting')) {
    return { ...e, status: 'failed', error: 'interrupted: Dreamwalker stopped while this was in progress' }
  }
  if (e.kind === 'confirm' && !e.answer) return { ...e, answer: 'timeout' }
  return e
}

// TODAY'S EARLIER CONVERSATIONS, shown above the current one. Gemini starts a fresh conversation after
// 2 quiet hours (it can't resume older ones), and the timeline used to start empty with it, as if the
// day had been wiped (Abhay, 2026-10-21: "it should show the actual history"). They are shown, not
// copied into the new file, so each conversation is still saved (and summarised for memory) once.
// Ids get a prefix so they can't clash with the new conversation's ids.
export function earlierToday(sessions: { name: string; events: SessionEvent[] }[], now: number): SessionEvent[] {
  const dayStart = new Date(now).setHours(0, 0, 0, 0)
  const out: SessionEvent[] = []
  sessions.forEach((s, i) => {
    const today = s.events.filter((e) => e.at >= dayStart)
    out.push(...today.map((e) => ({ ...settle(e), id: `d${i}-${e.id}` })))
  })
  if (out.length > 0) {
    out.push({ kind: 'net', id: 'day-divider', at: now, text: 'New conversation. Orbi has a short summary of the earlier ones.' })
  }
  return out.slice(-MAX_EVENTS)
}
