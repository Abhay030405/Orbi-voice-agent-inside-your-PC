// Brain scenarios, run with Node's built-in test runner: `npm test`. No app, no mic, no Gemini:
// fake hooks record what the Brain asked the outside world to do.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentState } from '../../shared/ipc'
import { Brain, type BrainHooks } from './brain.ts'

const chunk = new Uint8Array(640)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function setup(opts: { wakeOn?: boolean; bargeIn?: boolean; wakeHits?: boolean[] } = {}) {
  const log = {
    states: [] as AgentState[],
    toModel: 0,
    endMic: 0,
    played: 0,
    stops: 0,
    cues: 0,
    wakeFed: 0,
    wakeResets: 0,
    requests: 0
  }
  const hits = [...(opts.wakeHits ?? [])]
  const hooks: BrainHooks = {
    emitState: (s) => log.states.push(s),
    sendMicToModel: () => log.toModel++,
    endMicToModel: () => log.endMic++,
    feedWakeWord: () => {
      log.wakeFed++
      return hits.shift() ?? false
    },
    resetWakeWord: () => log.wakeResets++,
    playToSpeaker: () => log.played++,
    stopSpeaker: () => log.stops++,
    wakeCue: () => log.cues++,
    replyStarted: () => log.requests++
  }
  const brain = new Brain(hooks, {
    noSpeechMs: 60,
    followUpMs: 80,
    thinkingAfterMs: 20,
    preRollChunks: 2,
    wakeWordEnabled: () => opts.wakeOn ?? true,
    voiceBargeIn: () => opts.bargeIn ?? true
  })
  return { brain, log }
}

describe('push-to-talk', () => {
  it('goes listening → thinking → speaking → idle, and idle only after the speakers finish', () => {
    const { brain, log } = setup()
    brain.pushToTalkStart()
    brain.micChunk(chunk)
    brain.pushToTalkStop()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    assert.equal(brain.state, 'speaking', 'Gemini is done sending, but audio is still playing')
    brain.playbackDone()
    assert.deepEqual(log.states, ['listening', 'thinking', 'speaking', 'listening'], 'then open for a follow-up, hands-free')
    assert.equal(log.toModel, 1)
    assert.equal(log.endMic, 1)
  })

  it('does not go idle on the turnComplete that closes a tool request', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelToolCalls()
    brain.modelTurnComplete() // closes the tool-request turn, ~300 ms after we answered
    assert.equal(brain.state, 'thinking')
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'idle')
  })
})

describe('finishing on time (no lingering glow)', () => {
  it('finishes at generationComplete + speakers done, without waiting for the late turnComplete', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelAudio(chunk)
    brain.modelGenerationComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'idle')
  })

  it('swallows that late turnComplete even if the user already asked something new', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelAudio(chunk)
    brain.modelGenerationComplete()
    brain.playbackDone() // idle
    brain.textInput() // new question
    brain.modelTurnComplete() // the OLD answer's late close arrives now
    assert.equal(brain.state, 'thinking', 'must not end the new request')
    brain.modelAudio(chunk)
    assert.equal(brain.state, 'speaking')
  })
})

describe('interrupting (PS B2: no stale echoes)', () => {
  it('stops the speaker at once and drops leftover audio from the old reply', () => {
    const { brain, log } = setup()
    brain.textInput()
    brain.modelAudio(chunk) // old reply playing, still streaming (no turnComplete yet)
    brain.pushToTalkStart() // user talks over it
    assert.equal(log.stops, 1, 'speaker silenced locally, without waiting for Gemini')

    brain.modelAudio(chunk) // still in flight from the OLD reply
    brain.modelAudio(chunk)
    assert.equal(log.played, 1, 'stale chunks must not play')

    brain.modelTurnComplete() // old turn closes
    brain.pushToTalkStop()
    brain.modelAudio(chunk) // the NEW answer
    assert.equal(log.played, 2)
  })

  it('swallows the turnComplete that follows Gemini\'s own "interrupted"', () => {
    const { brain, log } = setup()
    brain.pushToTalkStart()
    brain.pushToTalkStop()
    brain.modelAudio(chunk)
    brain.modelInterrupted()
    brain.modelTurnComplete() // closes the interrupted turn: must NOT finish the new reply
    brain.playbackDone()
    assert.notEqual(brain.state, 'idle')
    assert.equal(log.stops, 1)
  })
})

