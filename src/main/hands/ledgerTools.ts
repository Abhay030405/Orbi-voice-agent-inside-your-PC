// Tools that work on the Ledger itself: "what have you done?" and "undo that" (PS B4: undo by
// voice, even after a restart, because the Ledger is on disk).

import type { Ledger, LedgerEntry } from '../ledger/ledger'
import type { Tool } from './tool'

interface Deps {
  ledger: () => Ledger | null // opened at startup, so look it up when needed
  findTool: (name: string) => Tool | undefined
}

export function ledgerTools({ ledger, findTool }: Deps): Tool[] {
  const listRecentActions: Tool = {
    name: 'list_recent_actions',
    description:
      'List the most recent actions you took on this computer (newest first), with whether each worked ' +
      'and whether it can be undone. Use it when the user asks what you did, or before undoing something.',
    parameters: {
      type: 'object',
      properties: { count: { type: 'integer', description: 'How many, 1 to 20. Default 5.' } }
    },
    risk: 'low',
    effect: 'read',
    async run(args) {
      const l = ledger()
      if (!l) return { ok: false, error: 'The action history is not available' }
      const count = typeof args.count === 'number' ? Math.max(1, Math.min(20, Math.floor(args.count))) : 5
      const actions = l
        .recent(count + 10)
        .filter((e) => !['list_recent_actions', 'undo_last_action'].includes(e.tool))
        .slice(0, count)
        .map((e) => ({
          id: e.id,
          what: e.description,
          status: e.status,
          canUndo: e.status === 'done' && e.undo !== null,
          when: new Date(e.createdAt).toLocaleString('en-IN')
        }))
      return { ok: true, actions }
    }
  }

  const undoLastAction: Tool = {
    name: 'undo_last_action',
    description:
      'Undo the most recent action that can be undone (for example a moved, renamed or deleted file, or a ' +
      'volume change). Works even after the app was restarted. Use it when the user says "undo that". ' +
      'To undo SEVERAL actions, call list_recent_actions and pass the id of each one, one call per id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'A specific action id from list_recent_actions. Omit for the latest.' } }
    },
    risk: 'low',
    effect: 'write',
    describe: (args) => {
      const target = pickTarget(args)
      return target ? `Undo: ${target.description}` : 'Undo the last action'
    },
    async run(args) {
      const l = ledger()
      if (!l) return { ok: false, error: 'The action history is not available' }
      const last = pickTarget(args)
      if (!last) return { ok: false, error: 'There is nothing that can be undone.' }
      if (last.status !== 'done' || last.undo === null) {
        return { ok: false, error: `"${last.description}" can't be undone (${last.status}).` }
      }
      const tool = findTool(last.tool)
      if (!tool?.undo) {
        l.markUndone(last.id, false, 'this kind of action has no undo')
        return { ok: false, error: `"${last.description}" can't be undone.` }
      }
      try {
        const result = await tool.undo(last.undo)
        l.markUndone(last.id, result.ok, result.ok ? undefined : result.error)
        return result.ok ? { ok: true, undid: last.description } : result
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        l.markUndone(last.id, false, error)
        return { ok: false, error: `Couldn't undo "${last.description}": ${error}` }
      }
    }
  }

  // The action to undo: the one with the given id, or the latest undoable one.
  function pickTarget(args: Record<string, unknown>): LedgerEntry | null {
    const l = ledger()
    if (!l) return null
    return typeof args.id === 'number' ? l.get(Math.floor(args.id)) : l.lastUndoable()
  }

  return [listRecentActions, undoLastAction]
}
