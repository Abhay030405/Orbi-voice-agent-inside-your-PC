// RENDERER: plain React, exactly like your websites. The only new thing is `window.dreamwalker`,
// which plays the role `fetch('/api/...')` plays on a website. Layout from the Claude Design handoff
// (docs/build-log/09-ui.md); styles in ./styles.css, colour tokens in ./theme.css.
//
// This file: the window shell (title bar, sections + sub-tabs, footer, Ctrl K), the audio (speaker,
// mic, push-to-talk), and which page shows. The app opens on Home (design v2, nav.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HomeStats, LedgerEntryView } from '../shared/ipc'
import { Ear } from './audio/ear'
import { Mouth } from './audio/mouth'
import { CommandBar } from './home/CommandBar'
import { Footer, HomePage } from './home/HomePage'
import type { Levels } from './home/levels'
import { NowRail } from './home/NowRail'
import { StatusCluster } from './home/StatusCluster'
import { Timeline } from './home/Timeline'
import { remember, routeFor, type Route, type Section, type Sub } from './nav'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { LedgerPage } from './pages/LedgerPage'
import { PermissionsPage } from './pages/PermissionsPage'
import { PhonePage } from './pages/PhonePage'
import { PrivacyPage, RoutinesPage, WatcherPage } from './pages/PlaceholderPages'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { CommandPalette } from './shell/CommandPalette'
import { SubTabs, TitleBar } from './shell/TitleBar'
import { cleanError, useDreamwalker } from './store'

