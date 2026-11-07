import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { startWatch, type Judge } from './watch.ts'

const shot = async (): Promise<Buffer> => Buffer.from('jpeg')
const collect = (p: ReturnType<typeof startWatch>): string[] => {
  const lines: string[] = []
  p.onOutput((t) => lines.push(...t.split('\n').filter(Boolean)))
  return lines
}

describe('screen watch (A6)', () => {
  it('ends, with what it saw, the first time the condition is seen', async () => {
    let n = 0
    const judge: Judge = async (_jpeg, condition) => {
      n++
      assert.equal(condition, 'the download says Done')
      return n < 3 ? { seen: false, what: 'still 40%' } : { seen: true, what: 'Chrome shows Done' }
    }
    const p = startWatch('the download says Done', 1, shot, judge, 10)
    const lines = collect(p)
    const r = await p.done
    assert.equal(r.exitCode, 0)
    assert.equal(n, 3)
    assert.match(lines.at(-1) ?? '', /^Seen after 3 checks: Chrome shows Done$/)
  })

  it('a cancel stops it quickly, as cancelled (not as failed)', async () => {
    const p = startWatch('never', 1, shot, async () => ({ seen: false, what: 'nothing' }), 5_000)
    const t0 = Date.now()
    setTimeout(() => p.cancel(), 50)
    const r = await p.done
    assert.equal(r.error, 'cancelled')
    assert.ok(Date.now() - t0 < 1500)
  })

  it('a few failed looks are fine; five in a row stop it with the reason', async () => {
    let n = 0
    const flaky: Judge = async () => {
      n++
      if (n <= 2) throw new Error('no internet')
      return { seen: true, what: 'ok' }
    }
    assert.equal((await startWatch('x', 1, shot, flaky, 5).done).exitCode, 0)
    const broken = startWatch('x', 1, async () => { throw new Error('screen locked') }, flaky, 5)
    const r = await broken.done
    assert.equal(r.exitCode, 1)
    assert.match(r.error ?? '', /couldn't look at the screen \(screen locked\)/)
  })

  it('gives up at the time limit, saying it never saw it', async () => {
    const p = startWatch('x', 0.001, shot, async () => ({ seen: false, what: 'no' }), 20)
    const r = await p.done
    assert.equal(r.exitCode, 1)
    assert.match(r.error ?? '', /never saw "x"/)
  })
})
