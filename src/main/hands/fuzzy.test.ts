import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { findFiles, fuzzyRank, matchScore } from './fuzzy.ts'

const APPS = [
  'Docker Desktop',
  'Spotify',
  'WhatsApp',
  'Visual Studio Code',
  'Word',
  'WordPad',
  'Microsoft Edge',
  'Google Chrome',
  'Calculator',
  'Settings',
  'Snipping Tool',
  'Steam'
]
const rank = (q: string): string[] => fuzzyRank(APPS, q, (a) => a, 78)

describe('fuzzy names (what was said vs what it is called)', () => {
  it('plain matches still win, in the old order', () => {
    assert.deepEqual(rank('docker'), ['Docker Desktop'])
    assert.equal(rank('word')[0], 'Word') // exact before "WordPad"
    assert.deepEqual(rank('chrome'), ['Google Chrome'])
  })

  it('spaces and symbols do not matter', () => {
    assert.deepEqual(rank('whats app'), ['WhatsApp'])
    assert.deepEqual(rank('what’s-app'), ['WhatsApp'])
  })

  it('misheard names still find the right app', () => {
    assert.deepEqual(rank('spotfy'), ['Spotify'])
    assert.deepEqual(rank('spottify'), ['Spotify'])
    assert.deepEqual(rank('calculater'), ['Calculator'])
    assert.deepEqual(rank('dokcer'), ['Docker Desktop'])
    assert.deepEqual(rank('settigns'), ['Settings'])
  })

  it('far misses find nothing (no wild guesses)', () => {
    assert.deepEqual(rank('photoshop'), [])
    assert.deepEqual(rank('zzzz'), [])
    assert.deepEqual(rank('x'), [])
    assert.equal(matchScore('', 'a'), 0)
    assert.equal(matchScore('a', ''), 0)
  })

  it('close contenders are all offered, so the agent can ask', () => {
    const r = rank('ste')
    assert.ok(r.includes('Steam'))
  })
})

describe('find_files: by roughly the name', () => {
  const root = mkdtempSync(join(tmpdir(), 'dw-find-'))
  const put = (rel: string, ageDays = 0): string => {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, 'x')
    const t = Date.now() / 1000 - ageDays * 86400
    utimesSync(p, t, t)
    return p
  }
  const dbms = put('College/Sem5/DBMS_Assignment_3.pdf')
  const dbmsOld = put('College/Sem4/DBMS_Assignment_3.docx', 200)
  const resume = put('Abhay Agarwal Resume 2026.pdf', 3)
  put('node_modules/dbms/DBMS_Assignment_3.pdf') // must be skipped
  put('.hidden/DBMS_Assignment_3.pdf') // must be skipped
  put('Photos/IMG_2041.jpg')
  after(() => rmSync(root, { recursive: true, force: true }))

  it('finds a misheard name, and the type narrows it', async () => {
    const hits = await findFiles('dbms assignmnet pdf', [root])
    assert.equal(hits[0]?.path, dbms)
    assert.ok(hits.every((h) => h.path.endsWith('.pdf')))
  })

  it('same score: the newest first; never inside node_modules or hidden folders', async () => {
    const hits = await findFiles('dbms assignment 3', [root])
    assert.deepEqual(hits.map((h) => h.path), [dbms, dbmsOld])
  })

  it('a word from the middle of the name is enough', async () => {
    const hits = await findFiles('my resume', [root])
    assert.equal(hits[0]?.path, resume)
  })

  it('nothing close = nothing', async () => {
    assert.deepEqual(await findFiles('quarterly tax invoice', [root]), [])
  })

  it('a folder that does not exist is just empty', async () => {
    assert.deepEqual(await findFiles('dbms', [join(root, 'nope')]), [])
  })
})
