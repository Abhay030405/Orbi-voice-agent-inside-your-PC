import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { startProgram } from '../hands/process.ts'
import { MAX_RUNNING, TaskManager, type TaskView } from './tasks.ts'

// Real programs (node itself), so this tests the real process plumbing too.
const node = process.execPath
const opts = { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 }
const script = (js: string) => ({ js })

function setup() {
  const finished: TaskView[] = []
  const tm = new TaskManager({
    start: (command) => startProgram(node, ['-e', command], opts),
    onChange: () => {},
    onFinished: (t) => finished.push(t)
  })
  const waitFor = async (id: number) => {
    for (let i = 0; i < 100 && !finished.some((t) => t.id === id); i++) await new Promise((r) => setTimeout(r, 50))
    return finished.find((t) => t.id === id)
  }
  return { tm, finished, waitFor }
}

describe('TaskManager (background tasks, A2)', () => {
  it('starts at once and reports when the task ends', async () => {
    const { tm, waitFor } = setup()
    const t = tm.start('quick job', script('setTimeout(() => console.log("all done"), 300)').js, '.')
    assert.equal(t.status, 'running')
    const end = await waitFor(t.id)
    assert.equal(end?.status, 'done')
    assert.equal(end?.lastLine, 'all done')
  })

  it('runs several at once, each with its own output (no mixing)', async () => {
    const { tm, waitFor } = setup()
    const a = tm.start('A', 'for (let i = 0; i < 3; i++) console.log("A" + i)', '.')
    const b = tm.start('B', 'for (let i = 0; i < 3; i++) console.log("B" + i)', '.')
    await waitFor(a.id)
    await waitFor(b.id)
    assert.match(tm.output(a.id)!, /A0[\s\S]*A2/)
    assert.doesNotMatch(tm.output(a.id)!, /B\d/)
    assert.doesNotMatch(tm.output(b.id)!, /A\d/)
  })

  it('cancels one task without touching the others', async () => {
    const { tm, waitFor } = setup()
    const slow = tm.start('slow', 'setInterval(() => {}, 1000)', '.')
    const other = tm.start('other', 'setTimeout(() => console.log("fine"), 200)', '.')
    tm.cancel(slow.id)
    assert.equal((await waitFor(slow.id))?.status, 'cancelled')
    assert.equal((await waitFor(other.id))?.status, 'done')
  })

  it('a failing command is reported as failed, with its exit code', async () => {
    const { tm, waitFor } = setup()
    const t = tm.start('bad', 'process.exit(4)', '.')
    const end = await waitFor(t.id)
    assert.equal(end?.status, 'failed')
    assert.equal(end?.exitCode, 4)
  })

  it(`refuses more than ${MAX_RUNNING} at once`, () => {
    const { tm } = setup()
    for (let i = 0; i < MAX_RUNNING; i++) tm.start(`t${i}`, 'setInterval(() => {}, 1000)', '.')
    assert.throws(() => tm.start('one too many', 'console.log(1)', '.'), /already running/)
    tm.cancelAll()
  })
})

describe('in-process jobs (the research agent)', () => {
  it('runs, shows its latest line, and is announced like a program', async () => {
    const { tm, waitFor } = setup()
    let emit: (text: string) => void = () => {}
    let finish: (code: number) => void = () => {}
    const job = {
      pid: undefined,
      done: new Promise<{ exitCode: number; stdout: string; stdoutBytes: Buffer; stderr: string; timedOut: boolean; truncated: boolean; durationMs: number }>((resolve) => {
        finish = (code) => resolve({ exitCode: code, stdout: '', stdoutBytes: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false, durationMs: 1 })
      }),
      cancel: () => {},
      onOutput: (l: (text: string) => void) => (emit = l)
    }
    const t = tm.startJob('Research: phones', 'research → phones.docx', '.', job)
    emit('Searching: phones under 20000\n')
    emit('Saved Documents/phones.docx\n')
    finish(0)
    const done = await waitFor(t.id)
    assert.equal(done?.status, 'done')
    assert.equal(done?.lastLine, 'Saved Documents/phones.docx')
  })
})
