// An IN-PROCESS background job, shaped like a running program so the task manager (tasks/tasks.ts) can
// list it, report its progress ("what's the progress?" reads its latest line), cancel it and announce it
// when it ends. Long jobs (writing a document, research) run like this so Orbi stays free to talk
// (Abhay, 2026-10-20: "it shouldn't be blocked by those things").

import type { RunningProgram, RunResult } from '../hands/process'

export interface JobContext {
  say(line: string): void // one progress line (the task's "latest output")
  cancelled(): boolean
}

export function inProcessJob(work: (job: JobContext) => Promise<void>): RunningProgram {
  const listeners: ((text: string) => void)[] = []
  let cancelled = false
  const startedAt = Date.now()
  const say = (line: string): void => listeners.forEach((l) => l(`${line}\n`))
  const result = (exitCode: number | null, error?: string): RunResult => ({
    exitCode,
    stdout: '',
    stdoutBytes: Buffer.alloc(0),
    stderr: error ?? '',
    timedOut: false,
    truncated: false,
    durationMs: Date.now() - startedAt,
    ...(error ? { error } : {})
  })
  const done = (async (): Promise<RunResult> => {
    await new Promise((r) => setTimeout(r, 0)) // let the task manager attach its listener first
    try {
      await work({ say, cancelled: () => cancelled })
      return cancelled ? result(null, 'cancelled') : result(0)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      say(`Stopped: ${why}`)
      return result(1, why)
    }
  })()
  return { pid: undefined, done, cancel: () => (cancelled = true), onOutput: (listener) => listeners.push(listener) }
}
