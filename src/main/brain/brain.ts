// BRAIN: the agent's state machine. It decides what state we're in and where mic audio goes.
// Guide: docs/build-log/04-wake-word.md.
//
// Pure TypeScript: no Electron, no Gemini SDK, no timers it can't be told about. Everything it does
// to the outside world goes through BrainHooks. That's what makes it unit-testable
// (brain.test.ts runs it with fake hooks, no app needed).
//
// Where mic audio goes, by situation:
//   idle, wake word on      → wake-word spotter only (never leaves the computer)
//   push-to-talk held       → Gemini
//   conversation open       → Gemini (follow-ups without saying the wake word again)
//   speaking + no barge-in  → nowhere (so Gemini can't hear its own voice); checked on this computer
//                             for the wake word and for the user talking over it (wake/bargein.ts)

import type { AgentState } from '../../shared/ipc'
import { rms } from '../wake/gate.ts'

// Loud enough to be someone talking near the mic (a quiet room with noise suppression is ~0.001–0.003;
// speech ~0.03–0.3). Only used to keep an open conversation from closing mid-sentence.
const SPEECH_RMS = 0.02
// Interrupting its own speech by name: send only the last 0.8 s from before (see wake()).
const INTERRUPT_PREROLL = 40

export interface BrainHooks {
  emitState(state: AgentState): void
  sendMicToModel(pcm: Uint8Array): void
  endMicToModel(): void // tell Gemini the mic stream paused, so it answers without waiting
  feedWakeWord(pcm: Uint8Array): boolean // true = wake phrase just heard
  resetWakeWord(): void
  playToSpeaker(pcm: Uint8Array): void
  stopSpeaker(): void // drop everything queued, right now
  wakeCue(reason?: 'voice'): void // a short sound so the user knows it's listening ('voice' = talked over it)
  replyStarted(): void // a new request began: forget what the previous reply said
  // Optional (tests may leave them out):
  // Is the user talking over the reply right now? Speech detection on THIS computer, on the echo-cancelled
  // mic; it decides by itself what counts (wake/bargein.ts). Asked only while it speaks.
  talkingOver?(pcm: Uint8Array): boolean
  speakingStarted?(): void // a reply started playing: the talking-over check starts fresh
  // Stop Gemini generating the rest of a reply the user cut off (talked over it, said its name, Stop).
  // Without it, a 100-word answer stopped at word 10 was still generated (and paid for) to the end, then
  // thrown away (measured 2026-10-31, even when the user's voice was passed on to Gemini).
  cancelModelReply?(): void
}

export interface BrainOptions {
  noSpeechMs: number // after the wake word, give up if the user says nothing for this long
  followUpMs: number // after a reply, keep listening this long for a follow-up
  thinkingAfterMs: number // user silent this long mid-conversation → show "thinking"
  preRollChunks: number // how many recent mic chunks to send along when the wake word fires
  wakeWordEnabled(): boolean
  voiceBargeIn(): boolean // may the user interrupt by talking? (needs good echo cancellation)
  // May the conversation stay open for a follow-up? No while another app plays sound: the mic would hear
  // the video and Gemini would answer IT (a YouTube ad did, 2026-10-20). Then it's the wake word again.
  followUpAllowed?(): boolean
  // Hold the mic back while it works on the answer? Yes while another app plays sound: the video kept
  // talking after "play it on my phone too", got into the request, and was answered (2026-10-21).
  micHeldWhileThinking?(): boolean
}

type Timer = ReturnType<typeof setTimeout>

export class Brain {
  private current: AgentState = 'idle'
  private readonly hooks: BrainHooks
  private readonly opts: BrainOptions

  private conversation = false // opened by the wake word
  private pushToTalk = false // talk button held

  // Is the CURRENT reply over? Both must be true: Gemini sent its last message, and the speakers
  // finished playing. Gemini sends faster than real time (docs/build-log/02-speak.md).
  private replySent = true
  private playbackDrained = true

