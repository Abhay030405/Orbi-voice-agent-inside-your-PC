// ROUTINES (PS A5): taught by voice, run by name. "When I say back home, open Docker, open VS Code and set
// the volume to 30" saves a routine; later "back home" (said, typed, or sent from the phone) runs it.
//
// A routine is a NAME and a list of STEPS in the user's own words. Running one hands the steps back to
// Gemini, which does them with the normal tools: every step goes through the Gatekeeper, the Ledger and
// undo like any request, so a routine can never do more than the user could by asking. Saving one is a
// change like any other: in caution mode it asks first (a web page can't plant a routine).
//
// Kept in routines.json (user data), written atomically. The store is plain Node, tested on its own.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fuzzyRank } from './fuzzy.ts'
import type { Tool } from './tool.ts'

export interface Routine {
  name: string
  steps: string[]
  saved: number // ms
  runs: number
}

const MAX_ROUTINES = 50
const MAX_STEPS = 15
const MAX_STEP = 200

export class RoutineStore {
  private readonly file: string
  constructor(file: string) {
    this.file = file
  }

  all(): Routine[] {
    if (!existsSync(this.file)) return []
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { routines?: unknown }
      return Array.isArray(data.routines) ? (data.routines as Routine[]).filter((r) => typeof r?.name === 'string' && Array.isArray(r.steps)) : []
    } catch {
      return [] // a broken file must not break the app; the next save replaces it
    }
  }

  private write(list: Routine[]): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ routines: list }, null, 1))
    renameSync(tmp, this.file)
  }

  find(name: string): Routine[] {
    const all = this.all()
    const exact = all.filter((r) => r.name.toLowerCase() === name.trim().replace(/\s+/g, ' ').toLowerCase())
    return exact.length ? exact : fuzzyRank(all, name, (r) => r.name, 80)
  }

  // Saves (or replaces) a routine. Returns the one it replaced, for undo.
  save(name: string, steps: string[]): { routine: Routine; replaced: Routine | null } {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!clean) throw new Error('A routine needs a name.')
    const list = steps.map((s) => String(s).trim().slice(0, MAX_STEP)).filter(Boolean)
    if (list.length === 0) throw new Error('A routine needs at least one step.')
    if (list.length > MAX_STEPS) throw new Error(`A routine can have at most ${MAX_STEPS} steps.`)
    const all = this.all()
    const i = all.findIndex((r) => r.name.toLowerCase() === clean.toLowerCase())
    const replaced = i >= 0 ? all[i] : null
    if (!replaced && all.length >= MAX_ROUTINES) throw new Error(`There are already ${MAX_ROUTINES} routines; delete one first.`)
    const routine: Routine = { name: clean, steps: list, saved: Date.now(), runs: replaced?.runs ?? 0 }
    if (i >= 0) all[i] = routine
    else all.push(routine)
    this.write(all)
    return { routine, replaced }
  }

  remove(name: string): Routine | null {
    const all = this.all()
    const i = all.findIndex((r) => r.name.toLowerCase() === name.trim().toLowerCase())
    if (i < 0) return null
    const [gone] = all.splice(i, 1)
    this.write(all)
    return gone
  }

  // Puts a routine back exactly as it was (undo of a save or a delete); null = remove it.
  restore(name: string, previous: Routine | null): void {
    const all = this.all().filter((r) => r.name.toLowerCase() !== name.toLowerCase())
    if (previous) all.push(previous)
    this.write(all)
  }

  counted(name: string): void {
    const all = this.all()
    const r = all.find((x) => x.name === name)
    if (!r) return
    r.runs++
    this.write(all)
  }
}

