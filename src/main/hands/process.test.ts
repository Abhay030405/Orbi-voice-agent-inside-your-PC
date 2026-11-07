import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runPowerShell, runProgram, startProgram } from './process.ts'

const node = process.execPath
const opts = { timeoutMs: 5000, maxOutputBytes: 64 * 1024 }
const windowsOnly = { skip: process.platform !== 'win32' }

describe('runProgram', () => {
  it('returns output and exit code', async () => {
    const r = await runProgram(node, ['-e', 'console.log("hi"); process.exit(3)'], opts)
    assert.equal(r.stdout.trim(), 'hi')
    assert.equal(r.exitCode, 3)
    assert.equal(r.timedOut, false)
  })

  it('kills a program that runs past the timeout', async () => {
    const r = await runProgram(node, ['-e', 'setInterval(() => {}, 1000)'], { ...opts, timeoutMs: 300 })
    assert.equal(r.timedOut, true)
    assert.equal(r.exitCode, null)
    assert.ok(r.durationMs < 3000, `killed promptly (${r.durationMs} ms)`)
  })

  it('caps huge output instead of storing all of it', async () => {
    const r = await runProgram(node, ['-e', 'process.stdout.write("x".repeat(500000))'], { ...opts, maxOutputBytes: 1000 })
    assert.equal(r.stdout.length, 1000)
    assert.equal(r.truncated, true)
  })

  it('reports a program that does not exist, without throwing', async () => {
    const r = await runProgram('definitely-not-a-real-program-xyz', [], opts)
    assert.ok(r.error)
    assert.equal(r.exitCode, null)
  })
})

describe('startProgram (background tasks)', () => {
  it('returns at once, streams output while running, and can be cancelled', async () => {
    const t0 = Date.now()
    const p = startProgram(node, ['-e', 'console.log("first"); setInterval(() => {}, 1000)'], opts)
    assert.ok(Date.now() - t0 < 500, 'did not wait for the program')
    const firstOutput = await new Promise<string>((resolve) => p.onOutput(resolve))
    assert.equal(firstOutput.trim(), 'first')
    p.cancel()
    const r = await p.done
    assert.equal(r.error, 'cancelled')
    assert.equal(r.exitCode, null)
  })
})

describe('runPowerShell (AI text is DATA, never code)', windowsOnly, () => {
  it('passes values through environment variables', async () => {
    const r = await runPowerShell('Write-Output $env:DW_NAME', { name: 'Abhay' }, opts)
    assert.equal(r.stdout.trim(), 'Abhay')
  })

  it('an injection attempt is printed back as plain text, not run', async () => {
    const evil = '"; Write-Output INJECTED; "'
    const r = await runPowerShell('Write-Output "value=[$env:DW_X]"', { x: evil }, opts)
    assert.equal(r.stdout.trim(), `value=[${evil}]`)
    assert.ok(!/^INJECTED$/m.test(r.stdout), 'the injected command must not have run')
  })

  it('keeps non-ASCII text intact (UTF-8 output)', async () => {
    const r = await runPowerShell('Write-Output $env:DW_S', { s: 'Música नमस्ते' }, opts)
    assert.equal(r.stdout.trim(), 'Música नमस्ते')
  })
})
