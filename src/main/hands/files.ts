// File tools, fenced into the user's own folders. Guide: docs/build-log/07-gatekeeper-ledger-tools.md.
//
// The fence: Desktop, Documents, Downloads, Pictures, Music, Videos (wherever Windows really keeps
// them, e.g. inside OneDrive). Everything else is refused: C:\Windows, Program Files, other users,
// our own app folder. The REAL location counts, after following links and resolving "..", so
// "Downloads\..\..\Windows" or a shortcut that points at C:\Windows doesn't get through.
//
// "Delete" never destroys: it moves the item into Dreamwalker's own trash folder, so "undo that" can
// always bring it back. Every change returns undo data for the Ledger.

import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Tool } from './tool'
import { findFiles } from './fuzzy'

const FOLDERS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const
const MAX_READ_BYTES = 1024 * 1024
const MAX_READ_CHARS = 20_000
const MAX_LIST = 200
// Opening these RUNS a program. That's what run_command (risky, always confirmed) is for.
const EXECUTABLE = /\.(exe|msi|bat|cmd|com|ps1|vbs|vbe|js|jse|wsf|wsh|scr|lnk|reg|hta|cpl|jar|appref-ms)$/i

let realRoots: { name: string; dir: string }[] | null = null
async function roots(): Promise<{ name: string; dir: string }[]> {
  realRoots ??= await Promise.all(
    FOLDERS.map(async (name) => {
      const dir = app.getPath(name)
      return { name, dir: await fs.realpath(dir).catch(() => dir) }
    })
  )
  return realRoots
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child) // case-insensitive on Windows
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const FENCE_MESSAGE = "outside the folders I'm allowed to touch (Desktop, Documents, Downloads, Pictures, Music, Videos)"

