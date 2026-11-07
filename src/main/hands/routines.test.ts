import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { RoutineStore, routineTools, routinesInstruction } from './routines.ts'
import { asOutcome } from './tool.ts'

const dir = mkdtempSync(join(tmpdir(), 'dw-routines-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const fresh = (name: string): RoutineStore => new RoutineStore(join(dir, `${name}.json`))
const tools = (s: RoutineStore) => Object.fromEntries(routineTools(() => s).map((t) => [t.name, t]))

describe('routines (A5): taught by voice, run by name', () => {
  it('save, then run by a rough name: the steps come back to do', async () => {
    const s = fresh('a')
    const t = tools(s)
    const saved = asOutcome(await t.save_routine.run({ name: '  Back   Home ', steps: ['open Docker Desktop', 'open VS Code', 'set the volume to 30'] }))
    assert.equal(saved.result.ok, true)
    const run = asOutcome(await t.run_routine.run({ name: 'back hom' }))
    assert.deepEqual(run.result, { ok: true, routine: 'Back Home', steps: ['open Docker Desktop', 'open VS Code', 'set the volume to 30'], now: 'Do these steps now, in order, with your tools.' })
    assert.equal(s.all()[0].runs, 1)
  })

  it('the names go into the instructions, so a bare "back home" is understood', () => {
    const s = fresh('b')
    assert.equal(routinesInstruction(s), '')
    s.save('back home', ['open Docker Desktop'])
    s.save('study mode', ['open VS Code'])
    assert.match(routinesInstruction(s), /"back home", "study mode".*run_routine/)
  })

  it('saving the same name replaces it, and undo brings the old one back', async () => {
    const s = fresh('c')
    const t = tools(s)
    s.save('study mode', ['open VS Code'])
    const out = asOutcome(await t.save_routine.run({ name: 'Study Mode', steps: ['open VS Code', 'play lofi on YouTube'] }))
    assert.equal((out.result as unknown as { replaced: boolean }).replaced, true)
    assert.equal(s.all().length, 1)
    await t.save_routine.undo!(out.undo)
    assert.deepEqual(s.all()[0].steps, ['open VS Code'])
  })

  it('undo of a brand-new routine removes it; delete can be undone too', async () => {
    const s = fresh('d')
    const t = tools(s)
    const out = asOutcome(await t.save_routine.run({ name: 'night', steps: ['lock the laptop'] }))
    await t.save_routine.undo!(out.undo)
    assert.equal(s.all().length, 0)
    s.save('night', ['lock the laptop'])
    const del = asOutcome(await t.delete_routine.run({ name: 'nigth' }))
    assert.equal(del.result.ok, true)
    assert.equal(s.all().length, 0)
    await t.delete_routine.undo!(del.undo)
    assert.equal(s.all()[0].name, 'night')
  })

  it('refuses nonsense: no name, no steps, too many steps; unknown names list what exists', async () => {
    const s = fresh('e')
    const t = tools(s)
    assert.equal(asOutcome(await t.save_routine.run({ name: '', steps: ['x'] })).result.ok, false)
    assert.equal(asOutcome(await t.save_routine.run({ name: 'x', steps: [] })).result.ok, false)
    assert.equal(asOutcome(await t.save_routine.run({ name: 'x', steps: 'open docker' })).result.ok, false)
    assert.equal(asOutcome(await t.save_routine.run({ name: 'x', steps: Array(16).fill('a') })).result.ok, false)
    s.save('back home', ['a'])
    const miss = asOutcome(await t.run_routine.run({ name: 'party time' })).result as { ok: false; error: string }
    assert.match(miss.error, /no routine called "party time".*back home/)
  })

  it('a broken file reads as empty and is fixed by the next save', () => {
    const file = join(dir, 'broken.json')
    writeFileSync(file, '{not json')
    const s = new RoutineStore(file)
    assert.deepEqual(s.all(), [])
    s.save('ok', ['a'])
    assert.equal(s.all().length, 1)
  })

  it('two routines that both match ask which one', async () => {
    const s = fresh('f')
    s.save('study mode', ['a'])
    s.save('study mode 2', ['b'])
    const r = asOutcome(await tools(s).run_routine.run({ name: 'study' })).result as { ok: false; error: string }
    assert.match(r.error, /Several routines match/)
    const exact = asOutcome(await tools(s).run_routine.run({ name: 'Study  Mode' })).result as unknown as { routine: string }
    assert.equal(exact.routine, 'study mode') // the exact name never asks
  })
})
