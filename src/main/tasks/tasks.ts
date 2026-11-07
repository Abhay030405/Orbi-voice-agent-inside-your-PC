// BACKGROUND TASKS (PS A2): long jobs run while the conversation continues. You can ask how they're
// going, cancel them by voice, and run several at once without their output getting mixed up.
// Guide: docs/build-log/08-exactly-once-verify-tasks.md.
//
// Each task is its own process (own output buffer, own id), so tasks can't interfere with each other
// or with Dreamwalker. When one ends, the owner is told (onFinished), and Dreamwalker says so out loud.
// No Electron here: `start` is injected, so tests use fake programs.

import type { TaskInfo } from '../../shared/ipc'
import type { RunningProgram, RunResult } from '../hands/process'

// What the outside sees of a task (shared with the UI): title, status, seconds, latest output line...
export type TaskView = TaskInfo

interface Task extends Omit<TaskView, 'seconds'> {
  program: RunningProgram
  tail: string // the last few KB of output (both streams, in order)
}

export interface TaskHooks {
  start(command: string, folder: string): RunningProgram
  onChange(tasks: TaskView[]): void // for the UI; called on start, end, and at most once a second while output flows
  onFinished(task: TaskView): void
}

const TAIL_CHARS = 4000
export const MAX_RUNNING = 4

export class TaskManager {
  private readonly tasks = new Map<number, Task>()
  private nextId = 1
  private readonly hooks: TaskHooks
  private changeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(hooks: TaskHooks) {
    this.hooks = hooks
  }

  start(title: string, command: string, folder: string): TaskView {
    if (this.running().length >= MAX_RUNNING) {
      throw new Error(`${MAX_RUNNING} tasks are already running; wait for one to finish or cancel one.`)
    }
    return this.startJob(title, command, folder, this.hooks.start(command, folder))
  }

  // Any job that behaves like a program (output lines, done, cancel), e.g. the research agent, which
  // runs inside Dreamwalker rather than as a separate process. Same limits, list, announcements.
  startJob(title: string, command: string, folder: string, program: RunningProgram): TaskView {
    if (this.running().length >= MAX_RUNNING) {
      program.cancel()
      throw new Error(`${MAX_RUNNING} tasks are already running; wait for one to finish or cancel one.`)
    }
    const id = this.nextId++
    const task: Task = { id, title, command, folder, status: 'running', startedAt: Date.now(), lastLine: '', program, tail: '' }
    this.tasks.set(id, task)

    program.onOutput((text) => {
      task.tail = (task.tail + text).slice(-TAIL_CHARS)
      const lines = task.tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      task.lastLine = lines.at(-1)?.slice(0, 200) ?? task.lastLine
      this.changedSoon()
    })
    void program.done.then((r) => this.finished(task, r))

    this.changedNow()
    return view(task)
  }

  cancel(id: number): TaskView | null {
    const task = this.tasks.get(id)
    if (!task) return null
    if (task.status === 'running') {
      task.status = 'cancelled' // set first, so finished() reports it as cancelled, not failed
      task.program.cancel()
    }
    return view(task)
  }

  list(): TaskView[] {
    return [...this.tasks.values()].map(view).sort((a, b) => b.id - a.id)
  }

  running(): TaskView[] {
    return this.list().filter((t) => t.status === 'running')
  }

  get(id: number): TaskView | null {
    const task = this.tasks.get(id)
    return task ? view(task) : null
  }

  output(id: number): string | null {
    return this.tasks.get(id)?.tail ?? null
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) if (task.status === 'running') this.cancel(task.id)
  }

  private finished(task: Task, r: RunResult): void {
    task.endedAt = Date.now()
    task.exitCode = r.exitCode
    if (task.status !== 'cancelled') task.status = r.exitCode === 0 ? 'done' : 'failed'
    if (r.timedOut) task.lastLine = 'stopped: it ran past the time limit'
    this.changedNow()
    this.hooks.onFinished(view(task))
  }

  private changedNow(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.changeTimer = null
    this.hooks.onChange(this.list())
  }

  // Output can arrive hundreds of times a second; the UI only needs about one update a second.
  private changedSoon(): void {
    this.changeTimer ??= setTimeout(() => this.changedNow(), 1000)
  }
}

function view(t: Task): TaskView {
  return {
    id: t.id,
    title: t.title,
    command: t.command,
    folder: t.folder,
    status: t.status,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    seconds: Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000),
    lastLine: t.lastLine,
    exitCode: t.exitCode
  }
}
