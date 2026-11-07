// HOME (design v2, "what opens first"): calm on purpose. A face, one sentence, one command bar, three
// cards (needs you / running / today), and a row of places to go. The busy console is one click away
// (Activity → Session). When a confirmation is pending, the hero becomes that question (#3b).
//
// Everything shown is real: features that don't exist yet (phone, routines, watcher) say so.

import { useEffect, useRef } from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import type { HomeStats, SessionEvent } from '../../shared/ipc'
import { Face } from '../face/Face'
import type { Route } from '../nav'
import { duration, shortClock, type DwState } from '../store'
import { ActionText, actionWords } from '../ui/ActionText'
import { Glyph } from '../ui/Glyph'
import { phoneLine } from '../pages/PhonePage'
import { useWindowVisible } from '../visibility'
import { CommandBar } from './CommandBar'
import type { Levels } from './levels'

type Confirm = Extract<SessionEvent, { kind: 'confirm' }>
const STARTERS = ['What’s on my screen?', 'Open YouTube', 'What time is it?']
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export interface HomeProps {
  s: DwState
  levels: Levels
  stats: HomeStats | null
  talking: boolean
  micLabel: string
  onSend(text: string): void
  onTalkStart(): void
  onTalkStop(): void
  onWake(): void // Start: a hands-free conversation, as if it heard its name
  onEndConversation(): void
  onUndo(ledgerId: number): void
  onCancelTask(taskId: number): void
  onGo(route: Route): void
  onMute(muted: boolean): void
  onRetry(): void
  onReview(): void
}

function greeting(name: string): string {
  const h = new Date().getHours()
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return name ? `Good ${part}, ${name.split(' ')[0]}.` : `Good ${part}.`
}

// The sentence under the greeting: what it's doing right now, in words (design §5).
function statusSentence(s: DwState): string {
  const p = s.presence
  const speech = [...s.session].reverse().find((e) => e.kind === 'you' || e.kind === 'agent')
  const recent = speech && Date.now() - speech.at < 20_000 && 'text' in speech ? speech.text.trim() : ''
  let line: string
  if (p.face === 'paused') line = 'Mic is off. It can’t hear anything.'
  else if (p.face === 'offline') line = 'Can’t reach the model. The wake word still works on this computer.'
  else if (p.face === 'acting') {
    const card = [...s.session].reverse().find((e) => e.kind === 'tool' && e.status === 'running')
    line = card && card.kind === 'tool' ? `Working on it: ${card.sentence}…` : `${p.label}…`
  } else if (p.face === 'listening' || p.face === 'thinking' || p.face === 'speaking') {
    line = recent ? `“${recent.length > 140 ? `…${recent.slice(-140)}` : recent}”` : `${p.label}…`
  } else if (p.face === 'task') {
    const t = s.tasks.find((x) => x.status === 'running')
    line = `Working on “${t?.title ?? 'a task'}” in the background. Ask anything meanwhile.`
  } else if (s.wake.state === 'listening') {
    line = `Listening for “${s.wake.phrase}” on this computer only. Nothing is sent until you say it.`
  } else {
    line = 'Hold Space or type below. Nothing is sent until you do.'
  }
  if (p.caution && p.cautionSource) line += ` Extra confirmations are on: it just read ${p.cautionSource}.`
  return line
}

// Up to 3 suggestions: your own recent requests (short ones), else starters.
function suggestions(session: SessionEvent[]): string[] {
  const mine: string[] = []
  for (const e of [...session].reverse()) {
    if (e.kind !== 'you') continue
    const t = e.text.trim().replace(/[.?!]+$/, '')
    if (t.length < 3 || t.length > 40 || mine.some((m) => m.toLowerCase() === t.toLowerCase())) continue
    mine.push(t)
    if (mine.length === 3) break
  }
  return mine.length > 0 ? mine : STARTERS
}

// One click instead of the wake word (when it isn't heard, or is off). The same button stops listening,
// and interrupts while it speaks, like saying its name would.
function TalkButton(props: { s: DwState; onWake(): void; onEnd(): void }) {
  const { agentState, settings } = props.s
  const [label, onClick] =
    agentState === 'listening'
      ? ['Listening… click to stop', props.onEnd]
      : agentState === 'speaking'
        ? ['Click to interrupt', props.onWake]
        : agentState === 'thinking'
          ? ['Thinking…', undefined]
          : [`Talk to ${settings.agentName}`, props.onWake]
  return (
    <button
      type="button"
      className={`talk-btn ${agentState === 'idle' ? '' : 'talk-live'}`}
      onClick={onClick}
      disabled={!onClick}
      title="Starts a conversation, the same as saying its name"
    >
      <Glyph name="mic" size={15} theme={settings.theme} />
      {label}
    </button>
  )
}

