// TASKS: background jobs (PS A2), running and finished. Each is its own process.

import { ThinkingOrb } from 'thinking-orbs'
import type { TaskInfo } from '../../shared/ipc'
import { clock, duration } from '../store'
import { useWindowVisible } from '../visibility'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export function TasksPage(props: { tasks: TaskInfo[]; now: number; onCancel(id: number): void }) {
  const visible = useWindowVisible()
  return (
    <div className="page">
      <header className="page-head">
        <h1>Tasks</h1>
        <p className="page-intro">
          Long jobs run in the background while you keep talking: up to 4 at once, 30 minutes each. Dreamwalker tells you
          when one finishes. Say “what’s running?” or “cancel that”.
        </p>
      </header>
      {props.tasks.length === 0 ? (
        <p className="empty">No tasks yet. Try “in the background, zip my Documents folder”.</p>
      ) : (
        <div className="task-grid">
          {props.tasks.map((t) => {
            const seconds = t.status === 'running' ? Math.max(t.seconds, Math.round((props.now - t.startedAt) / 1000)) : t.seconds
            return (
              <div key={t.id} className={`task-card task-${t.status}`}>
                <div className="task-head">
                  {t.status === 'running' ? (
                    <ThinkingOrb state="working" size={20} theme="dark" paused={reducedMotion.matches || !visible} aria-label="running" />
                  ) : (
                    <span className={`task-dot task-dot-${t.status}`} aria-hidden="true" />
                  )}
                  <strong>
                    #{t.id} {t.title}
                  </strong>
                  <span className="task-time">{duration(seconds)}</span>
                </div>
                <code className="task-cmd">{t.command}</code>
                <div className="task-meta mono dim">
                  {t.status}
                  {t.exitCode !== undefined && t.exitCode !== null ? ` · exit ${t.exitCode}` : ''} · started {clock(t.startedAt)} ·{' '}
                  {t.folder}
                </div>
                <div className="task-foot">
                  <code className="task-line">{t.lastLine || 'no output yet'}</code>
                  {t.status === 'running' && (
                    <button className="btn" onClick={() => props.onCancel(t.id)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