  // A turn that asks for a tool also ends with its own turnComplete; skip those (docs/build-log/03-tools.md).
  private toolTurnsOpen = 0
  // Started with a key (Space, Ctrl+Shift+Space, Start), not the wake word: the user chose to talk, so
  // follow-ups stay open even while a video plays (2026-10-27: the key is used BECAUSE a video plays).
  private byKey = false
  private modelActing = false // Gemini has asked for a tool in this request: the user's turn is really over
  // Gemini finished GENERATING the current answer. Its turnComplete can come much later (it waits
  // until the audio would have finished playing), so after a reconnect this is the reliable signal
  // that nothing more is coming. Tool turns send their own generationComplete; skip those too.
  private generationDone = false
  private toolGenerationsOpen = 0
  // We treat generationComplete as "the answer is done" (so the glow and state don't lag behind
  // Gemini's late turnComplete). That turn's turnComplete still arrives later, maybe after the user
  // asked something new, so we count how many we owe and swallow them. A counter, not a flag: two
  // can be outstanding if the user asks again quickly.
  private turnClosesOwed = 0

  // The user started something new while the OLD reply was still streaming in. Its leftover audio
  // is stale ("stale echoes", PS B2): drop it until Gemini confirms that turn is over.
  private staleTurnOpen = false

  // The last few hundred ms of mic audio while idle. The spotter only confirms the wake phrase a
  // moment AFTER it ends, and by then the user is already saying their request: "Hey Dreamwalker,
  // what time…" reached Gemini as "time is it?". Sending this buffer on wake gives the cut-off word
  // back. (Lives in RAM only, overwritten constantly, and sent only after the wake word.)
  private preRoll: Uint8Array[] = []

  private conversationTimer: Timer | null = null
  private thinkingTimer: Timer | null = null

  // A reply finished and the conversation is open for a follow-up. The next words the user says are a
  // NEW request: it must start trusted and without the previous task's "yes" (found 2026-10-19: caution
  // from reading a YouTube page carried over to "open VS Code", and every small step asked again).
  private followUpOpen = false

  constructor(hooks: BrainHooks, opts: BrainOptions) {
    this.hooks = hooks
    this.opts = opts
  }

  get state(): AgentState {
    return this.current
  }

  // True while the rest of a talked-over (or stopped) reply is still arriving and being thrown away.
  get discardingReply(): boolean {
    return this.staleTurnOpen
  }

  // The window after a reply, when the next words are taken without the wake word.
  get followUpByKey(): boolean {
    return this.byKey
  }

  get inFollowUp(): boolean {
    return this.followUpOpen && this.conversation && this.current === 'listening' && !this.pushToTalk
  }

  // Are we waiting for Gemini to (finish) answer(ing)? Used after a reconnect: if yes, the resumed
  // session must be nudged, because an answer that was being generated when the connection died is
  // not saved by Gemini, and it won't restart it on its own (measured, docs/build-log/05-reconnect.md).
  get awaitingReply(): boolean {
    if (this.replySent || this.generationDone || this.pushToTalk || this.staleTurnOpen) return false
    return this.current === 'thinking' || this.current === 'speaking'
  }

  // Called when the Link is back on the same session after a drop. Anything we were waiting to
  // hear from the OLD connection (a turnComplete closing a tool request, or closing a turn the user
  // talked over) died with it, and must not be waited for any more: those counters reset.
  resumedAfterDrop(): void {
    this.toolTurnsOpen = 0
    this.toolGenerationsOpen = 0
    this.turnClosesOwed = 0 // they'd have come on the old connection
    this.staleTurnOpen = false
    // The answer was fully generated before the drop; only its delayed turnComplete was lost.
    if (this.generationDone && !this.replySent) {
      this.replySent = true
      this.maybeFinishReply()
    }
  }

  // ── From the user ──────────────────────────────────────────────────────────────────────────

