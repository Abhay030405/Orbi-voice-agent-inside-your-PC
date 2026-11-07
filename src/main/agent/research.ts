// RESEARCH AGENT: a long job ("research phones under 20,000 and make a Word document") handed to a
// background worker, so the conversation goes on while it works (Abhay's idea, 2026-10-20). It is a
// background task like any other (tasks/tasks.ts): listed on the Tasks page, cancellable by voice, and
// announced out loud when it's done.
//
// What it does, step by step (each step is one line of the task's output):
//   1. plan 3-5 Google searches for the topic          (Gemini Flash, JSON out)
//   2. run them                                        (hands/web.ts searchWeb, grounded in Google)
//   3. write the document from what came back          (Gemini Flash, JSON out: title + sections)
//   4. save it as Word / PowerPoint / text             (hands/office.ts), never overwriting
//
// Safety: it can only search and write ONE new file in the user's folders. Web pages are written by
// anyone, so their text could try to give orders; here the worst it can do is put rubbish in the
// document: the agent has no other tools, and the live assistant only sees "saved X" when it ends.

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai'
import { retryBusy } from './retry'
import { draftDocument } from './writer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { GEMINI } from '../config'
import { resolveInside } from '../hands/files'
import { kindOf, slidesFile, wordFile, type Section } from '../hands/office'
import type { RunningProgram, RunResult } from '../hands/process'
import type { Tool } from '../hands/tool'
import { searchWeb } from '../hands/web'
import type { TaskManager } from '../tasks/tasks'

let client: GoogleGenAI | null = null
const ai = (): GoogleGenAI => (client ??= new GoogleGenAI({ vertexai: true, project: GEMINI.project, location: GEMINI.searchLocation }))

interface Finding {
  query: string
  answer: string
  sources: { title: string; url: string }[]
}

async function plan(topic: string, details: string): Promise<string[]> {
  const r = await retryBusy(() => ai().models.generateContent({
    model: GEMINI.searchModel,
    contents:
      `Plan 3 to 5 Google searches to research this for a short report.\nTopic: ${topic}\n` +
      (details ? `What the user wants in it: ${details}\n` : '') +
      'Make each search specific and different (prices, comparisons, reviews, recent news...). Return the search queries.',
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
    }
  }))
  const queries = JSON.parse(r.text ?? '[]') as unknown
  return Array.isArray(queries) ? queries.filter((q): q is string => typeof q === 'string' && q.trim() !== '').slice(0, 5) : []
}

async function compose(topic: string, details: string, findings: Finding[], slides: boolean): Promise<{ title: string; sections: Section[] }> {
  const notes = findings
    .map((f, i) => `Search ${i + 1}: ${f.query}\n${f.answer}\nSources: ${f.sources.map((s) => `${s.title} <${s.url}>`).join('; ')}`)
    .join('\n\n')
  return draftDocument({ topic, details, slides, notes })
}

const asText = (title: string, sections: Section[]): string =>
  [title, '', ...sections.flatMap((s) => [s.heading ? `## ${s.heading}` : '', s.text ?? '', ...(s.bullets ?? []).map((b) => `- ${b}`), ''])].join('\n')

// The job, shaped like a running program so the task manager can run, list, cancel and announce it.
export function startResearch(topic: string, details: string, file: string): RunningProgram {
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
      say(`Planning the searches for "${topic}"`)
      const queries = await plan(topic, details)
      if (queries.length === 0) throw new Error("couldn't plan any searches")
      const findings: Finding[] = []
      for (const query of queries) {
        if (cancelled) return result(null, 'cancelled')
        say(`Searching: ${query}`)
        try {
          const found = await searchWeb(query, 8)
          if (found.answer) findings.push({ query, ...found })
        } catch (err) {
          say(`  that search failed (${err instanceof Error ? err.message.slice(0, 80) : 'error'}), going on`)
        }
      }
      if (findings.length === 0) throw new Error('every search failed')
      if (cancelled) return result(null, 'cancelled')
      const kind = kindOf(file)
      say(`Writing the ${kind === 'word' ? 'Word document' : kind === 'slides' ? 'slides' : 'document'} from ${findings.length} searches`)
      const doc = await compose(topic, details, findings, kind === 'slides')
      if (cancelled) return result(null, 'cancelled')
      const bytes =
        kind === 'word' ? await wordFile(doc.title, doc.sections) : kind === 'slides' ? await slidesFile(doc.title, doc.sections) : Buffer.from(asText(doc.title, doc.sections))
      await fs.writeFile(file, bytes, { flag: 'wx' }) // never overwrites
      say(`Saved ${file}`)
      return result(0)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      say(`Stopped: ${why}`)
      return result(1, why)
    }
  })()
  return { pid: undefined, done, cancel: () => (cancelled = true), onOutput: (listener) => listeners.push(listener) }
}

const EXT = { word: '.docx', slides: '.pptx', text: '.txt' } as const

// A free name in Documents: "Phones under 20000.docx", or "... (2).docx" if that exists.
async function freeFile(name: string, format: keyof typeof EXT): Promise<string> {
  const base = name.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Research'
  for (let n = 1; n < 50; n++) {
    const candidate = await resolveInside(`Documents/${base}${n > 1 ? ` (${n})` : ''}${EXT[format]}`, false)
    if (!(await fs.stat(candidate).then(() => true, () => false))) return candidate
  }
  throw new Error('Too many files with that name in Documents.')
}

export function researchTools(tasks: () => TaskManager): Tool[] {
  const startResearchTool: Tool = {
    name: 'start_research',
    description:
      'For LONG research jobs: research a topic with several web searches and write the result as a Word ' +
      'document, PowerPoint slides or a text file, in the BACKGROUND (the user can keep talking; it is announced ' +
      'when done, and the file lands in Documents). Use it when the user wants a document, a comparison, a list ' +
      '("research phones under 20,000 and make a Word doc of the best ones by budget") instead of many web_search calls. ' +
      '`details` = what the document should contain.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        details: { type: 'string' },
        format: { type: 'string', enum: ['word', 'slides', 'text'] },
        name: { type: 'string', description: 'file name without extension' }
      },
      required: ['topic', 'format']
    },
    risk: 'low',
    effect: 'upload', // the searches go to Google
    async describe(args) {
      const format = (['word', 'slides', 'text'] as const).find((f) => f === args.format) ?? 'word'
      const file = await freeFile(String(args.name ?? args.topic ?? ''), format)
      return `Research "${String(args.topic ?? '').slice(0, 80)}" in the background and save it as ${path.basename(file)} in Documents`
    },
    async run(args) {
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      if (!topic) return { ok: false, error: 'What should I research?' }
      const details = typeof args.details === 'string' ? args.details.trim() : ''
      const format = (['word', 'slides', 'text'] as const).find((f) => f === args.format) ?? 'word'
      // Already researching (a request split by a pause asked twice, 2026-10-20): don't start a second one.
      const running = tasks().list().find((t) => t.status === 'running' && t.title.startsWith('Research:'))
      if (running) return { ok: true, alreadyRunning: true, taskId: running.id, note: 'Research is already running in the background; it is announced when done.' }
      try {
        const file = await freeFile(typeof args.name === 'string' && args.name.trim() ? args.name : topic, format)
        const task = tasks().startJob(`Research: ${topic.slice(0, 60)}`, `research → ${path.basename(file)}`, path.dirname(file), startResearch(topic, details, file))
        return {
          ok: true,
          taskId: task.id,
          file,
          note: 'Started in the background (1-2 minutes). Tell the user they can keep talking; it is announced when the document is saved.'
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
  return [startResearchTool]
}