describe('reconnect support (PS B6)', () => {
  it('knows when a reply is still owed, so a resumed session can be nudged', () => {
    const { brain } = setup()
    assert.equal(brain.awaitingReply, false, 'idle: nothing owed')
    brain.textInput()
    assert.equal(brain.awaitingReply, true, 'asked, no answer yet')
    brain.modelAudio(chunk)
    assert.equal(brain.awaitingReply, true, 'answer started but not finished')
    brain.modelTurnComplete()
    assert.equal(brain.awaitingReply, false, 'answer fully received (may still be playing)')
  })

  it('a tool turn still owes the spoken answer', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelToolCalls()
    brain.modelGenerationComplete() // generating the tool REQUEST is done, not the answer
    brain.modelTurnComplete() // closes only the tool request
    assert.equal(brain.awaitingReply, true)
  })

  it('generationComplete means the answer is all here, even before its turnComplete', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelAudio(chunk)
    brain.modelGenerationComplete()
    assert.equal(brain.awaitingReply, false, 'nothing more is coming: no nudge needed')
  })

  it('a reply whose turnComplete died with the old connection is still finished', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelAudio(chunk)
    brain.modelGenerationComplete() // its turnComplete would only have come on the old connection
    brain.resumedAfterDrop()
    brain.playbackDone()
    assert.equal(brain.state, 'idle', 'finished on generationComplete; nothing left to wait for')
  })

  it('after a resume, stops waiting for a tool turn\'s turnComplete from the old connection', () => {
    const { brain } = setup()
    brain.textInput()
    brain.modelToolCalls() // its turnComplete would have come on the old connection
    brain.resumedAfterDrop()
    brain.modelAudio(chunk) // the answer, on the new connection
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'idle', 'the answer\'s turnComplete must not be swallowed')
  })
})

describe('wake word', () => {
  it('only listens for the wake word while idle, then opens a conversation', () => {
    const { brain, log } = setup({ wakeHits: [false, false, true] })
    brain.micChunk(chunk)
    brain.micChunk(chunk)
    assert.equal(log.toModel, 0, 'nothing leaves the computer before the wake word')
    brain.micChunk(chunk) // wake phrase ends here
    assert.equal(brain.state, 'listening')
    assert.equal(log.cues, 1)
    assert.equal(log.toModel, 2, 'the last 2 chunks (pre-roll) go to Gemini, so no word is cut off')
    brain.micChunk(chunk)
    assert.equal(log.toModel, 3, 'after waking, the mic streams to Gemini')
    assert.equal(log.wakeFed, 3, 'and the spotter stops being fed')
  })

  it('ignores the wake word when it is turned off', () => {
    const { brain, log } = setup({ wakeOn: false, wakeHits: [true] })
    brain.micChunk(chunk)
    assert.equal(brain.state, 'idle')
    assert.equal(log.wakeFed, 0)
  })

  it('gives up if the user says nothing after waking it', async () => {
    const { brain, log } = setup({ wakeHits: [true] })
    brain.micChunk(chunk)
    await sleep(90)
    assert.equal(brain.state, 'idle')
    assert.equal(log.endMic, 1)
    assert.equal(log.wakeResets, 1)
  })

  it('stays open for a follow-up after the reply, then closes', async () => {
    const { brain } = setup({ wakeHits: [true] })
    brain.micChunk(chunk)
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'listening', 'follow-up window: no wake word needed')
    await sleep(110)
    assert.equal(brain.state, 'idle')
  })

  it('a follow-up is a NEW request (fresh caution and permissions), but more words in the same one are not', () => {
    const { brain, log } = setup({ wakeHits: [true] })
    brain.micChunk(chunk) // wake: request 1
    brain.modelHeardUser()
    brain.modelHeardUser() // still the same sentence
    const first = log.requests
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone() // reply done, follow-up window open
    assert.equal(log.requests, first)
    brain.modelHeardUser() // "now open VS Code…"
    assert.equal(log.requests, first + 1, 'the follow-up started a new request')
    brain.modelHeardUser()
    assert.equal(log.requests, first + 1)
  })

  it('shows "thinking" once the user goes quiet mid-conversation', async () => {
    const { brain } = setup({ wakeHits: [true] })
    brain.micChunk(chunk)
    brain.modelHeardUser()
    await sleep(35)
    assert.equal(brain.state, 'thinking')
  })

  it('does not send its own voice back to Gemini when voice barge-in is off', () => {
    const { brain, log } = setup({ wakeHits: [true], bargeIn: false })
    brain.micChunk(chunk) // wake (its 1 pre-roll chunk goes to Gemini)
    brain.modelAudio(chunk) // speaking
    brain.micChunk(chunk)
    assert.equal(log.toModel, 1, 'nothing sent while it is speaking')
  })
})