export function HomePage(props: HomeProps) {
  const { s, stats } = props
  const theme = s.settings.theme
  const visible = useWindowVisible()
  const pending = s.session.filter((e): e is Confirm => e.kind === 'confirm' && !e.answer)
  const ask = pending.at(-1)
  const running = s.tasks.filter((t) => t.status === 'running')
  const phoneAsk = pending.some((e) => (e.tool ?? '').startsWith('phone_'))
  const reviewRef = useRef<HTMLButtonElement>(null)

  // Move focus to "Review" only if this window already had it: never steal focus from other apps.
  useEffect(() => {
    if (ask && document.hasFocus()) reviewRef.current?.focus()
  }, [ask?.id])

  const commandBar = (variant: 'hero' | 'compact') => (
    <CommandBar
      variant={variant}
      theme={theme}
      levels={props.levels}
      talking={props.talking}
      micLabel={props.micLabel}
      disabled={s.presence.muted}
      voiceLive={s.agentState === 'listening' || s.agentState === 'speaking'}
      onSend={props.onSend}
      onTalkStart={props.onTalkStart}
      onTalkStop={props.onTalkStop}
      onStop={s.agentState === 'speaking' || s.agentState === 'thinking' ? () => window.dreamwalker.stopReply() : undefined}
    />
  )

  return (
    <main className="home2">
      {/* The key makes React swap the hero, so the CSS cross-fade plays when the mode changes. */}
      <section className={`hero ${ask ? 'hero-ask' : ''}`} key={ask ? 'ask' : 'everyday'}>
        <Face presence={s.presence} size={104} level={props.levels.active} followCursor />
        {ask ? (
          <>
            <h1 className="greeting">{pending.length > 1 ? `${pending.length} things need you.` : 'One thing needs you.'}</h1>
            {/* Screen readers: say it at once (assertive) — this is the one thing that must not be missed. */}
            <div className="sr-only" aria-live="assertive">
              Dreamwalker needs your confirmation: {actionWords(ask.action)}
            </div>
            <div className="pending">
              <div className="pending-head">
                <span className="diamond diamond-9" aria-hidden="true" />
                <span className="pending-label">
                  Waiting for your yes{ask.risk === 'high' ? ' · high risk' : ''}
                </span>
                {ask.tool && <code className="pending-tool">{ask.tool}</code>}
              </div>
              <ActionText action={ask.action} className="pending-action" />
              <p className="pending-note">
                {ask.undoable ? 'It can be undone afterwards.' : ask.irreversible ? 'This can’t be undone.' : 'Nothing permanent.'}{' '}
                {ask.untrusted
                  ? `It came up after reading ${ask.untrusted}, which could contain instructions: check it’s what you asked for.`
                  : 'No untrusted content was involved.'}
              </p>
              <div className="pending-actions">
                {/* Not an Allow button: it only brings the trusted dialog forward. Only the dialog or your voice decides. */}
                <button ref={reviewRef} className="btn-att" onClick={props.onReview}>
                  Review in confirmation window
                </button>
                <span className="pending-voice">
                  <Glyph name="mic" size={12} theme={theme} /> or say “yes” or “no”
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="greeting">{greeting(s.settings.userName)}</h1>
            <p className="status-line" aria-live="polite">
              {statusSentence(s)}
              {s.presence.face === 'paused' && (
                <button className="link-btn inline-btn" onClick={() => props.onMute(false)}>
                  Resume
                </button>
              )}
              {s.presence.face === 'offline' && (
                <button className="link-btn inline-btn" onClick={props.onRetry}>
                  Retry
                </button>
              )}
            </p>
            {!s.presence.muted && <TalkButton s={s} onWake={props.onWake} onEnd={props.onEndConversation} />}
            <div className="hero-bar">{commandBar('hero')}</div>
            <div className="try">
              <span>Try:</span>
              {suggestions(s.session).map((t) => (
                <button key={t} className="try-pill" onClick={() => props.onSend(t)}>
                  “{t}”
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="cards" aria-label="Now">
        {ask ? (
          <div className="card2">
            <div className="card-label">Ask or tell it</div>
            {commandBar('compact')}
            <p className="card-sub">The command bar moves down while a confirmation is pending.</p>
          </div>
        ) : (
          <div className="card2">
            <div className="card-label">Needs you</div>
            <div className="card2-title">Nothing right now</div>
            <p className="card-sub">Before anything risky, it asks you in its own window.</p>
          </div>
        )}

        <div className="card2">
          <div className="card-label">Running</div>
          {running.length === 0 ? (
            <>
              <div className="card2-title">Nothing running</div>
              <p className="card-sub">Long jobs keep going here while you talk.</p>
            </>
          ) : (
            <>
              <div className="run-head">
                <ThinkingOrb state="working" size={20} theme="dark" paused={reducedMotion.matches || !visible} aria-label="running" />
                <span className="card2-title run-title">{running[0].title}</span>
                <code className="run-time">{duration(Math.max(running[0].seconds, ((s.beat?.at ?? Date.now()) - running[0].startedAt) / 1000))}</code>
              </div>
              {/* Our tasks can't report a percentage, so the bar sweeps instead of filling. */}
              <div className="bar bar-sweep" aria-hidden="true">
                <span />
              </div>
              <div className="run-foot">
                <code className="dim run-line">{running[0].lastLine || 'no output yet'}</code>
                <button className="btn" onClick={() => props.onCancelTask(running[0].id)}>
                  Cancel
                </button>
              </div>
              {running.length > 1 && (
                <button className="link-btn card-link" onClick={() => props.onGo({ section: 'activity', sub: 'tasks' })}>
                  +{running.length - 1} more →
                </button>
              )}
            </>
          )}
        </div>

        <div className="card2">
          <div className="card-label">Today</div>
          {stats === null || stats.today === 0 ? (
            <>
              <div className="card2-title">No actions yet today</div>
              <p className="card-sub">Everything it does is written to the Ledger first.</p>
            </>
          ) : (
            <>
              <div className="card2-title">
                {stats.today} action{stats.today === 1 ? '' : 's'}
                {stats.todayFailed === 0 ? ', none failed' : <span className="err"> · {stats.todayFailed} failed</span>}
              </div>
              {stats.last && (
                <div className="today-last">
                  <span className="today-text" title={stats.last.text}>
                    Last: {stats.last.text} · {shortClock(stats.last.at)}
                  </span>
                  {stats.last.undoable && (
                    <button className="link-btn" onClick={() => props.onUndo(stats.last!.id)}>
                      Undo
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <button className="link-btn card-link card-bottom" onClick={() => props.onGo({ section: 'activity', sub: 'session' })}>
            Open session timeline →
          </button>
        </div>
      </section>

      <section className="goto" aria-label="Go to">
        <div className="card-label">Go to</div>
        <div className="goto-row">
          <Tile glyph="tile" name="Routines" line="Coming soon" onClick={() => props.onGo({ section: 'automations', sub: 'routines' })} theme={theme} />
          <Tile
            glyph="phone"
            name="Phone"
            line={phoneAsk ? '1 action waiting' : phoneLine(s.phone)}
            attention={phoneAsk}
            onClick={() => props.onGo({ section: 'phone', sub: null })}
            theme={theme}
          />
          <Tile glyph="screen" name="Watcher" line="Off · coming soon" onClick={() => props.onGo({ section: 'automations', sub: 'watcher' })} theme={theme} />
          <Tile
            glyph="check"
            name="Permissions"
            line={stats?.customRules ? `${stats.customRules} custom rule${stats.customRules === 1 ? '' : 's'}` : 'Default: risky actions ask'}
            onClick={() => props.onGo({ section: 'safety', sub: 'permissions' })}
            theme={theme}
          />
          <Tile
            glyph="caution"
            name="Privacy"
            line={
              s.presence.caution
                ? `Extra confirmations on: it read ${s.presence.cautionSource ?? 'outside content'}`
                : `${stats?.refusedThisWeek ?? 0} action${stats?.refusedThisWeek === 1 ? '' : 's'} refused this week`
            }
            attention={s.presence.caution}
            onClick={() => props.onGo({ section: 'safety', sub: 'privacy' })}
            theme={theme}
          />
        </div>
      </section>
    </main>
  )
}

function Tile(props: {
  glyph: 'tile' | 'phone' | 'screen' | 'check' | 'caution'
  name: string
  line: string
  attention?: boolean
  theme: DwState['settings']['theme']
  onClick(): void
}) {
  return (
    <button className={`tile ${props.attention ? 'tile-att' : ''}`} onClick={props.onClick}>
      <span className="tile-name">
        <Glyph name={props.glyph} size={14} theme={props.theme} className="tile-glyph" />
        {props.name}
      </span>
      <span className="tile-line">{props.line}</span>
    </button>
  )
}

// The thin status line at the bottom of every screen (design v2 §3d).
export function Footer(props: { s: DwState; onPalette(): void }) {
  const { link, health } = props.s
  const left =
    link.status === 'disconnected'
      ? `offline${link.detail ? ` · ${link.detail}` : ''}`
      : link.status === 'connected'
        ? `${health.model} · ${health.region}${health.firstAudioMs !== null ? ` · ${health.firstAudioMs} ms` : ''} · ${health.reconnects} reconnect${health.reconnects === 1 ? '' : 's'} today`
        : `${link.status}…`
  return (
    <footer className="statusbar">
      <span className={link.status === 'disconnected' ? 'err' : ''}>{left}</span>
      <button className="statusbar-hint" onClick={props.onPalette}>
        Ctrl K to jump anywhere
      </button>
    </footer>
  )
}
