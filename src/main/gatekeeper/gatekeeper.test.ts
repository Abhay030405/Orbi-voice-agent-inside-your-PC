import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coveredByGrant, decide, spokenAnswer, type GateTool } from './gatekeeper.ts'

const readTool: GateTool = { name: 'list_files', risk: 'low', effect: 'read' }
const lowWrite: GateTool = { name: 'set_volume', risk: 'low', effect: 'write' }
const highWrite: GateTool = { name: 'delete_file', risk: 'high', effect: 'write' }
const upload: GateTool = { name: 'take_screenshot', risk: 'low', effect: 'upload' }
const sensitiveUpload: GateTool = { name: 'read_document', risk: 'high', effect: 'upload' }

describe('Gatekeeper decide()', () => {
  it('defaults: reads and low-risk changes run, risky changes ask', () => {
    assert.equal(decide(readTool, { tainted: false }).verdict, 'allow')
    assert.equal(decide(lowWrite, { tainted: false }).verdict, 'allow')
    assert.equal(decide(highWrite, { tainted: false }).verdict, 'ask')
  })

  it("the user's 'never' wins over everything, even for reads", () => {
    assert.equal(decide(readTool, { policy: 'deny', tainted: false }).verdict, 'deny')
  })

  it("the user's 'always allow' skips the question for a risky tool", () => {
    assert.equal(decide(highWrite, { policy: 'allow', tainted: false }).verdict, 'allow')
  })

  it("caution mode overrides 'always allow' for anything that changes something (C2)", () => {
    assert.equal(decide(highWrite, { policy: 'allow', tainted: true }).verdict, 'ask')
    assert.equal(decide(lowWrite, { tainted: true }).verdict, 'ask')
  })

  it('caution mode never blocks reading', () => {
    assert.equal(decide(readTool, { tainted: true }).verdict, 'allow')
  })

  it('uploads run normally, but ask in caution mode (no leaking via "screenshot and search it")', () => {
    assert.equal(decide(upload, { tainted: false }).verdict, 'allow')
    assert.equal(decide(upload, { tainted: true }).verdict, 'ask')
    assert.equal(decide(upload, { policy: 'allow', tainted: true }).verdict, 'ask')
  })

  it('harmless tools (bring a window forward) run even in caution mode, unless set to always ask', () => {
    const front: GateTool = { name: 'focus_window', risk: 'low', effect: 'write', harmless: true }
    assert.equal(decide(front, { tainted: true }).verdict, 'allow')
    assert.equal(decide(front, { policy: 'ask', tainted: false }).verdict, 'ask')
  })

  it('a screenshot for Gemini alone runs even in caution mode (it already read that content); a search still asks', () => {
    const look = { ...upload, name: 'take_screenshot', modelOnly: true }
    assert.equal(decide(look, { tainted: true }).verdict, 'allow')
    assert.equal(decide(look, { policy: 'ask', tainted: true }).verdict, 'ask')
    assert.equal(decide(upload, { tainted: true }).verdict, 'ask')
  })

  it('uploading a sensitive-looking document always asks', () => {
    assert.equal(decide(sensitiveUpload, { tainted: false }).verdict, 'ask')
  })
})

describe('spokenAnswer()', () => {
  it('understands yes and no, in English and Hinglish', () => {
    assert.equal(spokenAnswer('Yes, go ahead'), 'yes')
    assert.equal(spokenAnswer('haan kar do'), 'yes')
    assert.equal(spokenAnswer('No, cancel that'), 'no')
    assert.equal(spokenAnswer('nahi mat karo'), 'no')
  })

  it('ignores unrelated speech', () => assert.equal(spokenAnswer('what time is it'), null))

  it('when in doubt, no', () => assert.equal(spokenAnswer("yes... no wait don't"), 'no'))

  it('does not match yes inside other words', () => assert.equal(spokenAnswer('yesterday was fun'), null))
})

describe('coveredByGrant (one yes for a whole look-and-tap task)', () => {
  it('covers the same family, low risk only', () => {
    const grants = new Set(['phone-control'])
    assert.equal(coveredByGrant({ family: 'phone-control' }, 'low', grants), true)
    assert.equal(coveredByGrant({ family: 'phone-control' }, 'high', grants), false) // a call still asks
    assert.equal(coveredByGrant({}, 'low', grants), false)
    assert.equal(coveredByGrant({ family: 'phone-control' }, 'low', new Set()), false)
  })
})

