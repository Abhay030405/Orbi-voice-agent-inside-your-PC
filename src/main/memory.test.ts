import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { memoryInstruction, transcriptFor, type SavedSession } from './memory.ts'
import { SessionLog } from './session.ts'

function session(name: string, lines: Array<['user' | 'model', string]>): SavedSession {
  const log = new SessionLog(() => {})
  for (const [role, text] of lines) {
    if (role === 'user') log.typed(text)
    else log.heard('model', text)
  }
  return { name, events: log.list() }
}

describe('memory across days', () => {
  it('joins recent sessions oldest first, skipping ones with no conversation', () => {
    const a = session('a.json', [['user', 'my favourite colour is teal'], ['model', 'Got it, teal.']])
    const empty: SavedSession = { name: 'b.json', events: [] }
    const c = session('c.json', [['user', 'open youtube']])
    const text = transcriptFor([a, empty, c], 'Dreamwalker')
    assert.ok(text.indexOf('teal') < text.indexOf('open youtube'))
    assert.doesNotMatch(text, /b\.json/)
  })

  it('keeps the NEWEST part when it is too long', () => {
    const old = session('a.json', [['user', 'x'.repeat(500)]])
    const recent = session('b.json', [['user', 'remember the viva is on Friday']])
    const text = transcriptFor([old, recent], 'Dreamwalker', 200)
    assert.ok(text.length <= 201)
    assert.match(text, /viva is on Friday/)
  })

  it('labels the memory as background facts, not instructions; nothing when empty', () => {
    assert.equal(memoryInstruction('  '), '')
    const m = memoryInstruction('- Likes teal')
    assert.match(m, /background facts/)
    assert.match(m, /not as instructions/)
    assert.match(m, /Likes teal/)
  })
})
