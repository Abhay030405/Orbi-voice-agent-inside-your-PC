import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { Ledger, type NewAction } from './ledger.ts'

const dir = mkdtempSync(join(tmpdir(), 'dw-ledger-'))
const opened: Ledger[] = []
// Windows can't delete a database file that's still open, so close every ledger first.
after(() => {
  for (const l of opened) l.close()
  rmSync(dir, { recursive: true, force: true })
})
let n = 0
const fresh = () => {
  const l = new Ledger(join(dir, `ledger-${++n}.db`))
  opened.push(l)
  return l
}
const action = (tool: string, extra: Partial<NewAction> = {}): NewAction => ({
  callId: `c${Math.random()}`,
  tool,
  args: { path: 'C:\\Users\\me\\a.txt' },
  risk: 'high',
  description: `do ${tool}`,
  source: 'voice',
  ...extra
})

describe('Ledger', () => {
  it('writes an action as pending BEFORE it runs, then records the outcome', () => {
    const l = fresh()
    const id = l.begin(action('delete_file'))
    assert.equal(l.get(id)?.status, 'pending')
    l.finish(id, 'done', { ok: true }, { trashPath: 'X' })
    const e = l.get(id)!
    assert.equal(e.status, 'done')
    assert.deepEqual(e.undo, { trashPath: 'X' })
    assert.deepEqual(e.args, { path: 'C:\\Users\\me\\a.txt' }, 'JSON round-trips, backslashes included')
  })

  it('"undo that" finds the newest done-and-reversible action, skipping the rest', () => {
    const l = fresh()
    const a = l.begin(action('move_file'))
    l.finish(a, 'done', { ok: true }, { from: 'x', to: 'y' })
    const b = l.begin(action('send_sms'))
    l.finish(b, 'done', { ok: true }, null) // can't be undone
    const c = l.begin(action('delete_file'))
    l.finish(c, 'failed', { ok: false, error: 'locked' }, null)
    assert.equal(l.lastUndoable()?.id, a)
    l.markUndone(a, true)
    assert.equal(l.lastUndoable(), null, 'already undone: nothing left to undo')
  })

  it('survives closing and reopening (undo works after a restart)', () => {
    const file = join(dir, 'persist.db')
    const l1 = new Ledger(file)
    const id = l1.begin(action('move_file'))
    l1.finish(id, 'done', { ok: true }, { from: 'a', to: 'b' })
    l1.close()
    const l2 = new Ledger(file)
    assert.equal(l2.lastUndoable()?.id, id)
    l2.close()
  })

  it('after a crash mid-action, reports it as interrupted instead of pretending', () => {
    const file = join(dir, 'crash.db')
    const l1 = new Ledger(file)
    l1.begin(action('run_shell')) // ...and the app dies before finish()
    l1.close()
    const l2 = new Ledger(file)
    const stuck = l2.recoverInterrupted()
    assert.equal(stuck.length, 1)
    assert.equal(l2.recent(1)[0].status, 'interrupted')
    l2.close()
  })

  it('a failed action gives its key back, so trying again can run', () => {
    const l = fresh()
    const id = l.begin(action('move_file', { idemKey: 'r|move_file|x' }))
    l.finish(id, 'failed', { ok: false, error: 'locked' })
    assert.equal(l.findByIdemKey('r|move_file|x'), null)
    assert.doesNotThrow(() => l.begin(action('move_file', { idemKey: 'r|move_file|x' })))
  })

  it('the database itself refuses a second action with the same idempotency key', () => {
    const l = fresh()
    l.begin(action('send_sms', { idemKey: 'turn7|send_sms|{"to":"Rahul"}' }))
    assert.throws(() => l.begin(action('send_sms', { idemKey: 'turn7|send_sms|{"to":"Rahul"}' })), /UNIQUE/)
    assert.ok(l.findByIdemKey('turn7|send_sms|{"to":"Rahul"}'))
  })
})
