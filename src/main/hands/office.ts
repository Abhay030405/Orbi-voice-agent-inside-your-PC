// WORD + POWERPOINT FILES, written directly (no clicking around in Office). "Make a Word document about X"
// by typing into Word took dozens of steps and questions in the live test (2026-10-20); a real .docx/.pptx
// written in one step is exact, and then open_file shows it in Word / PowerPoint.
//
// Libraries (MIT, disclosed in docs/disclosure.md): docx (Word), pptxgenjs (PowerPoint).
// Same rules as create_text_file: inside the user's folders only, never overwrites, checked after
// writing, and undo moves the file to Dreamwalker's trash.

import { shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Document, HeadingLevel, Packer, Paragraph } from 'docx'
import { aboutDreamwalker, agentName } from '../about'
import { draftDocument } from '../agent/writer'
import PptxGenJS from 'pptxgenjs'
import { createdFileUndo, resolveInside } from './files'
import type { Tool } from './tool'

export interface Section {
  heading?: string
  text?: string
  bullets?: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// Gemini's arguments, checked: at most 40 sections, plain strings only.
function sectionsOf(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 40).map((s) => {
    const o = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>
    return {
      heading: str(o.heading) || undefined,
      text: str(o.text) || undefined,
      bullets: Array.isArray(o.bullets) ? o.bullets.map(str).filter(Boolean).slice(0, 30) : undefined
    }
  })
}

export async function wordFile(title: string, sections: Section[]): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })]
  for (const s of sections) {
    if (s.heading) children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }))
    for (const para of (s.text ?? '').split(/\n{2,}|\n/).filter(Boolean)) children.push(new Paragraph({ text: para }))
    for (const b of s.bullets ?? []) children.push(new Paragraph({ text: b, bullet: { level: 0 } }))
  }
  // Calibri with room to breathe; the library's default (Times New Roman, no spacing) looked bare.
  return Packer.toBuffer(
    new Document({
      creator: 'Dreamwalker',
      title,
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 23 }, paragraph: { spacing: { after: 160, line: 300 } } },
          title: { run: { font: 'Calibri Light', size: 52, color: '1F3B4D' }, paragraph: { spacing: { after: 240 } } },
          heading1: { run: { font: 'Calibri', size: 30, bold: true, color: '2B7A8C' }, paragraph: { spacing: { before: 360, after: 120 } } }
        }
      },
      sections: [{ children }]
    })
  )
}

export async function slidesFile(title: string, sections: Section[]): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 × 7.5 in
  const ink = '1F2328'
  const accent = '2B7A8C'
  const first = pptx.addSlide()
  first.background = { color: 'F7F8FA' }
  first.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: accent } })
  first.addText(title, { x: 0.9, y: 2.6, w: 11.5, h: 1.6, fontSize: 40, bold: true, color: ink, fontFace: 'Segoe UI' })
  for (const s of sections) {
    const slide = pptx.addSlide()
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: accent } })
    slide.addText(s.heading ?? title, { x: 0.6, y: 0.4, w: 12, h: 0.9, fontSize: 28, bold: true, color: ink, fontFace: 'Segoe UI' })
    const body = [
      ...(s.text ? [{ text: s.text, options: { breakLine: true } }] : []),
      ...(s.bullets ?? []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } }))
    ]
    if (body.length > 0) {
      slide.addText(body, { x: 0.8, y: 1.5, w: 11.7, h: 5.4, fontSize: 18, color: ink, fontFace: 'Segoe UI', valign: 'top', paraSpaceAfter: 8 })
    }
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}

export const kindOf = (file: string): 'word' | 'slides' | null =>
  /\.docx$/i.test(file) ? 'word' : /\.pptx$/i.test(file) ? 'slides' : null

// Write it ourselves (writer.ts) when asked to (`about`), or when the given sections are too thin to be
// a real document (under ~150 words: the voice model tends to pass a few one-liners).
function needsWriting(args: Record<string, unknown>): boolean {
  if (str(args.about)) return true
  const words = sectionsOf(args.sections)
    .flatMap((s) => [s.heading ?? '', s.text ?? '', ...(s.bullets ?? [])])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
  return words < 150 && str(args.title) !== ''
}

// Never overwrite, and never fail just because the name is taken: "Dreamwalker.pptx" existed, creating
// failed, and it opened the OLD deck instead (2026-10-20). Take "Dreamwalker (2).pptx" instead.
// A bare name ("Dreamwalker.pptx") goes to Documents: it was refused once as "not a full path".
const inDocuments = (p: unknown): unknown => (typeof p === 'string' && !/[\\/]/.test(p.trim()) ? `Documents/${p.trim()}` : p)

