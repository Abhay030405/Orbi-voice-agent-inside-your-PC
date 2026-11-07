// The status cluster under the title bar: state, model, phone, watching, mic. One glance = everything.
// Cells for features that aren't built yet (phone M4, watcher M5) say so plainly instead of faking it.

import { useEffect, useRef } from 'react'
import { Face } from '../face/Face'
import type { DwState } from '../store'
import type { Levels } from './levels'
import { Glyph } from '../ui/Glyph'
import { phoneLine } from '../pages/PhonePage'
import { windowVisible } from '../visibility'

// 10-bar mic meter, from the level getter (no React re-renders). 20 updates a second is plenty for a
// meter; nothing while the window is hidden; the DOM is touched only when a bar changes.
function MicMeter(props: { level: () => number }) {
  const ref = useRef<HTMLDivElement>(null)
  const levelRef = useRef(props.level)
  levelRef.current = props.level
  useEffect(() => {
    let shown = 0
    let litBefore = -1
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[]
    const timer = setInterval(() => {
      if (!windowVisible()) return
      const l = levelRef.current()
      shown += (l - shown) * (l > shown ? 0.6 : 0.25)
      const lit = Math.round(Math.min(1, shown * 2.2) * bars.length)
      if (lit === litBefore) return
      litBefore = lit
      bars.forEach((bar, i) => bar.classList.toggle('on', i < lit))
    }, 50)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="meter" ref={ref} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} style={{ height: 4 + i }} />
      ))}
    </div>
  )
}

export function StatusCluster(props: { s: DwState; levels: Levels; onMute: (muted: boolean) => void }) {
  const { s, levels } = props
  const link = s.link.status
  const model =
    link === 'connected'
      ? `${s.health.region}${s.health.firstAudioMs !== null ? ` · ${s.health.firstAudioMs} ms` : ''}`
      : link === 'disconnected'
        ? `offline${s.link.detail ? ` · ${s.link.detail}` : ''}`
        : link
  const mic = s.presence.muted
    ? 'muted · not listening'
    : s.wake.state === 'listening'
      ? `on-device · say “${s.wake.phrase}”`
      : 'push-to-talk · hold Space'

  return (
    <section className="status" aria-label="Status">
      <div className="cell cell-state">
        <Face presence={s.presence} size={40} level={levels.active} />
        <div>
          <div className="cell-label">State</div>
          <div className="cell-value" aria-live={s.presence.face === 'confirm' || s.presence.face === 'danger' ? 'assertive' : 'polite'}>
            {s.presence.label}
          </div>
        </div>
      </div>
      <div className="cell">
        <div className="cell-label">Model</div>
        <div className="cell-value">Gemini Live</div>
        <div className="cell-sub" title={s.link.detail}>
          {model}
        </div>
      </div>
      <div className="cell">
        <div className="cell-label">Phone</div>
        <div className="cell-value">{s.phone.state === 'connected' ? s.phone.model : 'Not connected'}</div>
        <div className="cell-sub">
          {s.phone.state === 'connected'
            ? `${s.phone.via === 'wifi' ? 'Wi-Fi' : 'USB'} · ${s.phone.battery ?? '?'}%${s.phone.charging ? ' ⚡' : ''}`
            : phoneLine(s.phone)}
        </div>
      </div>
      <div className="cell">
        <div className="cell-label">Watching</div>
        <div className="cell-value">Off</div>
        <div className="cell-sub">screen watcher · later</div>
      </div>
      <div className="cell">
        <div className="cell-label">Mic · wake word</div>
        <MicMeter level={levels.mic} />
        <div className="cell-sub">{mic}</div>
      </div>
      <div className="cell cell-buttons">
        <button
          className={`btn ${s.presence.muted ? 'btn-on' : ''}`}
          onClick={() => props.onMute(!s.presence.muted)}
          aria-pressed={s.presence.muted}
        >
          <Glyph name="mic" size={13} theme={s.settings.theme} />
          {s.presence.muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
    </section>
  )
}