  micChunk(pcm: Uint8Array): void {
    if (this.micGoesToModel()) {
      this.hooks.sendMicToModel(pcm)
      // Someone is talking right now: don't close the conversation on them. Gemini's transcript (which
      // also keeps it open) arrives only after they finish, and the window once closed in the middle of
      // "Hey Orbi…", splitting it between Gemini and the spotter so neither understood (2026-10-20).
      if (this.conversation && this.current === 'listening' && !this.pushToTalk && rms(pcm) >= SPEECH_RMS) {
        this.armConversationTimer(this.opts.followUpMs)
      }
      return
    }
    if (this.current !== 'idle' && this.current !== 'speaking') return
    const wakeOn = this.opts.wakeWordEnabled()
    // While it speaks and its voice is kept from Gemini (no voice barge-in), the user can still cut in:
    // by its NAME (the spotter ignores everything else, so loud speakers can't make it hear itself: full
    // volume did, 2026-10-20, its own "Good afternoon, Abhay" came back as the user), or by just talking,
    // checked on this computer (talkingOver) instead of sending the mic, and its own voice, to Gemini.
    const overVoice = this.current === 'speaking' && this.hooks.talkingOver !== undefined
    if (!wakeOn && !overVoice) return

    this.preRoll.push(pcm)
    if (this.preRoll.length > this.opts.preRollChunks) this.preRoll.shift()
    if (wakeOn && this.hooks.feedWakeWord(pcm)) {
      this.wake(this.current === 'speaking' ? INTERRUPT_PREROLL : undefined)
      return
    }
    // The detector needs ~0.3 s of speech to be sure; the last 0.8 s go along, so Gemini hears the
    // user's first words too ("wait, make it shorter", not "shorter").
    if (overVoice && this.hooks.talkingOver?.(pcm)) this.wake(INTERRUPT_PREROLL, 'voice')
  }

  pushToTalkStart(): void {
    if (this.pushToTalk) return
    this.pushToTalk = true
    this.startUserTurn()
  }

  pushToTalkStop(): void {
    if (!this.pushToTalk) return
    this.pushToTalk = false
    this.byKey = true
    // Releasing Space opens a hands-free conversation, like the wake word: after the answer it keeps
    // listening for a follow-up (Abhay, 2026-10-21: one tap, then just keep talking).
    this.conversation = true
    this.hooks.endMicToModel()
    if (this.current === 'listening') this.setState('thinking')
  }

  // The Start button: the same as hearing the wake word, for when it isn't heard (a noisy room, a name
  // the model struggles with) or is switched off. Opens a hands-free conversation with follow-ups.
  // While it speaks, it interrupts, like saying its name would.
  wakeNow(): void {
    if (this.pushToTalk || (this.conversation && this.current !== 'speaking')) return
    this.preRoll = [] // the last 0.5 s is from BEFORE the click: not part of the request
    this.wake()
    this.byKey = true
  }

  // The Stop button: silence the answer NOW and end the conversation. What Gemini still sends of this
  // answer is dropped (stale), and nothing is listened to until the user starts again.
  stopNow(): void {
    this.interruptReply()
    this.clearTimers()
    this.endConversation()
    if (this.current !== 'idle') this.setState('idle')
  }

  // The same button while it listens: stop now, no follow-up. A reply already playing still finishes.
  endNow(): void {
    this.endConversation()
  }

  textInput(): void {
    // No cancel here: a typed request is sent right after and starts its own turn.
    this.interruptReply(false)
    this.beginReply()
    this.clearTimers()
    this.setState('thinking')
  }

  // ── From Gemini ────────────────────────────────────────────────────────────────────────────

  modelAudio(pcm: Uint8Array): void {
    if (this.staleTurnOpen) return // leftover audio from a reply the user talked over
    this.playbackDrained = false
    this.clearTimers()
    this.setState('speaking')
    this.hooks.playToSpeaker(pcm)
  }

  modelToolCalls(): void {
    this.modelActing = true
    this.toolTurnsOpen++
    this.toolGenerationsOpen++
    this.clearTimers()
    this.setState('thinking')
  }

