// The title bar on every screen (design v2): face + name, the 6 sections, and the Mic / Watching
// pills. It's also the window's drag handle; Windows draws min/max/close to its right.

import type { Presence, Theme } from '../../shared/ipc'
import { Face } from '../face/Face'
import type { Levels } from '../home/levels'
import { SECTIONS, type Section } from '../nav'
import { Glyph } from '../ui/Glyph'

export interface TitleBarProps {
  presence: Presence
  agentName: string
  theme: Theme
  levels: Levels
  section: Section
  attention: Partial<Record<Section, boolean>> // sections with something waiting get an amber diamond
  onSection(section: Section): void
  onMute(muted: boolean): void
}

export function TitleBar(props: TitleBarProps) {
  const { presence, theme } = props
  return (
    <header className="titlebar">
      <div className="brand">
        <Face presence={presence} size={26} level={props.levels.active} />
        {props.agentName}
      </div>
      <nav className="tabs" aria-label="Sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`tab ${props.section === s.id ? 'tab-on' : ''}`}
            aria-current={props.section === s.id ? 'page' : undefined}
            onClick={() => props.onSection(s.id)}
          >
            {s.label}
            {props.attention[s.id] && <span className="diamond" aria-label="needs you" />}
          </button>
        ))}
      </nav>
      <div className="title-pills">
        {/* Paused must be unmistakable: the label, the glyph AND the face all change. */}
        <button
          className={`pill ${presence.muted ? 'pill-off' : 'pill-on'}`}
          onClick={() => props.onMute(!presence.muted)}
          aria-pressed={!presence.muted}
          title={presence.muted ? 'The microphone is closed. Click to turn it on.' : 'Click to close the microphone'}
        >
          <Glyph name="mic" size={12} theme={theme} />
          {presence.muted ? 'Mic off' : 'Mic on'}
        </button>
        <button className="pill pill-off" disabled title="The screen watcher isn't built yet (M5)">
          <Glyph name="screen" size={12} theme={theme} />
          Not watching
        </button>
      </div>
    </header>
  )
}

export function SubTabs(props: { section: Section; sub: string | null; onSub(sub: string): void }) {
  const s = SECTIONS.find((x) => x.id === props.section)!
  if (s.subs.length === 0) return null
  return (
    <nav className="subtabs" aria-label={`${s.label} pages`}>
      {s.subs.map((sub) => (
        <button
          key={sub.id}
          className={`tab ${props.sub === sub.id ? 'tab-on' : ''}`}
          aria-current={props.sub === sub.id ? 'page' : undefined}
          onClick={() => props.onSub(sub.id)}
        >
          {sub.label}
        </button>
      ))}
    </nav>
  )
}
