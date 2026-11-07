// LINK: the live connection to Gemini, and keeping it alive.
// Guides: docs/build-log/02-speak.md (the basics), docs/build-log/05-reconnect.md (surviving drops).
//
// The Link knows nothing about windows, IPC or React. It talks to Gemini and reports what happened
// through the LinkEvents callbacks. Whoever owns it (main/index.ts) decides what to do with that.

import { rms } from '../wake/gate'
import { EndSensitivity, type FunctionDeclaration, FunctionResponseScheduling, GoogleGenAI, type LiveServerMessage, Modality, type Session } from '@google/genai'
import type { LinkStatus } from '../../shared/ipc'
import { aboutDreamwalker } from '../about'
import { GEMINI } from '../config'
import { Outbox, type OutboxKind } from './outbox'

// Gemini asking us to run a tool. `id` ties our answer to this exact request.
export interface ToolCallRequest {
  id: string
  name: string
  args: Record<string, unknown>
}

// Our answer. Same `id` and `name` as the request, plus whatever the tool returned.
export interface ToolCallResult {
  id: string
  name: string
  response: Record<string, unknown>
  // Multimodal tool results: e.g. the screenshot travels back as an image part of this answer.
  parts?: { inlineData: { mimeType: string; data: string } }[]
  // For a background (non-blocking) call: tell the user when nothing else is going on.
  scheduling?: FunctionResponseScheduling
}

export interface LinkEvents {
  onStatus(status: LinkStatus, detail?: string): void
  onAudio(pcm: Uint8Array): void // raw 24 kHz Int16 PCM bytes, ALREADY decoded from base64
  // Gemini finished sending THIS MESSAGE. Not necessarily the whole reply: a turn that ends in a
  // tool call also ends with turnComplete, and the real answer comes in a later turn.
  onTurnComplete(): void
  // Gemini finished GENERATING this message. Arrives before turnComplete, which Gemini delays until
  // the audio would have finished playing.
  onGenerationComplete(): void
  onToolCalls(calls: ToolCallRequest[]): void // Gemini wants these tools run
  onToolCallsCancelled(ids: string[]): void // ...and changed its mind about these (e.g. user interrupted)
  onInterrupted(): void // the user talked over Gemini; it stopped generating. Stop playback NOW.
  onTranscript(role: 'user' | 'model', text: string): void // fragments of what was heard / said
  // The old session couldn't be resumed, so we're on a brand-new one that remembers nothing. Any
  // reply we were waiting for is never coming.
  onContextLost(): void
  // What Gemini has already said of the answer in progress ('' if nothing). Asked during a
  // reconnect: if it's not empty, re-sending the user's question would make Gemini start over.
  partialReply(): string
  // We're connected again after a drop, and the outbox has been replayed.
  onReconnected(info: ReconnectInfo): void
}

export interface ReconnectInfo {
  resumed: boolean // same session (conversation kept) or a brand-new one
  droppedUserInput: boolean // we did NOT re-send the user's unconfirmed question (an answer had started)
  replayedTrigger: boolean // we re-sent something Gemini will answer by itself (question or tool result)
}

const USER_INPUT: OutboxKind[] = ['text', 'audio', 'audioEnd']

// Where the latest resume handle is kept between app runs, so a restart (or a dev-server reload)
// continues the same conversation instead of starting with no memory.
export interface HandleStore {
  load(): string | null // null if none, or too old to still be valid
  save(handle: string | null): void
}