describe('the Start button (when the wake word is not heard)', () => {
  it('opens the same hands-free conversation, without the audio from before the click', () => {
    const { brain, log } = setup({ wakeOn: false })
    brain.micChunk(chunk) // idle, wake word off: nothing goes anywhere
    brain.wakeNow()
    assert.equal(brain.state, 'listening')
    assert.equal(log.cues, 1, 'the same chime as the wake word')
    assert.equal(log.toModel, 0, 'no pre-roll: those chunks are from before the click')
    brain.micChunk(chunk)
    assert.equal(log.toModel, 1, 'now the mic streams to Gemini')
  })

  it('still gives up if the user says nothing', async () => {
    const { brain } = setup()
    brain.wakeNow()
    await sleep(90)
    assert.equal(brain.state, 'idle')
  })

  it('a second press while listening does nothing; End closes it at once', () => {
    const { brain, log } = setup()
    brain.wakeNow()
    brain.wakeNow()
    assert.equal(log.cues, 1)
    brain.endNow()
    assert.equal(brain.state, 'idle')
    assert.equal(log.endMic, 1)
  })

  it('pressing it while it speaks interrupts, like saying its name', () => {
    const { brain, log } = setup({ bargeIn: false })
    brain.wakeNow()
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    assert.equal(brain.state, 'speaking')
    brain.wakeNow()
    assert.equal(brain.state, 'listening')
    assert.equal(log.stops, 1, 'its voice stops at once')
  })
})

// Found 2026-10-19 (Abhay: "no audio", and the face stuck on "Thinking…" after its reply): a new request
// marked the PREVIOUS turn stale even when no reply was in flight, so the NEW reply's audio was dropped
// and its turnComplete was used up clearing the mark.
describe('a new request after a turn that never got a reply', () => {
  const answer = (brain: Brain) => {
    brain.modelAudio(chunk)
    brain.modelGenerationComplete()
    brain.modelTurnComplete()
    brain.playbackDone()
  }

  it('woke, user said nothing, then typed: the typed reply is heard and finishes', async () => {
    const { brain, log } = setup({ wakeHits: [true] })
    brain.micChunk(chunk) // wake word (e.g. a false trigger)
    await sleep(90) // says nothing: gives up, idle
    assert.equal(brain.state, 'idle')
    brain.textInput()
    answer(brain)
    assert.equal(log.played, 1, 'the reply was played, not dropped as stale')
    assert.equal(brain.state, 'idle', 'not stuck on thinking')
  })

  it('reply interrupted, conversation timed out, then typed: the typed reply is heard', async () => {
    const { brain, log } = setup({ wakeHits: [true] })
    brain.micChunk(chunk)
    brain.modelHeardUser()
    brain.modelAudio(chunk) // it starts answering
    brain.modelInterrupted() // Gemini heard something (its own echo?) and stopped
    brain.modelTurnComplete() // the interrupted turn closes
    await sleep(110) // nobody speaks: the conversation closes
    assert.equal(brain.state, 'idle')
    const before = log.played
    brain.textInput()
    answer(brain)
    assert.equal(log.played, before + 1)
    assert.equal(brain.state, 'idle')
  })

  it('still drops leftover audio when a reply really is in flight', () => {
    const { brain, log } = setup()
    brain.textInput()
    brain.modelAudio(chunk) // reply 1 is playing…
    brain.textInput() // …and the user asks something else
    brain.modelAudio(chunk) // leftover of reply 1: dropped
    assert.equal(log.played, 1)
    brain.modelTurnComplete() // reply 1 closes
    answer(brain) // reply 2
    assert.equal(log.played, 2)
    assert.equal(brain.state, 'idle')
  })
})

describe('the follow-up window and someone talking', () => {
  it('stays open while the mic hears speech, closes once it is quiet', async () => {
    const { brain } = setup({ wakeHits: [true] })
    brain.micChunk(chunk) // wake
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone() // follow-up window: 80 ms in these tests
    const loud = new Uint8Array(640)
    const view = new DataView(loud.buffer)
    for (let i = 0; i < 320; i++) view.setInt16(i * 2, i % 2 ? 6000 : -6000, true) // RMS ≈ 0.18
    for (let t = 0; t < 4; t++) {
      await sleep(50)
      brain.micChunk(loud) // still talking at 50, 100, 150, 200 ms: past the 80 ms window
    }
    assert.equal(brain.state, 'listening', 'not closed mid-sentence')
    await sleep(110)
    assert.equal(brain.state, 'idle', 'closed once quiet')
  })
})