  modelGenerationComplete(): void {
    if (this.staleTurnOpen) return
    if (this.toolGenerationsOpen > 0) {
      this.toolGenerationsOpen-- // end of generating a tool request, not of the answer
      return
    }
    this.generationDone = true
    // Everything is generated. Don't wait for turnComplete, which Gemini delays until it THINKS
    // playback has ended (measured: seconds late). Our own speakers say when playback really ends.
    this.replySent = true
    this.turnClosesOwed++
    this.maybeFinishReply()
  }

  modelTurnComplete(): void {
    if (this.staleTurnOpen) {
      this.staleTurnOpen = false // that was the end of the OLD turn; new audio is fresh again
      return
    }
    if (this.toolTurnsOpen > 0) {
      this.toolTurnsOpen-- // end of a tool-request turn; the spoken answer is still coming
      return
    }
    if (this.turnClosesOwed > 0) {
      this.turnClosesOwed-- // the late close of an answer we already finished at generationComplete
      return
    }
    if (this.pushToTalk) return // still holding the button: this belongs to nothing we asked for
    this.replySent = true
    this.maybeFinishReply()
  }

  // Gemini noticed the user talking over it and stopped. Its queue is stale.
  modelInterrupted(): void {
    this.hooks.stopSpeaker()
    this.playbackDrained = true
    if (!this.replySent) this.staleTurnOpen = true // swallow that turn's closing turnComplete
    this.beginReply()
    if (this.conversation || this.pushToTalk) this.setState('listening')
    // The audio before it had cleared the timers. Without a new one, a conversation where nobody then
    // speaks stayed open forever, mic streaming to Gemini (found 2026-10-19). Talking keeps it open.
    if (this.conversation && !this.pushToTalk) this.armConversationTimer(this.opts.followUpMs)
  }

