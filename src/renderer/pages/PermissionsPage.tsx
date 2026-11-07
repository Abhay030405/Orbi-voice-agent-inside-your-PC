// PERMISSIONS: per tool, like Claude Code. Default = low-risk runs, high-risk asks.
// Loosening ("always allow") needs a yes in the native Windows dialog (main checks; a page script
// can't click it). Caution mode still asks, whatever you choose here.

import { useEffect, useState } from 'react'
import type { Settings, ToolInfo, ToolPolicy } from '../../shared/ipc'
import { cleanError } from '../store'

type Choice = 'default' | ToolPolicy
const CHOICES: Array<[Choice, string]> = [
  ['default', 'Default'],
  ['allow', 'Allow'],
  ['ask', 'Ask'],
  ['deny', 'Never']
]

export function PermissionsPage(props: { settings: Settings }) {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    void window.dreamwalker.listTools().then(setTools)
  }, [])

  const set = (tool: string, choice: Choice): void => {
    const permissions = { ...props.settings.permissions }
    if (choice === 'default') delete permissions[tool]
    else permissions[tool] = choice
    setMessage(null)
    window.dreamwalker
      .updateSettings({ permissions })
      .then(() => setMessage({ ok: true, text: `${tool}: ${choice === 'default' ? 'back to default' : choice}` }))
      .catch((err: unknown) => setMessage({ ok: false, text: cleanError(err) }))
  }

  const groups: Array<[string, ToolInfo[]]> = [
    ['Changes things', tools.filter((t) => t.effect === 'write')],
    ['Sends things to Gemini', tools.filter((t) => t.effect === 'upload')],
    ['Only reads', tools.filter((t) => t.effect === 'read')]
  ]

  return (
    <div className="page">
      <header className="page-head">
        <h1>Permissions</h1>
        <p className="page-intro">
          Default: low-risk actions run, high-risk ones ask first. “Allow” needs your OK in a Windows dialog. In caution mode
          (after it read a web page, a file or the screen) every change asks, whatever this says.
        </p>
        {message && <p className={message.ok ? 'ok' : 'err'}>{message.text}</p>}
      </header>
      {groups.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title} className="perm-group">
            <h2 className="rail-label">{title}</h2>
            {list.map((t) => {
              const current: Choice = props.settings.permissions[t.name] ?? 'default'
              return (
                <div key={t.name} className="perm-row">
                  <div className="perm-info">
                    <code>{t.name}</code>
                    {t.risk === 'high' && <span className="badge">high risk</span>}
                    <p title={t.description}>{t.description}</p>
                  </div>
                  <div className="segmented" role="radiogroup" aria-label={`Permission for ${t.name}`}>
                    {CHOICES.map(([choice, label]) => (
                      <button
                        key={choice}
                        role="radio"
                        aria-checked={current === choice}
                        className={current === choice ? 'on' : ''}
                        onClick={() => current !== choice && set(t.name, choice)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )
      )}
    </div>
  )
}