describe('no follow-up window while another app plays sound', () => {
  it('goes idle after the answer, so a video is not answered', () => {
    let media = true
    const brain = new Brain(
      {
        emitState: () => {},
        sendMicToModel: () => {},
        endMicToModel: () => {},
        feedWakeWord: () => true,
        resetWakeWord: () => {},
        playToSpeaker: () => {},
        stopSpeaker: () => {},
        wakeCue: () => {},
        replyStarted: () => {}
      },
      { noSpeechMs: 60, followUpMs: 80, thinkingAfterMs: 20, preRollChunks: 2, wakeWordEnabled: () => true, voiceBargeIn: () => true, followUpAllowed: () => !media }
    )
    brain.micChunk(chunk) // wake
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'idle', 'media playing: wake word needed again')
    media = false
    brain.micChunk(chunk) // wake again
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'listening', 'quiet: follow-up window as usual')
  })

  it('keeps the follow-up when the user started with a key (Space, the shortcut)', () => {
    const brain = new Brain(
      {
        emitState: () => {},
        sendMicToModel: () => {},
        endMicToModel: () => {},
        feedWakeWord: () => false,
        resetWakeWord: () => {},
        playToSpeaker: () => {},
        stopSpeaker: () => {},
        wakeCue: () => {},
        replyStarted: () => {}
      },
      { noSpeechMs: 60, followUpMs: 80, thinkingAfterMs: 20, preRollChunks: 2, wakeWordEnabled: () => true, voiceBargeIn: () => true, followUpAllowed: () => false }
    )
    brain.wakeNow()
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'listening', 'media playing, but the user chose to talk: follow-up open')
    assert.equal(brain.followUpByKey, true)
    brain.pushToTalkStart()
    brain.pushToTalkStop()
    brain.modelAudio(chunk)
    brain.modelTurnComplete()
    brain.playbackDone()
    assert.equal(brain.state, 'listening', 'hold-Space too')
  })
})

describe('the Stop button', () => {
  it('silences the answer at once, drops the rest of it, and ends the conversation', () => {
    const { brain, log } = setup()
    brain.wakeNow()
    brain.modelHeardUser()
    brain.modelAudio(chunk)
    assert.equal(brain.state, 'speaking')
    const stops = log.stops
    brain.stopNow()
    assert.equal(brain.state, 'idle')
    assert.equal(log.stops, stops + 1, 'speaker stopped')
    const played = log.played
    brain.modelAudio(chunk) // the rest of that answer, still arriving
    assert.equal(log.played, played, 'dropped')
    assert.equal(brain.state, 'idle')
  })
})

describe('the mic while another app plays sound', () => {
  it('a pause mid-sentence does not cut the mic; it is held once Gemini acts on the request', async () => {
    let sent = 0
    const brain = new Brain(
      {
        emitState: () => {},
        sendMicToModel: () => sent++,
        endMicToModel: () => {},
        feedWakeWord: () => true,
        resetWakeWord: () => {},
        playToSpeaker: () => {},
        stopSpeaker: () => {},
        wakeCue: () => {},
        replyStarted: () => {}
      },
      { noSpeechMs: 200, followUpMs: 200, thinkingAfterMs: 20, preRollChunks: 2, wakeWordEnabled: () => true, voiceBargeIn: () => true, micHeldWhileThinking: () => true }
    )
    brain.micChunk(chunk) // wake
    brain.modelHeardUser()
    await sleep(40) // the user pauses: we show "thinking"
    assert.equal(brain.state, 'thinking')
    const before = sent
    brain.micChunk(chunk) // ...and goes on talking
    assert.equal(sent, before + 1, 'still reaches Gemini')
    brain.modelToolCalls() // Gemini acts: the request is over
    brain.micChunk(chunk) // the video keeps playing
    assert.equal(sent, before + 1, 'held back now')
  })
})

describe('interrupting by name (voice barge-in off: its own voice never reaches Gemini)', () => {
  it('keeps its voice from Gemini, but "Hey Orbi" while it speaks stops it and starts a new turn', () => {
    const { brain, log } = setup({ bargeIn: false, wakeHits: [true, false, true] })
    brain.micChunk(chunk) // wake
    brain.modelHeardUser()
    brain.modelAudio(chunk) // it speaks
    const sent = log.toModel
    brain.micChunk(chunk) // its own voice in the mic: not the name
    assert.equal(log.toModel, sent, 'its own voice is not sent to Gemini')
    brain.micChunk(chunk) // the user says its name
    assert.equal(brain.state, 'listening', 'interrupted, listening again')
    assert.equal(log.stops, 1, 'its voice stopped at once')
    assert.equal(log.toModel, sent + 2, 'only the last moments before the name go along (the words right after it)')
    brain.micChunk(chunk)
    assert.equal(log.toModel, sent + 3, 'the new request goes to Gemini')
  })
})