// Built at every connect, so a renamed agent introduces itself by its new name.
export function systemInstruction(agentName: string): string {
  return [
    aboutDreamwalker(agentName),
    `You are ${agentName}, a desktop voice assistant that can act on the user's computer through tools.`,
    'Reply in short, natural spoken sentences, in English unless the user speaks to you in another language.',
    'Use metric units (°C, km, kg) unless the user asks otherwise. For weather, use get_weather (fast), not web_search.',
    // The mic stays open for follow-ups, so it also hears the room. People talking nearby (in Hindi) got
    // answered, in Hindi (2026-10-20). With proactive audio (below) + this line, Gemini stayed silent for
    // 3/3 chatter clips and still did 3/3 real requests (A/B on gemini-3.8-live).
    'The microphone stays open for a few seconds after you answer, so you may hear other people in the room,',
    'a video or music. Only respond when the user is talking TO YOU (a request or question for an assistant);',
    'stay silent for anything else.',
    // The audio sent on wake starts half a second early (so no word is cut off), so it can begin with
    // the end of the wake word. "Hey Orbi … what's the weather" reached Gemini as "Bye." + the question,
    // and it started saying "Goodbye!" (2026-10-20).
    `The user wakes you by saying "Hey ${agentName}", so what you hear can start with the end of your own`,
    'name, which may sound like a short word ("be", "bee", "bye", "me"). Ignore such a fragment and wait',
    'for the actual request; never answer it on its own.',
    'When the user asks you to do something a tool can do, call the tool instead of describing it.',
    'Only say an action succeeded if the tool result says ok: true. If it failed, say so and why.',
    // It said "I've started counting the files" before the result came back (the task had failed), then
    // corrected itself: two replies, one wrong (2026-10-20).
    'While a tool is running, say at most "one moment"; report what happened only after its result arrives.',
    // It said "12 × 7 = 84" after the user had changed the Calculator mid-task: the answer it expected,
    // not what the screen showed (2026-10-20).
    'After clicking or typing in an app, look again (pc_ui_elements or take_screenshot) and report what the screen',
    'actually shows; never report a result you worked out yourself as if the app showed it.',
    'To pause, play or skip music or a video, use media_control (works whatever window is in front); it',
    'toggles: answer in a word or two matching what the user asked ("Paused.", "Playing."). Only when the user says',
    'PLAY something, use play_youtube (it opens the top result, playing). When they say SEARCH or look up on',
    'YouTube, open the results page instead (open_url https://www.youtube.com/results?search_query=...): do not play.',
    'Describe exactly what the tool result says happened, never more. If you could only do part of',
    'what the user asked (for example a new tab instead of the same tab), say so plainly.',
    'When asked what you can do, only name things your tools can really do; never offer an ability you do not have.',
    // Found 2026-10-19: with the PC tools available it still said "I can't switch browser tabs". It
    // didn't connect "tabs" with pc_ui_elements, and the line above made it cautious. So, explicitly:
    'You can see and use this PC like a person at the keyboard: look with pc_ui_elements (the buttons, links,',
    'text boxes and browser tabs of any window) or take_screenshot, then pc_click, pc_type, pc_scroll, or',
    'press_keys (F11 = full screen, ctrl+tab = next tab). To close ONE tab, find it with pc_ui_elements and click',
    'it first, then ctrl+w; close_app closes the whole browser window with all its tabs. With the phone tools',
    "you can do the same on the user's Android phone.",
    'Before saying you cannot do something on the screen, look first; say you cannot only after trying, or when',
    'no tool fits at all. Your tools can change between conversations: if you said earlier that you could not',
    'do something, check your current tools again instead of repeating it.',
    // "Open VS Code and write two sum" took 15 UI steps and 50 s (2026-10-19). Two direct tools do it in 2.
    'Prefer a direct tool over driving the screen: it is faster and exact. To SAVE code or notes in a file, use',
    'create_text_file (in Documents unless the user says where), then open_file with with: "vscode" for code.',
    // "Tell me a long story" got written to a text file instead of told (2026-10-20).
    'When the user asks you to tell, say, explain or describe something, just answer out loud; never put it in',
    'a file unless they ask for a file or document.',
    'For a Word document or a PowerPoint deck, use create_document with about (the topic) and details (what it',
    'must cover), and count if they say how many slides or sections: it writes the full content itself. Then',
    'open_file to show it. For documents that need fresh',
    'facts from the web (prices, comparisons, news), use start_research instead: it works in the background.',
    'Use clicking and typing only when no direct tool fits.',
    // "Click on it" (a live stream on the YouTube home page) became a NEW search, and the video the user
    // pointed at was lost (2026-10-27). Pointing at something on screen means THAT thing.
    'But when the user points at something already on the screen ("click on it", "open that video", "the',
    'second one"), click THAT item: find it with pc_ui_elements (find = a few words of its name) and pc_click',
    'it, or click it in the latest screenshot. Never search for it again or open a new page instead.',
    "For the user's email, calendar, meetings and Google Drive, use the gmail_, calendar_ and drive_ tools (if",
    'Google is not connected yet, offer google_connect). Never send an email or invite without saying exactly what.',
    // Long jobs run in the background (Abhay: Orbi must stay free; progress on request).
    'Documents and research run in the BACKGROUND: say in one short sentence that you started it, then keep',
    'helping with anything else. When the user asks how it is going, call list_tasks and say its latest step.',
    'When the result arrives, tell the user in one sentence.'
  ].join(' ')
}

type Outgoing = (session: Session) => void