// What the AI said ("Downloads\report.pdf", "~/Desktop/x", "C:\Users\me\Documents\a.txt") → a real
// absolute path inside the fence, or an Error saying why not.
export async function resolveInside(input: unknown, mustExist: boolean): Promise<string> {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A path is required')
  let p = input.trim().replace(/^["']|["']$/g, '')
  if (p === '~' || /^~[\\/]/.test(p)) p = path.join(os.homedir(), p.slice(1))
  else if (!path.isAbsolute(p)) {
    const [first, ...rest] = p.split(/[\\/]+/)
    const root = (await roots()).find((r) => r.name === first.toLowerCase())
    if (!root) throw new Error(`Give a full path, or one starting with ${FOLDERS.map((f) => f[0].toUpperCase() + f.slice(1)).join(', ')}`)
    p = path.join(root.dir, ...rest)
  }
  p = path.resolve(p)

  let real: string
  try {
    real = await fs.realpath(p) // follows links: the REAL location must be inside
  } catch {
    if (mustExist) throw new Error(`"${input}" doesn't exist`)
    const parent = await fs.realpath(path.dirname(p)).catch(() => {
      throw new Error(`The folder for "${input}" doesn't exist`)
    })
    real = path.join(parent, path.basename(p))
  }
  if (!(await roots()).some((r) => isInside(real, r.dir))) throw new Error(`"${input}" is ${FENCE_MESSAGE}`)
  return real
}

// Wrap a tool body so a thrown Error (e.g. from the fence) becomes { ok: false, error }.
async function guarded<T>(body: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await body()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// rename() can't move across drives (EXDEV, e.g. Downloads on D:, trash on C:): copy, then remove.
async function moveItem(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.cp(from, to, { recursive: true, errorOnExist: true })
    await fs.rm(from, { recursive: true, force: true })
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false
  )
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function whatIsIt(p: string): Promise<string> {
  const stat = await fs.stat(p).catch(() => null)
  if (!stat) return `"${path.basename(p)}"`
  if (stat.isDirectory()) {
    const count = (await fs.readdir(p).catch(() => [])).length
    return `the folder "${path.basename(p)}" (${count} item${count === 1 ? '' : 's'} inside)`
  }
  return `"${path.basename(p)}" (${sizeText(stat.size)})`
}

const trashDir = (): string => path.join(app.getPath('userData'), 'trash')

async function isMainFolder(p: string): Promise<boolean> {
  return (await roots()).some((r) => path.relative(r.dir, p) === '')
}

// ── The tools ──

export const listFolder: Tool = {
  name: 'list_folder',
  description: 'List what is in a folder: names, file/folder, size, last modified. Path like "Downloads" or a full path.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // file names are outside text
  run: (args) =>
    guarded(async () => {
      const dir = await resolveInside(args.path, true)
      const names = await fs.readdir(dir)
      const items = await Promise.all(
        names.slice(0, MAX_LIST).map(async (name) => {
          const st = await fs.stat(path.join(dir, name)).catch(() => null)
          return {
            name,
            type: st?.isDirectory() ? 'folder' : 'file',
            size: st && !st.isDirectory() ? sizeText(st.size) : undefined,
            modified: st ? st.mtime.toLocaleString('en-IN') : undefined
          }
        })
      )
      return { ok: true as const, folder: dir, items, more: Math.max(0, names.length - MAX_LIST) }
    })
}

export const readTextFile: Tool = {
  name: 'read_text_file',
  description: 'Read a text file (notes, code, CSV, logs...). Not for binary files like images or PDFs.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // a file's contents can contain instructions written by anyone
  run: (args) =>
    guarded(async () => {
      const file = await resolveInside(args.path, true)
      const st = await fs.stat(file)
      if (st.isDirectory()) return { ok: false as const, error: 'That is a folder; use list_folder.' }
      if (st.size > MAX_READ_BYTES) return { ok: false as const, error: `That file is ${sizeText(st.size)}; the limit is 1 MB.` }
      const buf = await fs.readFile(file)
      if (buf.subarray(0, 8000).includes(0)) {
        return { ok: false as const, error: "That isn't a text file. For PDFs and images, use read_document." }
      }
      const text = buf.toString('utf8')
      return { ok: true as const, file, text: text.slice(0, MAX_READ_CHARS), truncated: text.length > MAX_READ_CHARS }
    })
}

// Save bytes in Downloads under a safe name, never overwriting ("photo (2).jpg"). Returns the real path.
export async function saveInDownloads(name: string, data: Buffer): Promise<string> {
  const clean = path.basename(name.replace(/\\/g, '/')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || 'file'
  const dot = clean.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, '']
  for (let n = 1; n <= 50; n++) {
    const file = await resolveInside(`Downloads/${n === 1 ? clean : `${stem} (${n})${ext}`}`, false)
    try {
      await fs.writeFile(file, data, { flag: 'wx' }) // wx = fail if it already exists
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    const written = await fs.stat(file).catch(() => null)
    if (!written || written.size !== data.length) throw new Error(`Saving ${clean} failed: the file in Downloads is incomplete.`)
    return file
  }
  throw new Error(`Downloads already has 50 files called ${clean}.`)
}

// Undo for any tool that CREATED a file (text, Word, PowerPoint): even undo doesn't destroy, the file
// goes to Dreamwalker's trash.
export const createdFileUndo = (undoData: unknown) =>
  guarded(async () => {
    const { file } = undoData as { file: string }
    const dest = path.join(trashDir(), `${Date.now()}`, path.basename(file))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await moveItem(file, dest)
    return { ok: true as const, removed: file }
  })

export const createTextFile: Tool = {
  name: 'create_text_file',
  description: 'Create a NEW text file with the given content (never overwrites an existing file).',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content']
  },
  risk: 'low',
  effect: 'write',
  async describe(args) {
    const file = await resolveInside(args.path, false)
    if (await exists(file)) throw new Error(`"${file}" already exists; I only create new files.`)
    return `Create the file "${file}" (${String(args.content ?? '').length} characters)`
  },
  run: (args) =>
    guarded(async () => {
      if (typeof args.content !== 'string') return { ok: false as const, error: 'content must be text' }
      if (args.content.length > MAX_READ_BYTES) return { ok: false as const, error: 'That is too much text (max 1 MB).' }
      const file = await resolveInside(args.path, false)
      await fs.writeFile(file, args.content, { flag: 'wx' }) // wx = fail if it already exists
      // VERIFY (A3): check the real file, don't trust that writeFile worked.
      const written = await fs.stat(file).catch(() => null)
      if (!written || written.size !== Buffer.byteLength(args.content)) {
        return { result: { ok: false as const, error: `Wrote the file, but checking it shows ${written ? `${written.size} bytes instead of ${Buffer.byteLength(args.content)}` : 'it is not there'}.` }, undo: { file } }
      }
      return { result: { ok: true as const, created: file, verified: true }, undo: { file } }
    }),
  undo: (undoData) => createdFileUndo(undoData)
}

export const createFolder: Tool = {
  name: 'create_folder',
  description: 'Create a new folder.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'low',
  effect: 'write',
  async describe(args) {
    const dir = await resolveInside(args.path, false)
    if (await exists(dir)) throw new Error(`"${dir}" already exists.`)
    return `Create the folder "${dir}"`
  },
  run: (args) =>
    guarded(async () => {
      const dir = await resolveInside(args.path, false)
      if (await exists(dir)) return { ok: false as const, error: `"${dir}" already exists.` }
      await fs.mkdir(dir)
      if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) return { ok: false as const, error: 'The folder did not appear.' }
      return { result: { ok: true as const, created: dir, verified: true }, undo: { dir } }
    }),
  undo: (undoData) =>
    guarded(async () => {
      const { dir } = undoData as { dir: string }
      await fs.rmdir(dir) // only removes it if it's still empty; otherwise fails safely
      return { ok: true as const, removed: dir }
    })
}

export const openFile: Tool = {
  name: 'open_file',
  description:
    'Open a file or folder with its normal app (a PDF in the PDF reader, a folder in Explorer...). ' +
    '`with: "vscode"` opens it in VS Code instead (for code). Will not run programs.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, with: { type: 'string', enum: ['default', 'vscode'] } },
    required: ['path']
  },
  risk: 'low',
  effect: 'write',
  async describe(args) {
    const file = await resolveInside(args.path, true)
    if (EXECUTABLE.test(file)) throw new Error("That would RUN a program. I won't open programs directly; ask me to run it as a command instead.")
    return `Open "${path.basename(file)}"${args.with === 'vscode' ? ' in VS Code' : ''}`
  },
  run: (args) =>
    guarded(async () => {
      const file = await resolveInside(args.path, true)
      if (EXECUTABLE.test(file)) {
        return { ok: false as const, error: "That would RUN a program. I won't open programs directly; ask me to run it as a command instead." }
      }
      if (args.with === 'vscode') {
        const code = await vsCodePath()
        if (!code) return { ok: false as const, error: "VS Code isn't installed in its usual place, so I couldn't open it there." }
        // The file is ONE argument to Code.exe, no shell in between: a file name can't become a command.
        spawn(code, [file], { detached: true, stdio: 'ignore' }).unref()
        return { ok: true as const, opened: file, in: 'VS Code' }
      }
      const failure = await shell.openPath(file) // '' = success, otherwise the error message
      return failure ? { ok: false as const, error: failure } : { ok: true as const, opened: file }
    })
}

export const moveFile: Tool = {
  name: 'move_file',
  description:
    'Move or rename a file or folder. "to" can be a new name/path, or an existing folder to move it into. ' +
    'Never overwrites something that already exists.',
  parameters: {
    type: 'object',
    properties: { from: { type: 'string' }, to: { type: 'string' } },
    required: ['from', 'to']
  },
  risk: 'high',
  effect: 'write',
  async describe(args) {
    const from = await resolveInside(args.from, true) // throws: outside the fence / missing
    if (await isMainFolder(from)) throw new Error("I won't move one of your main folders.")
    await resolveInside(args.to, false) // the destination must be inside the fence too
    return `Move ${await whatIsIt(from)} to "${String(args.to)}"`
  },
  run: (args) =>
    guarded(async () => {
      const from = await resolveInside(args.from, true)
      if (await isMainFolder(from)) return { ok: false as const, error: "I won't move one of your main folders." }
      let to = await resolveInside(args.to, false)
      if ((await fs.stat(to).catch(() => null))?.isDirectory()) to = path.join(to, path.basename(from))
      to = await resolveInside(to, false) // re-check after joining
      if (await exists(to)) return { ok: false as const, error: `"${to}" already exists; I won't overwrite it.` }
      await moveItem(from, to)
      // VERIFY (A3): the source must be gone AND the destination must exist.
      if ((await exists(from)) || !(await exists(to))) {
        return { result: { ok: false as const, error: `The move didn't fully happen: source ${(await exists(from)) ? 'still there' : 'gone'}, destination ${(await exists(to)) ? 'there' : 'missing'}.` }, undo: { from, to } }
      }
      return { result: { ok: true as const, from, to, verified: true }, undo: { from, to } }
    }),
  undo: (undoData) =>
    guarded(async () => {
      const { from, to } = undoData as { from: string; to: string }
      if (await exists(from)) return { ok: false as const, error: `Something is already at "${from}" again; I won't overwrite it.` }
      await moveItem(to, from)
      return { ok: true as const, movedBack: from }
    })
}

export const deleteFile: Tool = {
  name: 'delete_file',
  description: "Delete a file or folder. It goes to Dreamwalker's trash, so it can be brought back with undo.",
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'high',
  effect: 'write',
  async describe(args) {
    const target = await resolveInside(args.path, true) // throws: outside the fence / missing
    if (await isMainFolder(target)) throw new Error("I won't delete one of your main folders.")
    return `Delete ${await whatIsIt(target)} (moved to Dreamwalker's trash)`
  },
  run: (args) =>
    guarded(async () => {
      const target = await resolveInside(args.path, true)
      if (await isMainFolder(target)) return { ok: false as const, error: "I won't delete one of your main folders." }
      const dest = path.join(trashDir(), `${Date.now()}`, path.basename(target))
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await moveItem(target, dest)
      // VERIFY (A3): gone from where it was, and safely in the trash (so undo can bring it back).
      if ((await exists(target)) || !(await exists(dest))) {
        return { result: { ok: false as const, error: "The delete didn't fully happen; the file may still be in its folder." }, undo: { original: target, trashed: dest } }
      }
      return { result: { ok: true as const, deleted: target, verified: true }, undo: { original: target, trashed: dest } }
    }),
  undo: (undoData) =>
    guarded(async () => {
      const { original, trashed } = undoData as { original: string; trashed: string }
      if (await exists(original)) return { ok: false as const, error: `Something new is at "${original}"; I won't overwrite it.` }
      await moveItem(trashed, original)
      return { ok: true as const, restored: original }
    })
}

// FIND A FILE BY (ROUGHLY) ITS NAME: the search itself is findFiles (fuzzy.ts, testable without Electron).
export const findFilesTool: Tool = {
  name: 'find_files',
  description:
    "Find files by name anywhere in the user's folders (Desktop, Documents, Downloads, Pictures, Music, Videos), " +
    'even if the name is misheard or only roughly remembered ("the DBMS assignment pdf", "my resume"). Returns the ' +
    'best matches with full paths, newest first among equals. Use it before open_file, send_to_phone or move_file ' +
    "when you don't know the exact path. Put a type in the query to narrow it (\"resume pdf\").",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the file is called, roughly, e.g. "dbms assignment pdf"' },
      folder: { type: 'string', description: 'Optional: only look here, e.g. "Downloads"' }
    },
    required: ['query']
  },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // file names are outside text
  run: (args) =>
    guarded(async () => {
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : ''
      if (!query) throw new Error('What should I look for?')
      const within = typeof args.folder === 'string' && args.folder.trim() ? [await resolveInside(args.folder, true)] : (await roots()).map((r) => r.dir)
      const hits = await findFiles(query, [...new Set(within)])
      if (hits.length === 0) return { ok: false as const, error: `No file with a name like "${query}" in ${typeof args.folder === 'string' && args.folder.trim() ? args.folder : 'your folders'}.` }
      return {
        ok: true as const,
        files: hits.map((h) => ({ path: h.path, size: sizeText(h.size), modified: new Date(h.mtime).toLocaleString('en-IN'), match: h.score >= 95 ? 'name contains it' : `close (${h.score}%)` }))
      }
    })
}

export const FILE_TOOLS: Tool[] = [listFolder, findFilesTool, readTextFile, createTextFile, createFolder, openFile, moveFile, deleteFile]

// For the terminal tools: a folder inside the fence, or the home folder.
export async function folderInside(input: unknown): Promise<string> {
  // "~" or "home" = the default too: Gemini passed "~" and the task was refused twice (2026-10-20).
  if (input === undefined || input === null || input === '' || input === '~' || String(input).toLowerCase() === 'home') return os.homedir()
  return resolveInside(input, true)
}

async function vsCodePath(): Promise<string | null> {
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'), // per-user install
    path.join(process.env.ProgramFiles ?? 'C:\Program Files', 'Microsoft VS Code', 'Code.exe')
  ]
  for (const c of candidates) if (await exists(c)) return c
  return null
}