describe('talking over it (local speech detection) and not wasting tokens', () => {
  // Like setup(), plus the optional hooks: a scripted "is the user talking over it?" and a cancel counter.
  function withVoice(talk: boolean[], opts: { wakeOn?: boolean } = {}) {
    const said = [...talk]
    const log = { cancels: 0, cues: [] as (string | undefined)[], toModel: 0, stops: 0, speakStarts: 0 }
    const brain = new Brain(
      {
        emitState: () => {},
        sendMicToModel: () => log.toModel++,
        endMicToModel: () => {},
        feedWakeWord: () => false,
        resetWakeWord: () => {},
        playToSpeaker: () => {},
        stopSpeaker: () => log.stops++,
        wakeCue: (reason) => log.cues.push(reason),
        replyStarted: () => {},
        talkingOver: () => said.shift() ?? false,
        speakingStarted: () => log.speakStarts++,
        cancelModelReply: () => log.cancels++
      },
      {
        noSpeechMs: 60,
        followUpMs: 80,
        thinkingAfterMs: 20,
        preRollChunks: 50,
        wakeWordEnabled: () => opts.wakeOn ?? true,
        voiceBargeIn: () => false
      }
    )
    return { brain, log }
  }

  it('stops speaking when the user talks over it, cancels the rest of the answer, and listens', () => {
    const { brain, log } = withVoice([false, false, true])
    brain.textInput()
    brain.modelAudio(chunk) // answer playing, still being generated
    assert.equal(log.speakStarts, 1)
    brain.micChunk(chunk)
    brain.micChunk(chunk)
    assert.equal(log.toModel, 0, 'its own voice is not sent to Gemini while it speaks')
    brain.micChunk(chunk) // the detector says: the user is talking
    assert.equal(brain.state, 'listening')
    assert.equal(log.stops, 1, 'speakers silenced at once')
    assert.equal(log.cancels, 1, 'Gemini told to stop generating the rest')
    assert.deepEqual(log.cues, ['voice'])
    assert.equal(log.toModel, 3, 'the moment just before goes along, so the first words are not lost')
    brain.micChunk(chunk)
    assert.equal(log.toModel, 4, 'and the mic now goes to Gemini')
  })

  it('works with the wake word switched off too', () => {
    const { brain, log } = withVoice([true], { wakeOn: false })
    brain.textInput()
    brain.modelAudio(chunk)
    brain.micChunk(chunk)
    assert.equal(brain.state, 'listening')
    assert.deepEqual(log.cues, ['voice'])
  })

  it('Stop does not cancel once the whole answer is generated (nothing left to save; only playback is cut)', () => {
    const { brain, log } = withVoice([])
    brain.textInput()
    brain.modelAudio(chunk)
    brain.modelGenerationComplete() // all tokens already spent; only playing now
    brain.stopNow()
    assert.equal(log.stops, 1)
    assert.equal(log.cancels, 0)
  })

  it('Stop while it is still generating cancels the rest at Gemini', () => {
    const { brain, log } = withVoice([])
    brain.textInput()
    brain.modelAudio(chunk)
    brain.stopNow()
    assert.equal(log.cancels, 1)
    assert.equal(brain.state, 'idle')
  })

  it('a typed request over the reply does not reconnect (the request itself starts a new turn)', () => {
    const { brain, log } = withVoice([])
    brain.textInput()
    brain.modelAudio(chunk)
    brain.textInput()
    assert.equal(log.cancels, 0)
    assert.equal(log.stops, 1)
  })

  it('is not asked while idle (the wake word decides there)', () => {
    const { brain, log } = withVoice([true, true])
    brain.micChunk(chunk)
    assert.equal(brain.state, 'idle')
    assert.equal(log.cues.length, 0)
  })

  it('drops the leftover audio of the cut-off answer, then plays the new one', () => {
    const { brain, log } = withVoice([true])
    brain.textInput()
    brain.modelAudio(chunk)
    brain.micChunk(chunk) // talked over
    brain.modelAudio(chunk) // still arriving from the old answer
    assert.equal(brain.state, 'listening', 'stale audio is not played')
    brain.modelInterrupted()
    brain.modelTurnComplete() // the old turn closes
    brain.modelAudio(chunk) // the answer to what the user said now
    assert.equal(brain.state, 'speaking')
    assert.equal(log.speakStarts, 2)
  })
})
