import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRiskyName, matchElements, parseElements, toPhysical, type ShotMap } from './pcmap.ts'

describe('PC control helpers', () => {
  // A 2562 × 1602 physical screen sent as a 1280-wide picture.
  const screen: ShotMap = { what: 'the main screen', left: 0, top: 0, scale: 1280 / 2562, width: 1280, height: 800 }

  it('maps a point in the picture to the real screen pixel', () => {
    assert.deepEqual(toPhysical(screen, 640, 400), { x: 1281, y: 801 })
    // A window at (300, 200) captured at full size.
    const win: ShotMap = { what: 'Notepad', left: 300, top: 200, scale: 1, width: 1000, height: 700 }
    assert.deepEqual(toPhysical(win, 10, 20), { x: 310, y: 220 })
  })

  it('refuses points outside the picture', () => {
    assert.throws(() => toPhysical(screen, 1500, 10), /outside the last screenshot/)
    assert.throws(() => toPhysical(screen, -1, 10), /outside/)
  })

  it('knows which buttons must always ask', () => {
    for (const n of ['Send', 'Pay now', 'Buy', 'Place order', 'Delete', 'Uninstall', 'Sign out', 'Install']) assert.equal(isRiskyName(n), true, n)
    for (const n of ['Search', 'Next', 'Play', 'Settings', 'Cancel', 'Back']) assert.equal(isRiskyName(n), false, n)
  })

  it('reads the element list from the helper', () => {
    const out = 'Button\tInstall\t100\t200\t80\t30\t1\nEdit\tSearch apps\t10\t10\t300\t24\t1\nButton\t\t0\t0\t1\t1\t1\nbad line\n'
    const list = parseElements(out)
    assert.equal(list.length, 2) // the 1×1 one is dropped
    assert.deepEqual(list[0], { id: 1, type: 'Button', name: 'Install', x: 140, y: 215, enabled: true })
    assert.equal(list[1].id, 2)
  })
})

describe('pc_ui_elements find', () => {
  const el = (id: number, name: string) => ({ id, type: 'Hyperlink', name, x: 0, y: 0, enabled: true })
  const page = [el(1, 'Home'), el(2, 'Shorts'), el(3, 'Lofi Girl - beats to study'), el(4, 'Best lofi hip hop 2021'), el(5, 'Search')]
  it('keeps the matches, most words first, page order among equals', () => {
    assert.deepEqual(matchElements(page, 'lofi hip hop', 10).map((e) => e.id), [4, 3])
  })
  it('keeps the original ids (pc_click uses them)', () => assert.equal(matchElements(page, 'search', 10)[0].id, 5))
  it('nothing matches → empty', () => assert.deepEqual(matchElements(page, 'cricket', 10), []))
})
