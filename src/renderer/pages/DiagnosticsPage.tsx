// DIAGNOSTICS: the plumbing, for when something seems off.

import type { DwState } from '../store'
import { cleanError } from '../store'
import { useState } from 'react'

export function DiagnosticsPage(props: { s: DwState }) {
  const { s } = props
  const [error, setError] = useState<string | null>(null)
  const rows: Array<[string, string]> = [
    ['Gemini connection', `${s.link.status}${s.link.detail ? ` · ${s.link.detail}` : ''}`],
    ['Model', `${s.health.model} · ${s.health.region}`],
    ['First audio (last request)', s.health.firstAudioMs === null ? '–' : `${s.health.firstAudioMs} ms`],
    ['Reconnects this session', String(s.health.reconnects)],
    ['Repeated actions blocked', String(s.health.duplicatesBlocked)],
    ['Wake word', `${s.wake.state} · “${s.wake.phrase}”${s.wake.detail ? ` · ${s.wake.detail}` : ''}`],
    ['Agent state', s.agentState],
    ['Face', `${s.presence.face}${s.presence.tool ? ` · ${s.presence.tool}` : ''}${s.presence.caution ? ' · caution' : ''}`],
    ['Computer', s.info ? `${s.info.hostname} · ${s.info.platform} · ${s.info.cpuCount} CPUs · ${s.info.totalMemMB} MB` : '…'],
    ['Free memory', s.beat ? `${s.beat.freeMemMB} MB · up ${s.beat.uptimeMin} min` : '…']
  ]
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Diagnostics</h1>
      </header>
      <dl className="diag">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        className="btn"
        onClick={() => {
          setError(null)
          window.dreamwalker.playTestTone().catch((err: unknown) => setError(cleanError(err)))
        }}
      >
        Test speakers
      </button>
      {error && <p className="err">{error}</p>}
    </div>
  )
}