// DREAMWALKER_TRACE=1: log every message in and out (audio summarised). For debugging reconnects.
const TRACE = process.env.DREAMWALKER_TRACE === '1'
const traceStart = Date.now()
function trace(direction: 'in' | 'out', text: string): void {
  console.log(`[trace ${String(Date.now() - traceStart).padStart(6)}ms ${direction === 'in' ? '←' : '→'}] ${text}`)
}
function describeMessage(msg: LiveServerMessage): string {
  const parts: string[] = []
  if (msg.setupComplete) parts.push('setupComplete')
  const c = msg.serverContent
  if (c?.modelTurn?.parts?.some((p) => p.inlineData)) parts.push('audio')
  if (c?.outputTranscription?.text) parts.push(`said "${c.outputTranscription.text.trim()}"`)
  if (c?.inputTranscription?.text) parts.push(`heard "${c.inputTranscription.text.trim()}"`)
  if (c?.interrupted) parts.push('interrupted')
  if (c?.generationComplete) parts.push('generationComplete')
  if (c?.turnComplete) parts.push('turnComplete')
  if (msg.toolCall) parts.push(`toolCall ${msg.toolCall.functionCalls?.map((f) => `${f.name}#${f.id}`).join(',')}`)
  if (msg.toolCallCancellation) parts.push(`toolCallCancellation ${msg.toolCallCancellation.ids?.join(',')}`)
  const u = msg.sessionResumptionUpdate
  if (u) parts.push(`resumption(resumable=${u.resumable}, consumed=${u.lastConsumedClientMessageIndex ?? '-'})`)
  if (msg.goAway) parts.push(`goAway ${msg.goAway.timeLeft}`)
  return parts.join(' · ') || Object.keys(msg).join(',')
}

const MAX_BUFFERED_AUDIO = 1500 // 1500 × 20 ms = 30 s of mic audio kept while unconfirmed
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 8000
const RESUME_ATTEMPTS = 2 // after this many failed resumes, give up on the old session

export class Link {
  // Created once and reused for every (re)connect. A fresh client fetches a fresh login token,
  // which cost ~1.6 s per connect in our latency probe (docs/research/latency-probe.md).
  private ai: GoogleGenAI | null = null

  // The open live session, or null whenever we're not connected.
  private session: Session | null = null
  // True once Gemini accepted our setup (setupComplete). Messages go out only after that.
  private ready = false
  // Measured: setupComplete can arrive BEFORE `await ai.live.connect()` hands us the session. So the
  // replay after a reconnect waits for both "ready" and "we have the session", whichever is second.
  // null = no replay pending; otherwise whether the session was resumed.
  private pendingReplay: boolean | null = null
  private everConnected = false

  // Bumped on every connect. Each session's callbacks remember the number they were born with and
  // ignore themselves once it's old. Without this, the OLD session's late "closed" event (after a
  // restart) would mark the NEW, healthy session as disconnected. Same idea as turn numbers.
  private generation = 0

  // Session resumption (B6): Gemini keeps giving us a "handle". Reconnecting with it restores the
  // whole conversation (measured: the resumed session remembered a secret word).
  private resumeHandle: string | null = null
  private readonly outbox = new Outbox<Outgoing>(MAX_BUFFERED_AUDIO)
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private failedAttempts = 0

  // Gemini's planned shutdown notice. We switch at the next end of turn, not mid-sentence.
  private switchAfterTurn = false
  private switchTimer: ReturnType<typeof setTimeout> | null = null

  // `tools` is the menu Gemini gets at connect time. Gemini can only call what's on it.
  // `instructions` is asked for at each connect, so it can change (e.g. the agent's name).
  constructor(
    private readonly events: LinkEvents,
    private readonly tools: FunctionDeclaration[],
    private readonly instructions: () => string,
    private readonly handleStore?: HandleStore
  ) {}

  // ── Connecting ─────────────────────────────────────────────────────────────────────────────

  // First connection at startup: resume the previous run's conversation if its handle is still
  // valid, otherwise a brand-new session.
  connect(): Promise<void> {
    const saved = this.handleStore?.load() ?? null
    if (!saved) return this.open(false)
    this.resumeHandle = saved
    return this.open(true)
  }

  // Throw the current session away and start a brand-new one (e.g. the agent was renamed: the
  // system instruction is fixed for a session's lifetime, so resuming would keep the old name).
  async restart(): Promise<void> {
    this.resumeHandle = null
    this.handleStore?.save(null)
    this.outbox.clear()
    this.abandonCurrent()
    await this.open(false)
  }

  // For testing B6 without pulling the Wi-Fi: close the socket as if the network died.
  simulateDrop(): void {
    this.session?.close() // NOT abandonCurrent(): we want the "unexpected close" path to run
  }

  // why = 'cut': we left on purpose to stop a reply (cancelReply), not a network problem: no
  // "reconnecting" status, so it isn't counted or shown as a dropped connection.
  private async open(resume: boolean, why?: 'cut'): Promise<void> {
    const generation = ++this.generation
    const current = (): boolean => generation === this.generation
    this.ready = false
    this.pendingReplay = null
    // "Reconnecting" only after we've been connected before; at startup it's just "connecting".
    if (why !== 'cut') this.events.onStatus(resume && this.everConnected ? 'reconnecting' : 'connecting')
    this.ai ??= new GoogleGenAI({ vertexai: true, project: GEMINI.project, location: GEMINI.location })

    // The socket can close BEFORE `await` below hands us the session (e.g. Gemini rejects the
    // setup right after the socket opens). Remember that, so we don't store a dead session.
    let closed = false

    let session: Session
    try {
      session = await this.ai.live.connect({
        model: GEMINI.model,
        config: {
          responseModalities: [Modality.AUDIO], // we want spoken replies, not text
          // Orbi's voice: one of Gemini's built-in voices (Abhay picked from samples, 2026-10-21).
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI.voice } } },
          systemInstruction: this.instructions(),
          tools: [{ functionDeclarations: this.tools }],
          // Ask Gemini to also send TEXT of what it heard and what it said. Shown in the UI so a
          // mishearing is visible, and used later to check a spoken "yes" came from the user.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Lets Gemini NOT answer speech that isn't meant for it (people nearby, a video). See the prompt.
          proactivity: { proactiveAudio: true },
          // Gemini Live ends the user's turn at the FIRST short pause by default. Said out loud, "Hey Orbi …
          // play the first video" became two turns: it answered "Hello!" to the name and lost the request
          // (live demo, 2026-10-20). Low sensitivity + 700 ms of silence lets people pause naturally.
          realtimeInputConfig: {
            automaticActivityDetection: { endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW, silenceDurationMs: 700 }
          },
          // B6: keep a resume handle coming, and tell us which of our messages it consumed.
          sessionResumption: { handle: resume ? (this.resumeHandle ?? undefined) : undefined, transparent: true },
          // Long sessions hit the context limit; this makes Gemini forget the oldest turns instead
          // of ending the session.
          contextWindowCompression: { slidingWindow: {} }
        },
        // Arrow functions on purpose: they keep `this` pointing at this Link.
        callbacks: {
          onopen: () => {},
          onmessage: (msg) => {
            if (current()) this.handleMessage(msg, resume)
          },
          onerror: (e) => {
            if (current()) console.error(`[link] socket error: ${e.message}`)
          },
          onclose: (e) => {
            closed = true
            if (!current()) return // an old session we abandoned on purpose: not news
            const reason = `closed ${e.code}${e.reason ? `: ${e.reason}` : ''}`
            const wasReady = this.ready
            this.session = null
            this.ready = false
            // Closed before Gemini accepted the setup = this attempt failed (e.g. stale handle).
            if (!wasReady) this.failedAttempts++
            this.scheduleReconnect(reason)
          }
        }
      })
    } catch (err) {
      // Couldn't even open the socket (e.g. no internet). Try again later.
      if (current()) {
        this.failedAttempts++
        this.scheduleReconnect(err instanceof Error ? err.message : String(err))
      }
      return
    }

    if (!closed && current()) {
      this.session = session
      this.flushIfReady()
    } else if (!current()) {
      session.close() // a newer open() started while we were waiting
    }
  }

  // Unexpected close: keep trying, waiting longer each time (0.5 s, 1 s, 2 s … 8 s), so a dead
  // network isn't hammered. Resume the old session while that's still possible.
  private scheduleReconnect(reason: string): void {
    if (this.retryTimer) return
    // At startup, try the saved handle only once: if it fails, it's probably expired, and the user
    // shouldn't wait through retries for a conversation they may not even remember.
    const attempts = this.everConnected ? RESUME_ATTEMPTS : 1
    const resume = this.resumeHandle !== null && this.failedAttempts < attempts
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, this.failedAttempts - 1))
    this.events.onStatus('reconnecting', `${reason}, retrying in ${(delay / 1000).toFixed(1)} s`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.open(resume)
    }, delay)
  }

  // Forget the current session without triggering a reconnect.
  private abandonCurrent(): void {
    const old = this.session
    this.session = null
    this.ready = false
    this.generation++ // silences the old session's callbacks before it closes
    old?.close()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  // ── Receiving ──────────────────────────────────────────────────────────────────────────────

  // Everything Gemini sends arrives here. One message can carry several things at once, so check
  // each with its own `if`, never `else if`.
  private handleMessage(msg: LiveServerMessage, resumed: boolean): void {
    if (TRACE) trace('in', describeMessage(msg))
    if (msg.setupComplete) this.onReady(resumed)

    const update = msg.sessionResumptionUpdate
    if (update?.resumable && update.newHandle) {
      this.resumeHandle = update.newHandle
      this.handleStore?.save(update.newHandle)
    }
    if (update?.lastConsumedClientMessageIndex) {
      this.outbox.confirm(Number(update.lastConsumedClientMessageIndex))
    }

    if (msg.goAway) this.planSwitch(msg.goAway.timeLeft)

    // First, before any audio in this message: if the user barged in, old audio must stop.
    if (msg.serverContent?.interrupted) this.events.onInterrupted()

    const heard = msg.serverContent?.inputTranscription?.text
    if (heard) this.events.onTranscript('user', heard)
    const said = msg.serverContent?.outputTranscription?.text
    if (said) this.events.onTranscript('model', said)

    for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
      const base64 = part.inlineData?.data
      if (base64) this.events.onAudio(new Uint8Array(Buffer.from(base64, 'base64')))
    }

    // Checked BEFORE turnComplete: if one message ever carried both, the owner must learn about the
    // tool call first, or it would treat the turnComplete as the end of the whole reply.
    const calls = msg.toolCall?.functionCalls ?? []
    if (calls.length > 0) {
      this.events.onToolCalls(calls.map((c) => ({ id: c.id ?? '', name: c.name ?? '', args: c.args ?? {} })))
    }

    const cancelled = msg.toolCallCancellation?.ids ?? []
    if (cancelled.length > 0) this.events.onToolCallsCancelled(cancelled)

    if (msg.serverContent?.generationComplete) this.events.onGenerationComplete()
    if (msg.serverContent?.turnComplete) {
      this.events.onTurnComplete()
      if (this.switchAfterTurn) this.switchNow()
    }
  }

  private onReady(resumed: boolean): void {
    this.ready = true
    this.failedAttempts = 0

    // A resumed session continues the old conversation. A fresh one while we still held a handle
    // means resuming failed: it starts blank, and whatever we were waiting for is gone.
    const lostContext = !resumed && this.resumeHandle !== null
    if (lostContext) {
      this.resumeHandle = null
      this.handleStore?.save(null)
    }
    this.events.onStatus('connected', resumed ? 'resumed: conversation kept' : undefined)
    // At startup nothing was in progress, so a failed resume isn't worth a "please repeat that".
    if (lostContext && this.everConnected) this.events.onContextLost()

    this.pendingReplay = resumed
    this.flushIfReady()
  }

  // Re-send everything the server never confirmed, plus what we queued while offline, as soon as
  // Gemini is ready AND we hold the session object.
  private flushIfReady(): void {
    if (this.pendingReplay === null || !this.ready || !this.session) return
    const resumed = this.pendingReplay
    this.pendingReplay = null

    const firstConnection = !this.everConnected
    this.everConnected = true
    const items = this.outbox.takeForReplay(resumed)
    if (firstConnection) {
      for (const { kind, message } of items) this.deliver(kind, message)
      return
    }

    // Gemini only confirms messages at the END of a turn, so the user's question is usually still
    // "unconfirmed" while it's being answered. If the answer had already started, re-sending the
    // question makes Gemini answer it again from the beginning (measured: "One… Two…" → "One. Two.
    // Three…"). So in that case we hold the question back, and the owner sends a "continue" note.
    const answerStarted = this.events.partialReply().trim() !== ''
    let droppedUserInput = false
    let replayedTrigger = false
    for (const { kind, message } of items) {
      if (answerStarted && USER_INPUT.includes(kind)) {
        droppedUserInput = true
        continue
      }
      if (kind === 'text' || kind === 'audioEnd' || kind === 'toolResult') replayedTrigger = true
      this.deliver(kind, message)
    }
    this.events.onReconnected({ resumed, droppedUserInput, replayedTrigger })
  }

  // Gemini warned it will close this connection soon (timeLeft like "50s"). Switch to a resumed
  // session at the next end of turn, or just before the deadline, whichever comes first.
  private planSwitch(timeLeft: string | undefined): void {
    if (this.switchAfterTurn) return
    this.switchAfterTurn = true
    const seconds = Number.parseFloat(timeLeft ?? '') || 10
    this.switchTimer = setTimeout(() => this.switchNow(), Math.max(0, (seconds - 3) * 1000))
  }

  private switchNow(): void {
    this.switchAfterTurn = false
    if (this.switchTimer) clearTimeout(this.switchTimer)
    this.switchTimer = null
    if (!this.resumeHandle) return // nothing to resume with: let the close happen and reconnect then
    console.log('[link] planned switch to a resumed session (goAway)')
    this.abandonCurrent()
    void this.open(true)
  }

  // ── Sending ────────────────────────────────────────────────────────────────────────────────
  // Everything goes through deliver(): sent now if connected, otherwise queued. Either way it sits
  // in the outbox until Gemini confirms it, so a drop can't lose it.

  private deliver(kind: OutboxKind, message: Outgoing): void {
    if (this.session && this.ready) {
      message(this.session)
      this.outbox.sent(kind, message)
      if (TRACE && kind !== 'audio') trace('out', `${kind} (outbox ${this.outbox.size})`)
    } else {
      this.outbox.queued(kind, message)
      if (TRACE && kind !== 'audio') trace('out', `${kind} QUEUED (offline)`)
    }
  }

  // One 20 ms mic chunk.
  sendAudio(pcm: Uint8Array): void {
    if (TRACE) this.traceLoudness(pcm)
    const data = Buffer.from(pcm).toString('base64')
    this.deliver('audio', (s) => s.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } }))
  }

  // Trace only: how loud the audio we send is, once a second (peak RMS of the last 50 chunks). Found
  // while chasing "Gemini receives the audio but hears nothing" (2026-10-20).
  private loudChunks = 0
  private loudPeak = 0
  private traceLoudness(pcm: Uint8Array): void {
    this.loudPeak = Math.max(this.loudPeak, rms(pcm))
    if (++this.loudChunks < 50) return
    trace('out', `audio ×50, peak RMS ${this.loudPeak.toFixed(4)}`)
    this.loudChunks = 0
    this.loudPeak = 0
  }

  // "The mic just went off." Tells Gemini's voice detector not to wait for more audio.
  endAudio(): void {
    this.deliver('audioEnd', (s) => s.sendRealtimeInput({ audioStreamEnd: true }))
  }

  // If we're offline, the result waits in the outbox and goes out after a resumed reconnect, which
  // still remembers the pending call (so "every ritual already running finishes correctly", B6).
  sendToolResults(results: ToolCallResult[]): void {
    this.deliver('toolResult', (s) => s.sendToolResponse({ functionResponses: results }))
  }

  // A note from the app (not the user) asking Gemini to pick up where a dropped connection cut it
  // off. Sent as a normal turn; the UI doesn't show it as something the user said.
  nudge(text: string): void {
    this.deliver('text', (s) =>
      s.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true })
    )
  }

  // The user cut the answer off (talked over it, said its name, pressed Stop) while Gemini was still
  // generating it. Muting our speakers isn't enough: Gemini kept generating the rest (measured 2026-10-31:
  // stopped after "Apple Inc., headquartered in Cupertino," and 60 more audio messages still came, to the
  // end of the 100 words), and we'd pay for tokens nobody hears. Neither a client message with
  // turnComplete: false nor the user's own voice passed on to it stopped it (same day). What does: leaving
  // the connection and resuming the same session. Gemini doesn't keep an answer that was still being
  // generated when its connection went (docs/build-log/05-reconnect.md), so the rest is never made, and
  // the conversation before it is kept (measured: 0 audio messages after, the next question answered).
  // The cut-off request's unconfirmed messages are dropped first: Gemini was already answering them, and
  // replaying them would make it answer again from the start. What the user says next (their voice
  // right after talking over it) is queued in the outbox meanwhile and sent as soon as it's back.
  cancelReply(): void {
    if (!this.session || !this.ready || !this.resumeHandle) return
    this.outbox.clear()
    this.abandonCurrent()
    void this.open(true, 'cut')
  }

  sayText(text: string): void {
    if (!this.session && !this.resumeHandle && !this.retryTimer) {
      throw new Error('Not connected to Gemini yet. Check the status line and try again.')
    }
    this.deliver('text', (s) =>
      s.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true // "I'm done talking, your turn": Gemini starts replying now
      })
    )
  }
}