async function freeName(file: string): Promise<string> {
  const ext = path.extname(file)
  const base = file.slice(0, file.length - ext.length)
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? file : `${base} (${n})${ext}`
    if (!(await fs.stat(candidate).then(() => true, () => false))) return candidate
  }
  throw new Error('Too many files with that name already.')
}

export const createDocument: Tool = {
  name: 'create_document',
  description:
    'Create a NEW Word document (.docx) or PowerPoint deck (.pptx). It works in the BACKGROUND (10-30 s): say you ' +
    "started it and that the user can keep talking; you'll get the result when it's saved. Pass open: true to show it. " +
    'Usually give `about` (the topic) and `details` (what it must cover): it then writes a full document itself ' +
    '(about 1-2 pages, or 6-8 slides). Give `sections` (heading, text, bullets) only when the user dictated the ' +
    'exact content. Much faster and better than typing into Word or PowerPoint. Path like ' +
    '"Documents/History of the internet.docx". Never overwrites.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      title: { type: 'string' },
      about: { type: 'string', description: 'the topic: it writes the content itself' },
      count: { type: 'integer', description: 'how many slides (PowerPoint) or sections (Word), if the user said' },
      details: { type: 'string', description: 'what the document must cover' },
      open: { type: 'boolean', description: 'open it when it is ready (the user wants to see it)' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: { heading: { type: 'string' }, text: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } }
        }
      }
    },
    required: ['path']
  },
  risk: 'low',
  effect: 'write',
  background: true, // writing takes 10-30 s: Orbi stays free meanwhile
  async describe(args) {
    const file = await freeName(await resolveInside(inDocuments(args.path), false))
    const kind = kindOf(file)
    if (!kind) throw new Error('The name must end in .docx (Word) or .pptx (PowerPoint).')
    const n = sectionsOf(args.sections).length
    const what = kind === 'word' ? 'Word document' : 'PowerPoint deck'
    return needsWriting(args)
      ? `Write a ${what} about "${str(args.about) || str(args.title)}" and save it as "${path.basename(file)}"`
      : `Create the ${what} "${path.basename(file)}" (${n} ${kind === 'word' ? 'sections' : 'slides + a title slide'})`
  },
  async run(args, ctx) {
    const progress = ctx?.progress ?? ((): void => {})
    try {
      const file = await freeName(await resolveInside(inDocuments(args.path), false))
      const kind = kindOf(file)
      if (!kind) return { ok: false, error: 'The name must end in .docx (Word) or .pptx (PowerPoint).' }
      let title = str(args.title) || path.basename(file, path.extname(file))
      let sections = sectionsOf(args.sections)
      if (needsWriting(args)) {
        const topic = str(args.about) || title
        // A document about this app itself: give the writer the real facts (it invented them before).
        const subject = `${topic} ${str(args.details)}`.toLowerCase()
        const isSelf = subject.includes('dreamwalker') || subject.includes('dream walker') || subject.includes(agentName().toLowerCase())
        const self = isSelf ? aboutDreamwalker() : undefined
        const count = typeof args.count === 'number' ? args.count : undefined
        progress(`Writing the ${kind === 'slides' ? 'slides' : 'document'} about ${topic.slice(0, 60)}`)
        const draft = await draftDocument({ topic, details: str(args.details), slides: kind === 'slides', about: self, count })
        title = str(args.title) || draft.title
        sections = draft.sections
      }
      if (sections.length === 0) return { ok: false, error: 'Nothing to put in it: give `about` (the topic) or `sections`.' }
      progress(`Saving ${path.basename(file)} (${sections.length} ${kind === 'slides' ? 'slides' : 'sections'})`)
      const bytes = kind === 'word' ? await wordFile(title, sections) : await slidesFile(title, sections)
      await fs.writeFile(file, bytes, { flag: 'wx' }) // wx = fail if it already exists
      // VERIFY (A3): the real file, not the hope.
      const written = await fs.stat(file).catch(() => null)
      if (!written || written.size !== bytes.length) {
        return { result: { ok: false as const, error: 'Wrote the document, but it is not there (or not complete).' }, undo: { file } }
      }
      // "…and open it": opened HERE, when it exists. Gemini's own open_file once ran before the file did.
      const opened = args.open === true ? (await shell.openPath(file)) === '' : false
      return { result: { ok: true as const, created: file, kind, sections: sections.length, verified: true, opened }, undo: { file } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
  undo: createdFileUndo
}
