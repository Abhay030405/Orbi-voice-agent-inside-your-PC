// LEDGER: the permanent record of every action Dreamwalker takes. Guide: docs/build-log/07-gatekeeper-ledger-tools.md.
//
// Rules (docs/guide/03-architecture.md, D5):
//   1. Write the action down BEFORE running it (status 'pending'). If we crash mid-action, the row
//      is still there on restart, so we know something was in flight ('interrupted').
//   2. Afterwards, record the result and HOW TO UNDO it ('done' + undo data), or why it failed.
//   3. It's on disk, so "undo that" works even after a restart (PS B4).
//
// Why SQLite and not a JSON file: one action = one row in one transaction. With WAL (write-ahead
// logging) a power cut leaves either the old state or the new one, never half. And "the last
// undoable action" is one query instead of loading the whole history. Node has SQLite built in
// (node:sqlite), so there's no native module to install.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type ActionStatus =
  | 'pending' // written down, about to run
  | 'done' // ran and worked
  | 'failed' // ran and didn't work (result says why)
  | 'denied' // the Gatekeeper or the user said no; never ran
  | 'interrupted' // was pending when the app stopped: we don't know if it happened
  | 'undone' // done, then reversed
  | 'undo_failed' // tried to reverse it and couldn't (note says why)

export type ActionSource = 'voice' | 'text' | 'routine' | 'watcher' | 'ui' | 'system'

export interface LedgerEntry {
  id: number
  callId: string
  tool: string
  args: Record<string, unknown>
  risk: string
  description: string // human words, e.g. "Move report.pdf to Dreamwalker's trash"
  source: ActionSource
  status: ActionStatus
  result: Record<string, unknown> | null
  undo: unknown // what the tool needs to reverse it; null = can't be undone
  note: string | null
  idemKey: string | null // for exactly-once (A1, M3): same request + tool + args = same action
  createdAt: number
  updatedAt: number
}

export interface NewAction {
  callId: string
  tool: string
  args: Record<string, unknown>
  risk: string
  description: string
  source: ActionSource
  idemKey?: string
}

const SCHEMA_VERSION = 1

export class Ledger {
  private readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    // WAL: changes go to a log first, then into the main file. Crash-safe and fast.
    // synchronous=FULL: wait until the disk really has it before saying "written". A ledger that
    // claims an action is recorded when it isn't would defeat the point.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 2000;')
    this.migrate()
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version >= SCHEMA_VERSION) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id     TEXT NOT NULL,
        tool        TEXT NOT NULL,
        args        TEXT NOT NULL,                -- JSON
        risk        TEXT NOT NULL,
        description TEXT NOT NULL,
        source      TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN
                      ('pending','done','failed','denied','interrupted','undone','undo_failed')),
        result      TEXT,                         -- JSON
        undo        TEXT,                         -- JSON; NULL = can't be undone
        note        TEXT,
        idem_key    TEXT UNIQUE,                  -- exactly-once (M3); the database enforces "only one"
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS actions_recent ON actions (id DESC);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  }

  // Rule 1: write it down BEFORE running it.
  begin(action: NewAction): number {
    const now = Date.now()
    const info = this.db
      .prepare(
        `INSERT INTO actions (call_id, tool, args, risk, description, source, status, idem_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(
        action.callId,
        action.tool,
        JSON.stringify(action.args),
        action.risk,
        action.description,
        action.source,
        action.idemKey ?? null,
        now,
        now
      )
    return Number(info.lastInsertRowid)
  }

  // Rule 2: record what happened and how to reverse it.
  // A FAILED action gives its idempotency key back (sets it to NULL), so trying again can run. Done and
  // denied are final: a retry gets the same result ("already done" / "you said no").
  finish(id: number, status: 'done' | 'failed' | 'denied', result: Record<string, unknown>, undo: unknown = null): void {
    this.db
      .prepare(
        `UPDATE actions SET status = ?, result = ?, undo = ?, updated_at = ?,
           idem_key = CASE WHEN ? = 'failed' THEN NULL ELSE idem_key END
         WHERE id = ?`
      )
      .run(status, JSON.stringify(result), undo === null || undo === undefined ? null : JSON.stringify(undo), Date.now(), status, id)
  }

  markUndone(id: number, ok: boolean, note?: string): void {
    this.db
      .prepare('UPDATE actions SET status = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(ok ? 'undone' : 'undo_failed', note ?? null, Date.now(), id)
  }

  get(id: number): LedgerEntry | null {
    const row = this.db.prepare('SELECT * FROM actions WHERE id = ?').get(id)
    return row ? toEntry(row) : null
  }

  findByIdemKey(key: string): LedgerEntry | null {
    const row = this.db.prepare('SELECT * FROM actions WHERE idem_key = ?').get(key)
    return row ? toEntry(row) : null
  }

  recent(limit = 50): LedgerEntry[] {
    return this.db.prepare('SELECT * FROM actions ORDER BY id DESC LIMIT ?').all(limit).map(toEntry)
  }

  // Everything since a moment (newest first), for Home's counts.
  since(at: number, limit = 2000): LedgerEntry[] {
    return this.db.prepare('SELECT * FROM actions WHERE created_at >= ? ORDER BY id DESC LIMIT ?').all(at, limit).map(toEntry)
  }

  // The newest action that worked and can be reversed: what "undo that" means.
  lastUndoable(): LedgerEntry | null {
    const row = this.db
      .prepare("SELECT * FROM actions WHERE status = 'done' AND undo IS NOT NULL ORDER BY id DESC LIMIT 1")
      .get()
    return row ? toEntry(row) : null
  }

  // At startup: anything still 'pending' was running when the app stopped (crash, power cut, kill).
  // We can't know whether it happened, so say so honestly instead of pretending either way.
  recoverInterrupted(): LedgerEntry[] {
    const stuck = this.db.prepare("SELECT * FROM actions WHERE status = 'pending'").all().map(toEntry)
    this.db
      .prepare("UPDATE actions SET status = 'interrupted', note = 'the app stopped while this was running', updated_at = ? WHERE status = 'pending'")
      .run(Date.now())
    return stuck
  }

  // "Clear history" (Settings): copy the whole log to `backupFile` first, then empty it. Returns how many
  // actions were removed.
  clearAll(backupFile: string): number {
    this.db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`)
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM actions').get() as { n: number }).n
    this.db.exec('DELETE FROM actions')
    return n
  }

  close(): void {
    this.db.close()
  }
}

function toEntry(row: unknown): LedgerEntry {
  const r = row as Record<string, string | number | null>
  const json = (v: string | number | null): unknown => (typeof v === 'string' ? JSON.parse(v) : null)
  return {
    id: Number(r.id),
    callId: String(r.call_id),
    tool: String(r.tool),
    args: (json(r.args) ?? {}) as Record<string, unknown>,
    risk: String(r.risk),
    description: String(r.description),
    source: r.source as ActionSource,
    status: r.status as ActionStatus,
    result: json(r.result) as Record<string, unknown> | null,
    undo: json(r.undo),
    note: r.note === null ? null : String(r.note),
    idemKey: r.idem_key === null ? null : String(r.idem_key),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  }
}
