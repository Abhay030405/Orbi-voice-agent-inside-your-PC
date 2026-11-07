import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claimsAction } from './honesty.ts'

describe('claimsAction (said it did something)', () => {
  it('catches the real one', () => assert.equal(claimsAction("I've successfully skipped the ad."), true))
  it('catches other done-claims', () => {
    for (const s of ['I have opened YouTube for you.', 'I just paused the video.', "I've set the volume to 30.", 'I went ahead and closed the tab.']) {
      assert.equal(claimsAction(s), true, s)
    }
  })
  it('lets answers, offers and plans through', () => {
    for (const s of [
      'It is 2:37 PM.',
      'Today in Rudrapur it is sunny.',
      'I can open YouTube for you if you like.',
      "I'll pause it now.",
      "I haven't done that yet.",
      'I have already written the Two Sum program and opened it in VS Code.',
      'Could you tell me which tab?'
    ]) {
      assert.equal(claimsAction(s), false, s)
    }
  })
})
