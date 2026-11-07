import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { faceFor, type PresenceInputs } from './presence.ts'

const base: PresenceInputs = {
  agent: 'idle',
  link: 'connected',
  muted: false,
  tool: null,
  asking: null,
  tasksRunning: 0,
  tainted: false,
  taintedBy: null
}
const face = (patch: Partial<PresenceInputs>) => faceFor({ ...base, ...patch })

describe('faceFor (what the face shows)', () => {
  it('follows the Brain when nothing else is going on', () => {
    assert.equal(face({}).face, 'idle')
    assert.equal(face({ agent: 'listening' }).face, 'listening')
    assert.equal(face({ agent: 'thinking' }).face, 'thinking')
    assert.equal(face({ agent: 'speaking' }).face, 'speaking')
  })

  it('a running tool becomes its morph; a tool without a picture shows thinking', () => {
    assert.deepEqual([face({ agent: 'thinking', tool: 'run_command' }).face, face({ tool: 'run_command' }).tool], ['acting', 'term'])
    assert.equal(face({ tool: 'web_search' }).tool, 'web')
    assert.equal(face({ tool: 'set_volume' }).face, 'thinking')
    assert.equal(face({ tool: 'set_volume' }).tool, null)
  })

  it('an open confirmation beats everything but a dead connection', () => {
    const asking = { action: 'Delete notes.txt', irreversible: false }
    assert.equal(face({ asking, tool: 'delete_file', agent: 'thinking' }).face, 'confirm')
    assert.equal(face({ asking: { ...asking, irreversible: true } }).face, 'danger')
    assert.match(face({ asking }).label, /Delete notes\.txt/)
    assert.equal(face({ asking, link: 'disconnected' }).face, 'offline')
    assert.equal(face({ asking, link: 'reconnecting' }).face, 'confirm')
  })

  it('connection problems show before work', () => {
    assert.equal(face({ link: 'reconnecting', agent: 'speaking' }).face, 'reconnecting')
    assert.equal(face({ link: 'connecting' }).face, 'reconnecting')
    assert.equal(face({ link: 'disconnected', tool: 'open_app' }).face, 'offline')
  })

  it('muted shows the blindfold only while idle (a reply already under way still shows)', () => {
    assert.equal(face({ muted: true }).face, 'paused')
    assert.equal(face({ muted: true, agent: 'speaking' }).face, 'speaking')
  })

  it('background tasks show while idle, with a count', () => {
    assert.equal(face({ tasksRunning: 2 }).face, 'task')
    assert.match(face({ tasksRunning: 2 }).label, /2 tasks running/)
    assert.equal(face({ tasksRunning: 1, agent: 'listening' }).face, 'listening')
  })

  it('says what caused caution mode', () => {
    assert.equal(face({ tainted: true, taintedBy: 'take_screenshot', agent: 'thinking' }).cautionSource, 'the screen')
    assert.equal(face({ tainted: true, taintedBy: 'take_screenshot' }).cautionSource, null) // idle: no caution shown
  })

  it('caution shows only while a request is active', () => {
    assert.equal(face({ tainted: true, agent: 'speaking' }).caution, true)
    assert.equal(face({ tainted: true, tool: 'open_app' }).caution, true)
    assert.equal(face({ tainted: true }).caution, false)
  })
})
