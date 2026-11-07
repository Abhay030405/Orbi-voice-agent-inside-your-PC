// Tools for background tasks (PS A2). start_task is as powerful as run_command (it runs a command),
// so it has the same rules: high risk, the exact command shown in the confirmation, no undo. The
// difference: it returns at once, and the conversation goes on while it runs.

import type { TaskManager } from '../tasks/tasks'
import { folderInside } from './files'
import type { Tool } from './tool'
import { NOT_WINDOWS, isWindows } from './windows'

export function taskTools(tasks: () => TaskManager): Tool[] {
  const startTask: Tool = {
    name: 'start_task',
    description:
      'Start a LONG PowerShell command in the background (downloads, zipping, installs, builds, big copies) and ' +
      'keep talking while it runs. Give it a short title. You will be told when it finishes; you can also ' +
      'check with list_tasks or stop it with cancel_task. For quick commands use run_command instead.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name, e.g. "Zip the project"' },
        command: { type: 'string' },
        folder: { type: 'string', description: 'Where it runs: "Documents", "Downloads", "Desktop"... (leave out for the home folder)' }
      },
      required: ['title', 'command']
    },
    risk: 'high',
    effect: 'write',
    describe: (args) => `Start a background task "${String(args.title)}":\n\n    ${String(args.command)}`,
    async run(args) {
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      if (typeof args.command !== 'string' || !args.command.trim()) return { ok: false, error: 'command is required' }
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 60) : 'Background task'
      try {
        const folder = await folderInside(args.folder)
        const task = tasks().start(title, args.command, folder)
        return { ok: true, taskId: task.id, title, note: "It's running in the background. I'll say when it finishes." }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }

  const listTasks: Tool = {
    name: 'list_tasks',
    description: 'List background tasks: running and recently finished, with how long they took and their latest output line.',
    parameters: { type: 'object', properties: {} },
    risk: 'low',
    effect: 'read',
    untrustedOutput: true, // the latest output line is outside text
    async run() {
      const list = tasks()
        .list()
        .slice(0, 10)
        .map((t) => ({ id: t.id, title: t.title, status: t.status, seconds: t.seconds, latestOutput: t.lastLine }))
      return { ok: true, tasks: list }
    }
  }

  const cancelTask: Tool = {
    name: 'cancel_task',
    description: 'Stop a running background task (by its id from list_tasks or start_task).',
    parameters: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] },
    risk: 'low',
    effect: 'write',
    describe(args) {
      const task = tasks().get(Number(args.taskId))
      if (!task) throw new Error(`There is no task #${String(args.taskId)}.`) // pre-check
      if (task.status !== 'running') throw new Error(`Task #${task.id} "${task.title}" already ${task.status}.`)
      return `Stop the background task #${task.id} "${task.title}"`
    },
    async run(args) {
      const task = tasks().cancel(Number(args.taskId))
      if (!task) return { ok: false, error: `There is no task #${String(args.taskId)}.` }
      // VERIFY (A3): confirm it really stopped.
      for (let i = 0; i < 20 && tasks().get(task.id)?.endedAt === undefined; i++) await new Promise((r) => setTimeout(r, 100))
      const after = tasks().get(task.id)
      return after?.status === 'cancelled' && after.endedAt !== undefined
        ? { ok: true, cancelled: `#${task.id} ${task.title}`, verified: true }
        : { ok: false, error: `Task #${task.id} didn't stop yet.` }
    }
  }

  const getTaskOutput: Tool = {
    name: 'get_task_output',
    description: "Read the latest output of a background task (the last few thousand characters).",
    parameters: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] },
    risk: 'low',
    effect: 'read',
    untrustedOutput: true,
    async run(args) {
      const task = tasks().get(Number(args.taskId))
      if (!task) return { ok: false, error: `There is no task #${String(args.taskId)}.` }
      return { ok: true, id: task.id, title: task.title, status: task.status, output: (tasks().output(task.id) ?? '').slice(-3000) }
    }
  }

  return [startTask, listTasks, cancelTask, getTaskOutput]
}
