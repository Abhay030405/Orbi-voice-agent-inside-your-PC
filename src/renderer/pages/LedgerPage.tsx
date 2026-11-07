// LEDGER: every action Dreamwalker took or was refused, newest first (from SQLite, survives restarts).

import type { LedgerEntryView, Theme } from '../../shared/ipc'
import { clock } from '../store'
import { Glyph, glyphForTool } from '../ui/Glyph'

const STATUS_CLASS: Record<string, string> = {
  done: 'verified',
  failed: 'err',
  undo_failed: 'err',
  interrupted: 'att',
  pending: '',
  denied: 'muted',
  undone: 'muted'
}

export function LedgerPage(props: { entries: LedgerEntryView[]; theme: Theme; undone: Set<number>; onUndo(id: number): void }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Ledger</h1>
        <p className="page-intro">
          Every action, written down <em>before</em> it happens. Kept on this computer across restarts. Denied and failed
          actions are history too.
        </p>
      </header>
      {props.entries.length === 0 ? (
        <p className="empty">No actions yet.</p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Action</th>
              <th>Tool</th>
              <th>Asked by</th>
              <th>Result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.entries.map((e) => {
              const canUndo = e.status === 'done' && e.undo !== null && !props.undone.has(e.id)
              return (
                <tr key={e.id}>
                  <td className="mono dim">{e.id}</td>
                  <td className="mono dim">
                    {new Date(e.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} {clock(e.createdAt)}
                  </td>
                  <td className="ledger-action">
                    <Glyph name={glyphForTool(e.tool)} size={14} theme={props.theme} />
                    <span title={e.description}>{e.description.split('\n')[0]}</span>
                    {e.note && <small className="dim"> · {e.note}</small>}
                  </td>
                  <td className="mono dim">{e.tool}</td>
                  <td className="dim">{e.source}</td>
                  <td className={`mono ${STATUS_CLASS[e.status] ?? ''}`}>{e.status.replace('_', ' ')}</td>
                  <td>
                    {canUndo && (
                      <button className="link-btn" onClick={() => props.onUndo(e.id)}>
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
