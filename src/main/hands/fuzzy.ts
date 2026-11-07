// FUZZY MATCHING: what the user SAID vs what things are CALLED. Speech-to-text slips ("spotfy", "whats
// app", "dbms assignmnet"), and people use short names ("docker" for "Docker Desktop"). Plain matching
// first (exact, starts with, contains, and the same with spaces and symbols ignored), then fuzzball's
// WRatio (a JS port of Python's thefuzz) as the fallback, so a close miss still finds the right thing
// and a far miss still finds nothing.

import { WRatio, ratio, token_set_ratio } from 'fuzzball'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const norm = (s: string): string =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const compact = (s: string): string => norm(s).replace(/ /g, '')

// 0..100: how well `name` matches what the user said.
export function matchScore(name: string, query: string): number {
  const k = name.toLowerCase().trim()
  const q = query.toLowerCase().trim()
  if (!k || !q) return 0
  if (k === q) return 100
  if (k.startsWith(q)) return 98
  if (k.includes(q)) return 96
  const kc = compact(name)
  const qc = compact(query)
  if (!kc || !qc) return 0
  if (kc === qc) return 99
  if (kc.startsWith(qc)) return 97
  if (kc.includes(qc)) return 95
  // Fuzzy: whole-string similarity, and word-set overlap (word order and extra words don't matter much).
  const nk = norm(name)
  const nq = norm(query)
  // And word by word: "dokcer" is one slip from the word "docker" in "Docker Desktop".
  const perWord = nq.includes(' ') ? 0 : Math.max(0, ...nk.split(' ').filter((w) => w.length >= 3).map((w) => ratio(nq, w) - 3))
  return Math.min(94, Math.max(WRatio(nq, nk), token_set_ratio(nq, nk) - 5, perWord))
}

// Items ranked by how well they match, best first; only scores >= cutoff. A fuzzy-only result keeps just
// the close contenders (within `spread` of the best), so "spotfy" gives Spotify, not every app with an s.
export function fuzzyRank<T>(items: T[], query: string, key: (t: T) => string, cutoff = 75, spread = 6): T[] {
  const scored = items
    .map((t) => ({ t, s: matchScore(key(t), query) }))
    .filter((x) => x.s >= cutoff)
    .sort((a, b) => b.s - a.s || key(a.t).length - key(b.t).length)
  if (scored.length === 0) return []
  const best = scored[0].s
  const kept = best >= 95 ? scored.filter((x) => x.s >= 95) : scored.filter((x) => x.s >= best - spread)
  return kept.map((x) => x.t)
}

// FIND A FILE BY (ROUGHLY) ITS NAME (the find_files tool, files.ts): "send me the DBMS assignment". Walks the user's
// folders (not system ones, not node_modules or hidden folders), within a time and size budget, and ranks
// names with matchScore above, so a misheard or half-remembered name still finds the file.
const FIND_MAX_ENTRIES = 40_000
const FIND_MAX_MS = 5_000
const SKIP_DIR = /^(node_modules|\.git|\.venv|venv|__pycache__|\$recycle\.bin|appdata|\..*)$/i

export async function findFiles(query: string, within: string[], limit = 10): Promise<{ path: string; score: number; size: number; mtime: number }[]> {
  const started = Date.now()
  const words = query.toLowerCase().split(/\s+/)
  const extWanted = words.find((w) => /^(pdf|docx?|pptx?|xlsx?|txt|csv|jpe?g|png|mp4|mp3|zip)$/.test(w))
  const nameQuery = words.filter((w) => w !== extWanted && !['file', 'the', 'my', 'a'].includes(w)).join(' ') || query
  const found: { path: string; score: number }[] = []
  let seen = 0
  let queue = within.map((dir) => ({ dir, depth: 0 }))
  while (queue.length && seen < FIND_MAX_ENTRIES && Date.now() - started < FIND_MAX_MS) {
    const next: typeof queue = []
    for (const { dir, depth } of queue) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (++seen > FIND_MAX_ENTRIES) break
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (depth < 6 && !SKIP_DIR.test(e.name)) next.push({ dir: full, depth: depth + 1 })
          continue
        }
        if (!e.isFile()) continue
        const ext = path.extname(e.name).slice(1).toLowerCase()
        if (extWanted && !(ext === extWanted || (extWanted.startsWith(ext) && ext.length >= 3) || ext.startsWith(extWanted))) continue
        const score = matchScore(path.basename(e.name, path.extname(e.name)), nameQuery)
        if (score >= 70) found.push({ path: full, score })
      }
    }
    queue = next
  }
  found.sort((a, b) => b.score - a.score)
  const top = found.slice(0, limit * 3)
  const withStats = await Promise.all(
    top.map(async (f) => {
      const st = await fs.stat(f.path).catch(() => null)
      return { ...f, size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 }
    })
  )
  // Same score: the newest first (the one you worked on last is the one you mean).
  return withStats.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, limit)
}
