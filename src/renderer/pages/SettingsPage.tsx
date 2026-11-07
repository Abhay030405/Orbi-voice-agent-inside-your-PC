// SETTINGS: name, theme, and the switches. Every change goes to main, which validates it (main is the
// only judge of what's allowed) and answers with the saved settings, or an error message to show.

import { useState } from 'react'
import type { Settings, Theme, WakeStatus } from '../../shared/ipc'
import { cleanError } from '../store'

const THEMES: Array<[Theme, string, string[]]> = [
  ['graphite', 'Graphite', ['#0E1013', '#14171B', '#7FD3E6', '#F2B54A']],
  ['ember', 'Ember', ['#15130F', '#1C1915', '#74D9B2', '#F4B860']]
]

export function SettingsPage(props: { settings: Settings; wake: WakeStatus }) {
  const { settings, wake } = props
  const [clearing, setClearing] = useState(false)
  const [name, setName] = useState(settings.agentName)
  const [userName, setUserName] = useState(settings.userName)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const save = (patch: Partial<Settings>, success?: string): void => {
    setMessage(null)
    window.dreamwalker
      .updateSettings(patch)
      .then(() => success && setMessage({ ok: true, text: success }))
      .catch((err: unknown) => setMessage({ ok: false, text: cleanError(err) }))
  }

  const toggle = (key: 'wakeWordEnabled' | 'voiceBargeIn' | 'edgeGlow' | 'companion' | 'memory', title: string, hint: string) => (
    <label className="toggle">
      <input type="checkbox" checked={settings[key]} onChange={(e) => save({ [key]: e.target.checked })} />
      <span className="switch" aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
    </label>
  )

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Settings</h1>
        {message && <p className={message.ok ? 'ok' : 'err'}>{message.text}</p>}
      </header>

      <section className="setting">
        <h2 className="rail-label">Name</h2>
        <p className="setting-hint">The wake word becomes “Hey {name.trim() || '…'}”. One or two words.</p>
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault()
            save({ agentName: name }, `Now answering to “Hey ${name.trim()}”`)
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={41} aria-label="Agent name" />
          <button className="btn" type="submit" disabled={name.trim() === settings.agentName}>
            Rename
          </button>
        </form>
      </section>

      <section className="setting">
        <h2 className="rail-label">Your name</h2>
        <p className="setting-hint">For the greeting on Home (“Good evening, {userName.trim().split(' ')[0] || '…'}.”). Optional.</p>
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault()
            save({ userName }, userName.trim() ? `Hi, ${userName.trim().split(' ')[0]}.` : 'Name cleared')
          }}
        >
          <input value={userName} onChange={(e) => setUserName(e.target.value)} maxLength={30} aria-label="Your name" />
          <button className="btn" type="submit" disabled={userName.trim() === settings.userName}>
            Save
          </button>
        </form>
      </section>

      <section className="setting">
        <h2 className="rail-label">Theme</h2>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {THEMES.map(([id, label, swatches]) => (
            <button
              key={id}
              role="radio"
              aria-checked={settings.theme === id}
              className={`theme-card ${settings.theme === id ? 'on' : ''}`}
              onClick={() => settings.theme !== id && save({ theme: id })}
            >
              <span className="swatches">
                {swatches.map((c) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </span>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="setting">
        <h2 className="rail-label">Listening</h2>
        {toggle(
          'wakeWordEnabled',
          'Wake word',
          wake.state === 'unavailable'
            ? `Unavailable: ${wake.detail ?? ''}`
            : 'Mic stays on; audio is checked on this computer and sent only after the wake word.'
        )}
        {toggle('voiceBargeIn', 'Interrupt by just talking', 'Off (recommended): just start talking, or say its name, and it stops; your voice is checked on this computer first, so its own voice from the speakers doesn\'t count. On: the mic goes straight to Gemini while it speaks; use headphones, or it may hear itself.')}
      </section>

      <section className="setting">
        <h2 className="rail-label">Memory</h2>
        {toggle(
          'memory',
          'Remember across days',
          'Gemini forgets a conversation after about 2 hours. With this on, each new conversation starts with a short note about your last few sessions (made from the history on this computer), so it remembers you. That note is sent to Google.'
        )}
        <div className="toggle">
          <span>
            <strong>Clear history</strong>
            <small>
              Start fresh: today&apos;s conversations, the action log and the memory notes. Settings stay, and a backup copy is kept in
              Dreamwalker&apos;s folder. It asks first.
            </small>
          </span>
          <button
            type="button"
            className="btn"
            disabled={clearing}
            onClick={() => {
              setClearing(true)
              window.dreamwalker
                .clearHistory()
                .catch(() => undefined)
                .finally(() => setClearing(false))
            }}
          >
            {clearing ? 'Clearing…' : 'Clear history'}
          </button>
        </div>
      </section>

      <section className="setting">
        <h2 className="rail-label">On screen</h2>
        {toggle('companion', 'Floating companion', 'The small face in the corner. Click it to open this window; drag to move.')}
        {toggle('edgeGlow', 'Edge glow', 'Light up the screen edges while listening, thinking and speaking. Hidden from screenshots.')}
      </section>
    </div>
  )
}
