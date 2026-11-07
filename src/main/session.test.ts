import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SessionEvent } from '../shared/ipc'
import { SessionLog, mainArgument, sessionText } from './session.ts'
import { earlierToday } from './session.ts'

function setup() {
  let clock = 1_000
  const pushed: SessionEvent[] = []
  const log = new SessionLog((e) => pushed.push(e), () => clock)
  return { log, pushed, tick: (ms: number) => (clock += ms) }
}

describe('SessionLog (the Home timeline)', () => {
  it('glues speech fragments from the same speaker into one line', () => {
    const { log } = setup()
    log.heard('user', ' Open ')
    log.heard('user', 'YouTube')
    log.heard('model', 'Opening ')
    log.heard('model', 'it now.')
    const list = log.list()
    assert.deepEqual(
      list.map((e) => [e.kind, 'text' in e ? e.text : '']),
      [
        ['you', 'Open YouTube'],
        ['agent', 'Opening it now.']
      ]
    )
  })

  it('pushes an update with the SAME id, so the page replaces instead of adding', () => {
    const { log, pushed } = setup()
    log.heard('model', 'Hel')
    log.heard('model', 'lo')
    assert.equal(pushed.length, 2)
    assert.equal(pushed[0].id, pushed[1].id)
    assert.equal(log.list().length, 1)
  })

  it('starts a new line after something else happened, or after a long pause', () => {
    const { log, tick } = setup()
    log.heard('model', 'First.')
    log.toolStarted('c1', 'get_volume', {})
    log.heard('model', 'Second.')
    tick(20_000)
    log.heard('model', 'Third.')
    assert.equal(log.list().filter((e) => e.kind === 'agent').length, 3)
  })

  it('typed text is always its own line, and voice after it starts a new one', () => {
    const { log } = setup()
    log.typed('what time is it')
    log.heard('user', 'and the date')
    const you = log.list().filter((e) => e.kind === 'you')
    assert.deepEqual(
      you.map((e) => (e.kind === 'you' ? e.via : '')),
      ['text', 'voice']
    )
  })

  it('tool cards go running → done in place', () => {
    const { log } = setup()
    log.toolStarted('call-7', 'set_volume', { level: 40 })
    log.toolUpdate('call-7', { sentence: 'Set the volume to 40%' })
    log.toolUpdate('call-7', { status: 'done', verified: true, ms: 120, ledgerId: 3, undoable: true })
    const [card] = log.list()
    assert.equal(card.kind, 'tool')
    if (card.kind !== 'tool') return
    assert.equal(card.status, 'done')
    assert.equal(card.sentence, 'Set the volume to 40%')
    assert.equal(card.target, '40')
    assert.equal(log.list().length, 1)
  })

  it('confirmations record the answer', () => {
    const { log } = setup()
    log.confirmAsked('ask-1', 'Delete notes.txt', 'high risk', true)
    log.confirmAnswered('ask-1', 'no')
    const [c] = log.list()
    assert.equal(c.kind === 'confirm' && c.answer, 'no')
  })

  it('keeps the newest 300 events', () => {
    const { log } = setup()
    for (let i = 0; i < 320; i++) log.net(`blip ${i}`)
    const list = log.list()
    assert.equal(list.length, 300)
    assert.equal(list[0].kind === 'net' && list[0].text, 'blip 20')
  })

  it('picks the argument that says what a tool works on', () => {
    assert.equal(mainArgument({ path: 'C:/a.txt', content: 'hi' }), 'C:/a.txt')
    assert.equal(mainArgument({ command: 'dir' }), 'dir')
    assert.equal(mainArgument({}), '')
    assert.equal(mainArgument({ path: 'x'.repeat(200) }).length, 120)
  })

  it('starts from a saved session and keeps numbering after it', () => {
    const saved = new SessionLog(() => {})
    saved.typed('first')
    saved.net('blip')
    const log = new SessionLog(() => {}, Date.now, saved.list())
    log.typed('after restart')
    const ids = log.list().map((e) => e.id)
    assert.equal(ids.length, 3)
    assert.equal(new Set(ids).size, 3) // no id reused
  })

  it('renders the session as plain text for copying', () => {
    const log = new SessionLog(() => {})
    log.typed('open youtube')
    log.toolStarted('c1', 'open_url', { url: 'https://www.youtube.com' }, 'Open https://www.youtube.com')
    log.toolUpdate('c1', { status: 'done' })
    log.heard('model', 'Opened it.')
    const text = sessionText(log.list(), 'Dreamwalker')
    assert.match(text, /You \(text\): open youtube/)
    assert.match(text, /→ Open https:\/\/www\.youtube\.com \(open_url · https:\/\/www\.youtube\.com\): done/)
    assert.match(text, /Dreamwalker: Opened it\./)
  })

  it('a reloaded session never shows something as still running', () => {
    const before = new SessionLog(() => {})
    before.toolStarted('c9', 'take_screenshot', {})
    before.confirmAsked('ask-1', 'Delete notes.txt', 'high risk', true)
    const after = new SessionLog(() => {}, Date.now, before.list())
    const [tool, ask] = after.list()
    assert.equal(tool.kind === 'tool' && tool.status, 'failed')
    assert.match(tool.kind === 'tool' ? (tool.error ?? '') : '', /interrupted/)
    assert.equal(ask.kind === 'confirm' && ask.answer, 'timeout')
  })
})

describe("today's earlier conversations", () => {
  const noon = new Date(2026, 9, 21, 12, 0).getTime()
  const yesterday = new Date(2026, 9, 20, 18, 0).getTime()
  const ev = (id: string, at: number) => ({ kind: 'you' as const, id, at, text: id, via: 'voice' as const })
  it('shows only today, with unique ids, then a divider', () => {
    const out = earlierToday([{ name: 'a', events: [ev('s1', yesterday), ev('s2', noon - 3600_000)] }, { name: 'b', events: [ev('s1', noon - 600_000)] }], noon)
    assert.deepEqual(out.map((e) => e.id), ['d0-s2', 'd1-s1', 'day-divider'])
    assert.equal(out.at(-1)?.kind, 'net')
  })
  it('nothing earlier today: no divider', () => assert.deepEqual(earlierToday([{ name: 'a', events: [ev('s1', yesterday)] }], noon), []))
})
