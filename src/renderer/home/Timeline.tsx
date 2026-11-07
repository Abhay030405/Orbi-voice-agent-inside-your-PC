// The session timeline: what you said, what it said, every action as a card (a human sentence first,
// the machine name in mono), every confirmation, every network blip. Newest at the bottom.
// The node marker's SHAPE says what kind of row it is, never colour alone.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SessionEvent, Theme } from '../../shared/ipc'
import { morphFor } from '../../shared/morph'
import { clock, shortClock } from '../store'
import { ActionText } from '../ui/ActionText'
import { Glyph, glyphForTool } from '../ui/Glyph'

type Filter = 'all' | 'speech' | 'tools' | 'screen' | 'tasks' | 'asked'
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['speech', 'Speech'],
  ['tools', 'Tools'],
  ['screen', 'Screen'],
  ['tasks', 'Tasks'],
  ['asked', 'Asked']
]

function matches(e: SessionEvent, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'speech') return e.kind === 'you' || e.kind === 'agent'
  if (f === 'asked') return e.kind === 'confirm'
  if (e.kind !== 'tool') return false
  if (f === 'screen') return morphFor(e.tool) === 'screen'
  if (f === 'tasks') return e.tool.includes('task')
  return true
}

export interface TimelineProps {
  events: SessionEvent[]
  theme: Theme
  agentName: string
  emptyHint: string
  undone: Set<number>
  onUndo(ledgerId: number): void
  onCopy(): void
}

export function Timeline(props: TimelineProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true) // stick to the bottom unless you scrolled up to read

  const shown = props.events.filter((e) => matches(e, filter))
  const tools = props.events.filter((e) => e.kind === 'tool')
  const failed = tools.filter((e) => e.kind === 'tool' && e.status === 'failed').length
  const first = props.events[0]

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onScroll = (): void => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <section className="timeline-col" aria-label="Session timeline">
      <header className="timeline-head">
        <div className="timeline-title">
          <h1>Session</h1>
          <span className="timeline-meta">
            {first ? `Today from ${shortClock(first.at)} · ` : ''}
            {tools.length} action{tools.length === 1 ? '' : 's'} · {failed} failed
          </span>
          <button className="chip" onClick={props.onCopy} disabled={props.events.length === 0} title="Copy the whole conversation as text">
            Copy
          </button>
        </div>
        <div className="chips" role="radiogroup" aria-label="Show">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              role="radio"
              aria-checked={filter === key}
              className={`chip ${filter === key ? 'chip-on' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="timeline" ref={listRef}>
        {shown.length === 0 ? (
          <p className="empty">{props.events.length === 0 ? props.emptyHint : 'Nothing of this kind yet.'}</p>
        ) : (
          shown.map((e) => <Row key={e.id} e={e} {...props} />)
        )}
        <div className="timeline-spacer" />
      </div>
      <div className="timeline-fade" aria-hidden="true" />
    </section>
  )
}

function Row(props: { e: SessionEvent } & TimelineProps) {
  const { e } = props
  return (
    <div className={`row row-${e.kind}`}>
      <time className="row-time">{clock(e.at)}</time>
      <span className={`node node-${e.kind}`} aria-hidden="true" />
      <div className="row-body">
        <RowBody {...props} />
      </div>
    </div>
  )
}

function RowBody(props: { e: SessionEvent } & TimelineProps) {
  const { e, theme } = props
  switch (e.kind) {
    case 'you':
      return (
        <>
          <div className="who">You · {e.via === 'voice' ? 'voice' : 'typed'}</div>
          <p className="quote">“{e.text.trim()}”</p>
        </>
      )
    case 'agent':
      return (
        <>
          <div className="who who-agent">{props.agentName}</div>
          <p className="said">{e.text.trim()}</p>
        </>
      )
    case 'net':
      return (
        <p className="net">
          <Glyph name="net" size={13} theme={theme} />
          {e.text}
          {e.chip && <code className="net-chip">{e.chip}</code>}
        </p>
      )
    case 'confirm':
      return (
        <div className={`confirm ${e.answer ? '' : 'confirm-open'}`}>
          <div className="confirm-main">
            <div className="who who-att">Asked first</div>
            <ActionText action={e.action} className="confirm-action" />
            <div className={`confirm-undo ${e.irreversible ? 'confirm-final' : ''}`}>
              {e.undoable ? 'Can be undone' : e.irreversible ? 'Can’t be undone' : 'Nothing permanent'} · {e.reason}
            </div>
          </div>
          <div className="confirm-outcome">
            {!e.answer && <span className="att">Waiting for you…</span>}
            {e.answer === 'yes' && (
              <>
                Allowed · you said “yes” · <time>{e.answeredAt ? clock(e.answeredAt) : ''}</time>
              </>
            )}
            {e.answer === 'no' && (
              <>
                Declined · nothing was done · <time>{e.answeredAt ? clock(e.answeredAt) : ''}</time>
              </>
            )}
            {e.answer === 'timeout' && <>No answer in time · nothing was done</>}
          </div>
        </div>
      )
    case 'tool': {
      const undone = e.ledgerId !== undefined && props.undone.has(e.ledgerId)
      return (
        <div className={`card card-${e.status}`}>
          <Glyph name={glyphForTool(e.tool)} theme={theme} className="card-glyph" />
          <span className="card-title">{e.sentence}</span>
          <code className="card-machine">
            {e.tool}
            {e.target ? ` · ${e.target}` : ''}
          </code>
          {e.ms !== undefined && <span className="card-ms">{(e.ms / 1000).toFixed(1)} s</span>}
          <ToolStatus e={e} theme={theme} />
          {e.status === 'done' && e.undoable && e.ledgerId !== undefined && (
            <button className="btn-solid" disabled={undone} onClick={() => props.onUndo(e.ledgerId!)}>
              <Glyph name="undo" size={12} theme={theme} />
              {undone ? 'Undone' : 'Undo'}
            </button>
          )}
          {e.error && e.status !== 'done' && <div className="card-error">{e.error}</div>}
        </div>
      )
    }
  }
}

function ToolStatus(props: { e: Extract<SessionEvent, { kind: 'tool' }>; theme: Theme }) {
  const { e } = props
  if (e.status === 'running') return <span className="card-status">running…</span>
  if (e.status === 'waiting') return <span className="card-status att">waiting for you</span>
  if (e.status === 'denied') return <span className="card-status">not done</span>
  if (e.status === 'failed') return <span className="card-status err">failed</span>
  if (e.verified)
    return (
      <span className="card-status verified">
        <Glyph name="check" size={12} theme={props.theme} className="verified" />
        Verified
      </span>
    )
  return <span className="card-status">done</span>
}