  // Gemini transcribed some of the user's speech: they're talking, so keep the conversation open.
  modelHeardUser(): void {
    if (!this.conversation || this.current !== 'listening') return
    if (this.followUpOpen) this.beginReply() // a follow-up: a new request begins
    this.armConversationTimer(this.opts.followUpMs)
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer)
    this.thinkingTimer = setTimeout(() => {
      if (this.current === 'listening' && !this.pushToTalk) this.setState('thinking')
    }, this.opts.thinkingAfterMs)
  }

  // Gemini's answer was only to start background work (a non-blocking tool): it says nothing more now,
  // so don't sit on "thinking". The result is told later, when it's done, like any reply.
  backgroundStarted(): void {
    if (this.current !== 'thinking') return
    this.replySent = true
    this.playbackDrained = true
    this.maybeFinishReply()
  }

  // The request never reached Gemini (e.g. not connected): no reply is coming, so stop waiting.
  requestFailed(): void {
    this.replySent = true
    this.playbackDrained = true
    this.toolTurnsOpen = 0
    this.toolGenerationsOpen = 0
    this.turnClosesOwed = 0
    this.staleTurnOpen = false
    this.maybeFinishReply()
  }

  // ── From the speakers ──────────────────────────────────────────────────────────────────────

  playbackDone(): void {
    this.playbackDrained = true
    this.maybeFinishReply()
  }

  // ── Internals ──────────────────────────────────────────────────────────────────────────────

  // `preRollChunks` = how much of the audio from just before to send: all of it normally; only the last
  // INTERRUPT_PREROLL when it interrupts its own speech (that audio is mostly its own voice, but the
  // words said right after its name are in there: "Hey Orbi, stop, what's two plus two?" reached
  // Gemini as "+ 2" without it, 2026-10-20).
  private wake(preRollChunks?: number, reason?: 'voice'): void {
    this.hooks.wakeCue(reason)
    this.conversation = true
    this.byKey = false
    this.startUserTurn()
    const send = preRollChunks === undefined ? this.preRoll : this.preRoll.slice(-preRollChunks)
    for (const chunk of send) this.hooks.sendMicToModel(chunk)
    this.preRoll = []
    this.armConversationTimer(this.opts.noSpeechMs)
  }

  private micGoesToModel(): boolean {
    if (this.pushToTalk) return true
    // Only once Gemini is acting on the request. "Thinking" alone is OUR guess (0.9 s without new words),
    // and a pause mid-sentence while a video played cut the mic: Gemini heard silence and answered half a
    // request (2026-10-27).
    if (this.current === 'thinking' && this.modelActing && this.opts.micHeldWhileThinking?.() === true) return false
    if (!this.conversation) return false
    // While it talks, its own voice comes back through the mic. Only keep sending if echo
    // cancellation is trusted to remove it; otherwise Gemini would "interrupt" itself.
    return this.current !== 'speaking' || this.opts.voiceBargeIn()
  }

  private startUserTurn(): void {
    this.interruptReply()
    this.beginReply()
    this.clearTimers()
    this.setState('listening')
  }

  // The user is starting something new. Silence the old reply NOW (don't wait ~0.5 s for Gemini),
  // and if it's still arriving, mark its remaining audio as stale.
  // Only when a reply is really IN FLIGHT (thinking or speaking): "no reply yet" can also mean the user
  // woke it and said nothing, or a reply was interrupted and the conversation timed out. Marking those
  // stale swallowed the NEXT, real reply: no sound, face stuck on "thinking" (found 2026-10-19).
  // (After Gemini's own "interrupted", modelInterrupted marks the leftovers itself.)
  //
  // TOKENS: muting the speakers alone left Gemini generating the rest of the answer (paid for, then thrown
  // away). So while it is still generating what it SAYS, it is told to stop too (cancelModelReply). Only
  // while speaking: during "thinking" it may be running a tool, which isn't ours to cancel here; once
  // generation is complete there is nothing left to save.
  private interruptReply(cancel = true): void {
    const generating = this.current === 'speaking' && !this.replySent && !this.generationDone
    if (this.current === 'speaking' || !this.playbackDrained) this.hooks.stopSpeaker()
    if (!this.replySent && (this.current === 'thinking' || this.current === 'speaking')) this.staleTurnOpen = true
    if (cancel && generating) this.hooks.cancelModelReply?.()
  }

  private beginReply(): void {
    this.replySent = false
    this.playbackDrained = true
    this.toolTurnsOpen = 0
    this.generationDone = false
    this.toolGenerationsOpen = 0
    this.followUpOpen = false
    this.modelActing = false
    this.hooks.replyStarted()
  }

  private maybeFinishReply(): void {
    if (!this.replySent || !this.playbackDrained) return
    if (this.conversation && !this.byKey && this.opts.followUpAllowed?.() === false) {
      this.endConversation()
      this.setState('idle')
    } else if (this.conversation) {
      this.followUpOpen = true // before setState: its listeners ask inFollowUp
      this.setState('listening') // open for a follow-up, no wake word needed
      this.armConversationTimer(this.opts.followUpMs)
    } else {
      this.setState('idle')
    }
  }

  private armConversationTimer(ms: number): void {
    if (this.conversationTimer) clearTimeout(this.conversationTimer)
    this.conversationTimer = setTimeout(() => this.endConversation(), ms)
  }

  private endConversation(): void {
    if (!this.conversation) return
    this.conversation = false
    this.byKey = false
    this.hooks.endMicToModel()
    this.hooks.resetWakeWord()
    if (this.current === 'listening' || this.current === 'thinking') this.setState('idle')
  }

  private clearTimers(): void {
    if (this.conversationTimer) clearTimeout(this.conversationTimer)
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer)
    this.conversationTimer = null
    this.thinkingTimer = null
  }

  private setState(state: AgentState): void {
    if (state === this.current) return
    this.current = state
    if (state === 'speaking') this.hooks.speakingStarted?.()
    this.hooks.emitState(state)
  }
}