// One line per routine for the instructions, so Gemini knows the names to listen for.
export function routinesInstruction(store: RoutineStore): string {
  const names = store.all().map((r) => `"${r.name}"`)
  if (names.length === 0) return ''
  return `The user has saved these routines: ${names.join(', ')}. When the user says one of these names as a command (or asks to run it), call run_routine.`
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function routineTools(store: () => RoutineStore): Tool[] {
  const saveRoutine: Tool = {
    name: 'save_routine',
    description:
      'Save a routine the user teaches you: a name and the steps, in their own words, one action per step ' +
      '("When I say back home, open Docker, open VS Code and set the volume to 30" → name "back home", steps ' +
      '["open Docker Desktop", "open VS Code", "set the volume to 30"]). Saving the same name again replaces it. ' +
      'Read the steps back to the user in one short sentence.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What the user will say to run it, e.g. "back home"' },
        steps: { type: 'array', items: { type: 'string' }, description: 'One action per step, in order' }
      },
      required: ['name', 'steps']
    },
    risk: 'low',
    effect: 'write',
    describe: (args) => `Save the routine "${str(args.name)}" (${Array.isArray(args.steps) ? args.steps.length : 0} steps)`,
    async run(args) {
      try {
        const steps = Array.isArray(args.steps) ? args.steps.map(String) : []
        const { routine, replaced } = store().save(str(args.name), steps)
        return {
          result: {
            ok: true,
            saved: routine.name,
            steps: routine.steps,
            replaced: replaced !== null,
            note: `From now on, when the user says "${routine.name}", call run_routine.`
          },
          undo: { name: routine.name, previous: replaced }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    async undo(undoData) {
      const { name, previous } = undoData as { name: string; previous: Routine | null }
      store().restore(name, previous)
      return { ok: true, restored: previous ? `the earlier "${name}"` : `no routine called "${name}"` }
    }
  }

  const runRoutine: Tool = {
    name: 'run_routine',
    description:
      'Run a saved routine by its name (roughly is fine). Returns its steps: then DO each step, in order, with ' +
      'your tools, as if the user had just asked for it; if a step fails, say which and go on with the rest. ' +
      'Finish with one short sentence on what was done.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    risk: 'low',
    effect: 'read', // it only reads the steps; each step is its own, checked, action
    async run(args) {
      const s = store()
      const hits = s.find(str(args.name))
      if (hits.length === 0) {
        const names = s.all().map((r) => r.name)
        return { ok: false, error: `There's no routine called "${str(args.name)}".${names.length ? ` Saved: ${names.join(', ')}.` : ' None are saved yet.'}` }
      }
      if (hits.length > 1) return { ok: false, error: `Several routines match: ${hits.map((r) => r.name).join(', ')}. Ask which one.` }
      const r = hits[0]
      s.counted(r.name)
      return { ok: true, routine: r.name, steps: r.steps, now: 'Do these steps now, in order, with your tools.' }
    }
  }

  const listRoutines: Tool = {
    name: 'list_routines',
    description: 'List the saved routines and their steps.',
    parameters: { type: 'object', properties: {} },
    risk: 'low',
    effect: 'read',
    async run() {
      const all = store().all()
      return { ok: true, routines: all.map((r) => ({ name: r.name, steps: r.steps, runs: r.runs })) }
    }
  }

  const deleteRoutine: Tool = {
    name: 'delete_routine',
    description: 'Delete a saved routine by its exact name (it can be undone).',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    risk: 'low',
    effect: 'write',
    describe: (args) => `Delete the routine "${str(args.name)}"`,
    async run(args) {
      const s = store()
      const name = s.find(str(args.name))[0]?.name ?? str(args.name)
      const gone = s.remove(name)
      if (!gone) return { ok: false, error: `There's no routine called "${str(args.name)}".` }
      return { result: { ok: true, deleted: gone.name }, undo: { name: gone.name, previous: gone } }
    },
    async undo(undoData) {
      const { name, previous } = undoData as { name: string; previous: Routine }
      store().restore(name, previous)
      return { ok: true, restored: name }
    }
  }

  return [saveRoutine, runRoutine, listRoutines, deleteRoutine]
}
