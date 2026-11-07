// Terminal tools. run_command is the most powerful tool Dreamwalker has, so it is HIGH risk with no
// undo: it always asks (unless you allow-list it), shows the exact command in the confirmation, has a
// timeout and an output cap, and its output counts as outside content (caution mode).
//
// Here the AI's text IS code: that's the point of the tool. The protection is the human seeing the
// exact command and saying yes, not escaping. The command still travels as data (env var) into a
// fixed wrapper script, so the wrapper itself can't be broken.

import { runPowerShell, type RunResult } from './process'
import { folderInside } from './files'
import type { Tool } from './tool'
import { NOT_WINDOWS, isWindows, psJson } from './windows'

const MAX_OUTPUT_CHARS = 8000

export const runCommand: Tool = {
  name: 'run_command',
  description:
    'Run a PowerShell command and return its output (e.g. "git status", "ipconfig", "Get-ChildItem *.pdf"). ' +
    'Optional folder to run it in. Times out after 60 s. The user must approve every command.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, folder: { type: 'string' } },
    required: ['command']
  },
  risk: 'high',
  effect: 'write',
  untrustedOutput: true,
  describe: (args) => `Run this command in PowerShell:\n\n    ${String(args.command)}`,
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    if (typeof args.command !== 'string' || !args.command.trim()) return { ok: false, error: 'command is required' }
    let cwd: string
    try {
      cwd = await folderInside(args.folder)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const r: RunResult = await runPowerShell(
      // Our fixed wrapper: build the command from the env var and run it, errors included in output.
      '& ([scriptblock]::Create($env:DW_CMD)) 2>&1 | Out-String -Width 200',
      { cmd: args.command },
      { timeoutMs: 60_000, maxOutputBytes: 64 * 1024, cwd }
    )
    const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim()
    const result = {
      exitCode: r.exitCode,
      output: output.slice(0, MAX_OUTPUT_CHARS),
      truncated: r.truncated || output.length > MAX_OUTPUT_CHARS,
      timedOut: r.timedOut,
      folder: cwd
    }
    if (r.timedOut) return { ok: false, error: 'The command ran longer than 60 s and was stopped.', ...result }
    if (r.exitCode !== 0) return { ok: false, error: `The command failed (exit code ${r.exitCode}).`, ...result }
    return { ok: true, ...result }
  }
}

export const openTerminal: Tool = {
  name: 'open_terminal',
  description: 'Open a terminal window for the user (Windows Terminal, or PowerShell), optionally in a folder.',
  parameters: { type: 'object', properties: { folder: { type: 'string' } } },
  risk: 'low',
  effect: 'write',
  describe: (args) => `Open a terminal${args.folder ? ` in "${String(args.folder)}"` : ''}`,
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    let dir: string
    try {
      dir = await folderInside(args.folder)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    await psJson(
      `try { Start-Process wt.exe -ArgumentList '-d', ('"' + $env:DW_DIR + '"') -ErrorAction Stop }
       catch { Start-Process powershell.exe -WorkingDirectory $env:DW_DIR }
       'null'`,
      { dir }
    )
    return { ok: true, opened: 'a terminal', folder: dir }
  }
}

export const SHELL_TOOLS: Tool[] = [runCommand, openTerminal]