export function App() {
  const s = useDreamwalker()
  const [route, setRoute] = useState<Route>({ section: 'home', sub: null }) // always opens on Home
  const [palette, setPalette] = useState(false)
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [talking, setTalking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [ledger, setLedger] = useState<LedgerEntryView[]>([])

  // Mouth, Ear and "is the button held" live outside React state: they hold audio hardware or are
  // read inside event handlers, and changing them must not trigger re-renders.
  // useRef = "a box that survives re-renders".
  const mouthRef = useRef<Mouth | null>(null)
  const earRef = useRef<Ear | null>(null)
  const talkingRef = useRef(false)
  const stateRef = useRef(s?.agentState ?? 'idle')
  stateRef.current = s?.agentState ?? 'idle'
  const mutedRef = useRef(false)
  mutedRef.current = s?.presence.muted ?? false

  // Loudness getters for the faces, the mic meter and the command-bar glow (read every frame).
  const levels = useMemo<Levels>(
    () => ({
      mic: () => earRef.current?.level() ?? 0,
      voice: () => mouthRef.current?.level() ?? 0,
      active: () =>
        stateRef.current === 'listening'
          ? (earRef.current?.level() ?? 0)
          : stateRef.current === 'speaking'
            ? (mouthRef.current?.level() ?? 0)
            : 0
    }),
    []
  )

  // Theme: one attribute on <html>; theme.css swaps every colour token.
  useEffect(() => {
    if (s) document.documentElement.dataset.theme = s.settings.theme
  }, [s?.settings.theme])

  // The Ledger (SQLite, in main): reload whenever an action finishes.
  const ledgerVersion = s?.ledgerVersion
  useEffect(() => {
    void window.dreamwalker.getRecentActions(100).then(setLedger)
    void window.dreamwalker.homeStats().then(setStats)
  }, [ledgerVersion, s?.settings.permissions])

  const go = useCallback((next: Route): void => {
    setRoute(next)
    remember(next)
    setPalette(false)
  }, [])

  // Ctrl K: the jump-anywhere palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Mouth (speaker) and Ear (mic) live as long as this component.
  // Mouth: chunks from main go straight in; when it has played everything it tells main, and main
  // decides when the state becomes idle. Ear: 20 ms mic chunks go straight to main.
  useEffect(() => {
    const mouth = new Mouth(() => window.dreamwalker.playbackDone())
    const ear = new Ear((pcm) => window.dreamwalker.micAudio(pcm))
    mouthRef.current = mouth
    earRef.current = ear
    const offs = [
      window.dreamwalker.onAudioChunk((pcm) => mouth.enqueue(pcm)),
      window.dreamwalker.onAudioInterrupted(() => mouth.stop()),
      window.dreamwalker.onWoke(() => mouth.chime())
    ]
    return () => {
      offs.forEach((off) => off())
      mouth.close()
      ear.close()
      mouthRef.current = null
      earRef.current = null
    }
  }, [])

  // Loudness for the edge glow and the companion, ~30×/s: your mic while listening, its voice while
  // speaking. Only sent while active; one final 0 when it goes quiet.
  useEffect(() => {
    let lastSent = -1
    const timer = setInterval(() => {
      const level = levels.active()
      if (level === 0 && lastSent === 0) return
      if (Math.abs(level - lastSent) < 0.02) return
      lastSent = level
      window.dreamwalker.reportLevel(level)
    }, 33)
    return () => clearInterval(timer)
  }, [levels])

  // Wake word listening → mic always open (checked locally in main). Off, or muted → mic only while
  // talking (muted: not even that), and the OS mic indicator goes off.
  const alwaysOn = s?.wake.state === 'listening' && !s.presence.muted
  const alwaysOnRef = useRef(false)
  alwaysOnRef.current = alwaysOn
  useEffect(() => {
    earRef.current?.setAlwaysOn(alwaysOn).catch((err: unknown) => setNotice(`Microphone: ${cleanError(err)}`))
  }, [alwaysOn])

  // The Start button (and "Start talking" in the tray / companion menu): a hands-free conversation, as
  // if it heard its name. With the wake word on, the mic is already streaming; otherwise it opens
  // here and closes again when the conversation ends (state back to idle).
  const handsFreeRef = useRef(false)
  const wakeNow = useCallback((): void => {
    if (mutedRef.current) return
    setNotice(null)
    if (!alwaysOnRef.current && !handsFreeRef.current) {
      handsFreeRef.current = true
      earRef.current?.startListening().catch((err: unknown) => setNotice(`Microphone: ${cleanError(err)}`))
    }
    window.dreamwalker.wakeNow()
  }, [])
  const endNow = useCallback((): void => window.dreamwalker.endConversation(), [])
  useEffect(() => window.dreamwalker.onStartTalking(wakeNow), [wakeNow])
  const agentState = s?.agentState
  useEffect(() => {
    if (agentState !== 'idle' || !handsFreeRef.current) return
    handsFreeRef.current = false
    if (!talkingRef.current) earRef.current?.stopListening()
  }, [agentState])

  // Push-to-talk. Pressing while it speaks = interrupting (B2): stop the voice HERE, instantly,
  // instead of waiting ~0.5 s for Gemini to notice and send "interrupted".
  // Only refs + state setters inside, so the keyboard effect below can safely keep the first copy.
  const startTalking = useCallback((): void => {
    if (talkingRef.current || mutedRef.current) return
    talkingRef.current = true
    setTalking(true)
    setNotice(null)
    mouthRef.current?.stop()
    window.dreamwalker.micStart()
    earRef.current?.startListening().catch((err: unknown) => setNotice(`Microphone: ${cleanError(err)}`))
  }, [])
  const stopTalking = useCallback((): void => {
    if (!talkingRef.current) return
    talkingRef.current = false
    setTalking(false)
    if (!handsFreeRef.current) earRef.current?.stopListening() // a Start conversation still needs the mic
    window.dreamwalker.micStop()
  }, [])

  // Hold Space to talk, unless you're typing in a text box.
  useEffect(() => {
    const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || typing(e)) return
      e.preventDefault()
      startTalking()
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || typing(e)) return
      stopTalking()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [startTalking, stopTalking])

  // invoke() errors from main arrive as rejected promises. Show them instead of failing silently.
  const act = (action: () => Promise<unknown>): void => {
    setNotice(null)
    action().catch((err: unknown) => setNotice(cleanError(err)))
  }
  // Undo / Cancel run as real tool calls in main (checked, logged). Report a refusal in words.
  const runTool = (action: () => Promise<Record<string, unknown>>): void =>
    act(async () => {
      const result = await action()
      if (result.ok === false) setNotice(String(result.error ?? 'That didn’t work.'))
    })
  const onUndo = (id: number): void => runTool(() => window.dreamwalker.undoAction(id))
  const onCancelTask = (id: number): void => runTool(() => window.dreamwalker.cancelTask(id))

  if (!s) return <div className="loading">Starting…</div>

  const theme = s.settings.theme
  const undone = new Set(ledger.filter((e) => e.status === 'undone').map((e) => e.id))
  const undoable = ledger.filter((e) => e.status === 'done' && e.undo !== null)
  const micLabel = s.presence.muted
    ? 'mic: muted'
    : talking
      ? 'mic: live'
      : s.wake.state === 'listening'
        ? 'mic: wake word'
        : 'mic: push-to-talk'

  const pendingAsk = s.session.some((e) => e.kind === 'confirm' && !e.answer)
  // Amber diamonds on sections with something waiting (design v2): a pending question → Activity,
  // caution mode → Safety.
  const phoneAsk = s.session.some((e) => e.kind === 'confirm' && !e.answer && (e.tool ?? '').startsWith('phone_'))
  const attention: Partial<Record<Section, boolean>> = { activity: pendingAsk, phone: phoneAsk, safety: s.presence.caution }
  const send = (text: string): void => act(() => window.dreamwalker.sayText(text))
  const onMute = (muted: boolean): void => act(() => window.dreamwalker.setMuted(muted))

  return (
    <div className="app">
      <TitleBar
        presence={s.presence}
        agentName={s.settings.agentName}
        theme={theme}
        levels={levels}
        section={route.section}
        attention={attention}
        onSection={(section) => go(routeFor(section))}
        onMute={onMute}
      />
      <SubTabs section={route.section} sub={route.sub} onSub={(sub) => go(routeFor(route.section, sub as Sub))} />

      {route.section === 'home' && (
        <HomePage
          s={s}
          levels={levels}
          stats={stats}
          talking={talking}
          micLabel={micLabel}
          onSend={send}
          onTalkStart={startTalking}
          onTalkStop={stopTalking}
          onUndo={onUndo}
          onCancelTask={onCancelTask}
          onGo={go}
          onMute={onMute}
          onWake={wakeNow}
          onEndConversation={endNow}
          onRetry={() => act(() => window.dreamwalker.retryConnection())}
          onReview={() => act(() => window.dreamwalker.focusConfirmation())}
        />
      )}

      {route.sub === 'session' && (
        <>
          <StatusCluster s={s} levels={levels} onMute={onMute} />
          <main className="home">
            <div className="home-left">
              <Timeline
                events={s.session}
                theme={theme}
                agentName={s.settings.agentName}
                undone={undone}
                onUndo={onUndo}
                onCopy={() =>
                  act(async () => {
                    const r = await window.dreamwalker.copySession()
                    setNotice(`Copied ${r.entries} entries. Also saved on this computer: ${r.savedAt}`)
                  })
                }
                emptyHint={
                  s.wake.state === 'listening'
                    ? `Say “${s.wake.phrase}”, hold Space, or type below. Everything it hears, says and does shows up here.`
                    : 'Hold Space or type below. Everything it hears, says and does shows up here.'
                }
              />
              <CommandBar
                theme={theme}
                levels={levels}
                talking={talking}
                micLabel={micLabel}
                disabled={s.presence.muted}
                voiceLive={s.agentState === 'listening' || s.agentState === 'speaking'}
                onSend={send}
                onTalkStart={startTalking}
                onTalkStop={stopTalking}
                onStop={s.agentState === 'speaking' || s.agentState === 'thinking' ? () => window.dreamwalker.stopReply() : undefined}
              />
            </div>
            <NowRail s={s} undoable={undoable} undone={undone} onUndo={onUndo} onCancelTask={onCancelTask} />
          </main>
        </>
      )}
      {route.section !== 'home' && route.sub !== 'session' && (
        <main className="page-scroll">
          {route.sub === 'ledger' && <LedgerPage entries={ledger} theme={theme} undone={undone} onUndo={onUndo} />}
          {route.sub === 'tasks' && <TasksPage tasks={s.tasks} now={s.beat?.at ?? Date.now()} onCancel={onCancelTask} />}
          {route.sub === 'routines' && <RoutinesPage />}
          {route.sub === 'watcher' && <WatcherPage />}
          {route.section === 'phone' && <PhonePage phone={s.phone} />}
          {route.sub === 'permissions' && <PermissionsPage settings={s.settings} />}
          {route.sub === 'privacy' && <PrivacyPage refusedThisWeek={stats?.refusedThisWeek ?? 0} />}
          {route.sub === 'general' && <SettingsPage settings={s.settings} wake={s.wake} />}
          {route.sub === 'diagnostics' && <DiagnosticsPage s={s} />}
        </main>
      )}

      <Footer s={s} onPalette={() => setPalette(true)} />
      {palette && <CommandPalette onGo={go} onClose={() => setPalette(false)} />}

      {notice && (
        <div className="toast" role="alert">
          {notice}
          <button className="link-btn" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
