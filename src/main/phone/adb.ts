// ADB: the one way Dreamwalker talks to the phone. Guide: docs/build-log/11-phone.md.
//
// adb (Android Debug Bridge, Google's own tool) is a program on the PC that talks to a service on the
// phone, over USB or Wi-Fi ("wireless debugging"). The user switched it on and tapped "Allow" for this
// PC once; Android remembers that. We run adb through our safe process runner (no shell on the PC, a
// timeout, an output cap), and every value that ends up in a phone command is quoted (parse.ts shQuote)
// because the phone's shell parses `adb shell` command lines again.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runProgram, type RunResult } from '../hands/process'

// Where adb is: ours (npm run tools; or next to the installed app), else whatever is on PATH.
export function adbPath(): string {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const candidates = [
    join(app.getAppPath(), 'resources', 'platform-tools', exe),
    join(process.resourcesPath ?? '', 'platform-tools', exe)
  ]
  return candidates.find((p) => existsSync(p)) ?? exe
}

export interface AdbOptions {
  timeoutMs?: number
  maxOutputBytes?: number
}

export async function adb(args: string[], opts: AdbOptions = {}): Promise<RunResult> {
  return runProgram(adbPath(), args, { timeoutMs: opts.timeoutMs ?? 15_000, maxOutputBytes: opts.maxOutputBytes ?? 512 * 1024 })
}

// Run a command line ON THE PHONE. `command` must be built from fixed text plus shQuote()d values.
export async function shell(serial: string, command: string, opts: AdbOptions = {}): Promise<string> {
  const r = await adb(['-s', serial, 'shell', command], opts)
  if (r.error) throw new Error(r.error.includes('ENOENT') ? 'adb is missing: run npm run tools' : r.error)
  if (r.timedOut) throw new Error('The phone took too long to answer.')
  if (r.exitCode !== 0 && !r.stdout.trim()) throw new Error(firstLine(r.stderr) || `adb exited with ${r.exitCode}`)
  return r.stdout
}

// The same, but the output is binary (e.g. a screenshot PNG): `exec-out` passes bytes through untouched.
export async function execOut(serial: string, command: string, opts: AdbOptions = {}): Promise<Buffer> {
  const r = await adb(['-s', serial, 'exec-out', command], { maxOutputBytes: 24 * 1024 * 1024, ...opts })
  if (r.error || r.timedOut || r.exitCode !== 0) throw new Error(firstLine(r.stderr) || r.error || 'The phone did not answer.')
  return r.stdoutBytes
}

export const firstLine = (text: string): string => text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
