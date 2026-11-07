// PROCESS RUNNER: the one safe way any tool starts another program. Guide: docs/build-log/07-gatekeeper-ledger-tools.md.
//
// Every program runs as its OWN process (own PID, own memory; see docs/build-log/06-edge-glow.md),
// so it can't crash Dreamwalker. What it CAN do is hang, flood us with output, or leave children
// behind. So every run has:
//   - a timeout, after which the whole process TREE is killed (taskkill /T on Windows: killing just
//     the shell would leave the programs it started running)
//   - an output cap (a runaway `dir /s C:\` can't fill our memory)
//   - shell: false. Arguments go straight to the program; nothing is re-parsed by a shell.
//   - windowsHide: no console window flashes up.

import { spawn } from 'node:child_process'

export interface RunOptions {
  timeoutMs: number
  maxOutputBytes: number // per stream (stdout and stderr each)
  cwd?: string
  env?: Record<string, string>
}

export interface RunResult {
  exitCode: number | null // null = killed or never started
  stdout: string
  stdoutBytes: Buffer // the same output as raw bytes (binary output, e.g. a phone screenshot)
  stderr: string
  timedOut: boolean
  truncated: boolean // output went past maxOutputBytes and was cut
  durationMs: number
  error?: string // the program couldn't be started at all (e.g. not installed)
}

// A program that is running right now. Background tasks (A2) keep one of these: they can watch its
// output as it arrives and cancel it at any time.
export interface RunningProgram {
  pid: number | undefined
  done: Promise<RunResult> // resolves when it ends, however it ends
  cancel(): void // kill the whole process tree
  onOutput(listener: (text: string) => void): void // live output, both streams
}

// Start a program and return at once. runProgram() is this + waiting, so there is ONE copy of the
// safety logic (timeout, tree kill, output cap, no shell).
export function startProgram(file: string, args: string[], opts: RunOptions): RunningProgram {
  const started = Date.now()
  const listeners: ((text: string) => void)[] = []
  let child
  try {
    child = spawn(file, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: false,
      windowsHide: true
    })
  } catch (err) {
    return { pid: undefined, done: Promise.resolve(failed(started, err)), cancel: () => {}, onOutput: () => {} }
  }

  const out = collector(opts.maxOutputBytes)
  const errOut = collector(opts.maxOutputBytes)
  const emit = (d: Buffer): void => {
    const text = d.toString('utf8')
    for (const l of listeners) l(text)
  }
  child.stdout?.on('data', (d: Buffer) => {
    out.add(d)
    emit(d)
  })
  child.stderr?.on('data', (d: Buffer) => {
    errOut.add(d)
    emit(d)
  })

  let timedOut = false
  let cancelled = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(child.pid)
  }, opts.timeoutMs)

  let spawnError: string | undefined
  child.on('error', (err) => (spawnError = err.message))
  const done = new Promise<RunResult>((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        // Never started (e.g. ENOENT; Windows still reports a code like -4058) or killed → null.
        exitCode: timedOut || cancelled || spawnError ? null : code,
        stdout: out.text(),
        stdoutBytes: out.bytes(),
        stderr: errOut.text(),
        timedOut,
        truncated: out.truncated || errOut.truncated,
        durationMs: Date.now() - started,
        error: spawnError ?? (cancelled ? 'cancelled' : undefined)
      })
    })
  })

  return {
    pid: child.pid,
    done,
    cancel: () => {
      cancelled = true
      killTree(child.pid)
    },
    onOutput: (listener) => listeners.push(listener)
  }
}

export function runProgram(file: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return startProgram(file, args, opts).done
}

// Run one of OUR OWN PowerShell scripts with AI-provided values passed as DATA.
//
// Never do `powershell -Command "Start-Process ${url}"`: with -Command, PowerShell joins everything
// into one string of CODE, so a URL like  https://x.com"; Remove-Item C:\Users -Recurse; "  would run.
// Instead the script is fixed, and every outside value arrives as an environment variable
// (DW_<NAME>), which PowerShell only ever reads as a plain string: $env:DW_URL.
// The script itself is sent base64-encoded (-EncodedCommand), so our own quotes can't break either.
export function runPowerShell(script: string, data: Record<string, string>, opts: RunOptions): Promise<RunResult> {
  return startPowerShell(script, data, opts).done
}

// The same, but returns at once (background tasks).
export function startPowerShell(script: string, data: Record<string, string>, opts: RunOptions): RunningProgram {
  const env: Record<string, string> = { ...opts.env }
  for (const [key, value] of Object.entries(data)) env[`DW_${key.toUpperCase()}`] = value
  // Output as UTF-8, not the console's legacy code page, so names like "Música" survive.
  // ProgressPreference off: otherwise PowerShell writes its progress bar into the output as XML
  // ("#< CLIXML ... Preparing modules for first use"), seen in testing.
  const prelude =
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = "Stop"; $ProgressPreference = "SilentlyContinue"; '
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64')
  return startProgram(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { ...opts, env }
  )
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

function collector(max: number) {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    add(d: Buffer) {
      if (size >= max) {
        truncated = true // keep draining the pipe (or the child blocks), but stop storing
        return
      }
      const room = max - size
      chunks.push(d.length > room ? d.subarray(0, room) : d)
      if (d.length > room) truncated = true
      size += Math.min(d.length, room)
    },
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString('utf8'),
    get truncated() {
      return truncated
    }
  }
}

function failed(started: number, err: unknown): RunResult {
  return {
    exitCode: null,
    stdout: '',
    stdoutBytes: Buffer.alloc(0),
    stderr: '',
    timedOut: false,
    truncated: false,
    durationMs: Date.now() - started,
    error: err instanceof Error ? err.message : String(err)
  }
}
