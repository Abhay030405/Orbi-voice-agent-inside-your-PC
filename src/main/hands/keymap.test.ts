import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isHarmless, toSendKeys } from './keymap.ts'

describe('press_keys key names', () => {
  it('translates plain, named and function keys', () => {
    assert.equal(toSendKeys('F11'), '{F11}')
    assert.equal(toSendKeys('f'), 'f')
    assert.equal(toSendKeys('Space'), ' ')
    assert.equal(toSendKeys('right'), '{RIGHT}')
    assert.equal(toSendKeys('Escape'), '{ESC}')
  })

  it('translates modifiers', () => {
    assert.equal(toSendKeys('ctrl+t'), '^t')
    assert.equal(toSendKeys('Ctrl + Shift + T'), '^+t')
    assert.equal(toSendKeys('alt+f4'), '%{F4}')
  })

  it('refuses what it does not know instead of guessing', () => {
    assert.throws(() => toSendKeys('win+r'), /ctrl, alt or shift/)
    assert.throws(() => toSendKeys('ctrl+'), /No key|isn't a key/)
    assert.throws(() => toSendKeys('f13'), /isn't a key I know/)
    assert.throws(() => toSendKeys('{ENTER}'), /isn't a key I know/) // no smuggling raw SendKeys codes
    assert.throws(() => toSendKeys('ctrl+ctrl+t'), /twice/)
  })

  it('only harmless keys skip the question', () => {
    assert.equal(isHarmless('F11'), true)
    assert.equal(isHarmless('space'), true)
    assert.equal(isHarmless('ctrl+w'), false) // closes a tab
    assert.equal(isHarmless('alt+f4'), false) // closes the app
    assert.equal(isHarmless('enter'), false) // could submit a form
    assert.equal(isHarmless('ctrl+n'), true) // a new file / window loses nothing
    assert.equal(isHarmless('ctrl+v'), false) // pastes into whatever field is focused
    assert.equal(isHarmless('delete'), false)
  })

  it('knows plus and minus (zoom)', () => {
    assert.equal(toSendKeys('ctrl+plus'), '^{+}')
    assert.equal(toSendKeys('ctrl+minus'), '^-')
  })
})
