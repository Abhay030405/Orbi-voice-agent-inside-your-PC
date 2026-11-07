// The "Now" rail on the right: what needs you, what's running, what you can undo, and link health.

import { ThinkingOrb } from 'thinking-orbs'
import type { LedgerEntryView, SessionEvent, TaskInfo } from '../../shared/ipc'
import { clock, duration, shortClock, type DwState } from '../store'
import { ActionText } from '../ui/ActionText'
import { Glyph, glyphForTool } from '../ui/Glyph'
import { useWindowVisible } from '../visibility'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export interface NowRailProps {
  s: DwState
  undoable: LedgerEntryView[]
  undone: Set<number>
  onUndo(ledgerId: number): void
  onCancelTask(taskId: number): void
}

export function NowRail(props: NowRailProps) {
  const { s } = props
  const theme = s.settings.theme
  const open = [...s.session].reverse().find((e): e is Extract<SessionEvent, { kind: 'confirm' }> => e.kind === 'confirm' && !e.answer)
  const running = s.tasks.filter((t) => t.status === 'running')

  return (
    <aside className="rail" aria-label="Now">
      <section>
        <h2 className="rail-label">Waiting on you</h2>
        {open ? (
          <div className="rail-ask" role="alert">
            <ActionText action={open.action} className="confirm-action" />
            <div className={`confirm-undo ${open.irreversible ? 'confirm-final' : ''}`}>
              {open.undoable ? 'Can be undone' : open.irreversible ? 'Can’t be undone' : 'Nothing permanent'}
            </div>
            {/* No Allow button here on purpose: a page could click it. Only the Windows dialog or your voice can answer. */}
            <p className="rail-note">Answer in the Dreamwalker dialog, or just say “yes” or “no”.</p>
          </div>
        ) : (
          <p className="rail-empty">Nothing right now. Risky actions show up here and in their own window.</p>
        )}
      </section>

      <section>
        <h2 className="rail-label">Running</h2>
        {running.length === 0 ? (
          <p className="rail-empty">No background tasks. Ask for something long, like “zip my project in the background”.</p>
        ) : (
          running.map((t) => <TaskCard key={t.id} t={t} now={s.beat?.at ?? Date.now()} onCancel={props.onCancelTask} />)
        )}
      </section>

      <section>
        <h2 className="rail-label">Undo recent</h2>
        {props.undoable.length === 0 ? (
          <p className="rail-empty">Nothing to undo yet.</p>
        ) : (
          <ul className="undo-list">
            {props.undoable.slice(0, 4).map((entry) => (
              <li key={entry.id}>
                <Glyph name={glyphForTool(entry.tool)} size={14} theme={theme} />
                <span className="undo-text" title={entry.description}>
                  {entry.description.split('\n')[0]}
                </span>
                <time>{shortClock(entry.createdAt)}</time>
                <button className="link-btn" disabled={props.undone.has(entry.id)} onClick={() => props.onUndo(entry.id)}>
                  {props.undone.has(entry.id) ? 'Undone' : 'Undo'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="rail-note">Or say “undo that”.</p>
      </section>

      <section className="health">
        <h2 className="rail-label">Link health</h2>
        <div className="health-row">
          <Metric value={s.health.firstAudioMs === null ? '–' : String(s.health.firstAudioMs)} unit={s.health.firstAudioMs === null ? '' : 'ms'} label="first audio" />
          <Metric value={String(s.health.reconnects)} label={s.health.reconnects === 1 ? 'reconnect' : 'reconnects'} />
          <Metric value={String(s.health.duplicatesBlocked)} label="duplicates" />
        </div>
      </section>
    </aside>
  )
}

function Metric(props: { value: string; unit?: string; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
      <div className="metric-label">{props.label}</div>
    </div>
  )
}

function TaskCard(props: { t: TaskInfo; now: number; onCancel(id: number): void }) {
  const { t } = props
  const visible = useWindowVisible()
  const seconds = Math.max(t.seconds, Math.round((props.now - t.startedAt) / 1000))
  return (
    <div className="task-card">
      <div className="task-head">
        <ThinkingOrb state="working" size={20} theme="dark" paused={reducedMotion.matches || !visible} aria-label="running" />
        <strong>{t.title}</strong>
        <span className="task-time">{duration(seconds)}</span>
      </div>
      <code className="task-cmd" title={t.command}>
        {t.command}
      </code>
      {/* Our tasks can't report a percentage, so the bar sweeps instead of filling. */}
      <div className="bar bar-sweep" aria-hidden="true">
        <span />
      </div>
      <div className="task-foot">
        <code className="task-line" title={t.lastLine}>
          {t.lastLine || `started ${clock(t.startedAt)}`}
        </code>
        <button className="btn" onClick={() => props.onCancel(t.id)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

