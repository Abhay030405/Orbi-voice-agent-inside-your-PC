// Clipboard tools. Reading it brings in OUTSIDE text (anything copied from a web page, chat, email),
// so it switches on caution mode. Writing remembers the old text, so "undo that" puts it back.
// (In Electron 44 the clipboard calls are asynchronous.)

import { clipboard } from 'electron'
import type { Tool } from './tool'

const MAX = 20_000

export const readClipboard: Tool = {
  name: 'read_clipboard',
  description: 'Read the text currently on the clipboard (what the user last copied).',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true,
  async run() {
    const text = await clipboard.readText()
    if (!text) return { ok: true, text: '', note: 'The clipboard has no text.' }
    return { ok: true, text: text.slice(0, MAX), truncated: text.length > MAX }
  }
}

export const writeClipboard: Tool = {
  name: 'write_clipboard',
  description: 'Put text on the clipboard so the user can paste it.',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  risk: 'low',
  effect: 'write',
  describe: (args) => `Copy to the clipboard: "${String(args.text).slice(0, 80)}"`,
  async run(args) {
    if (typeof args.text !== 'string') return { ok: false, error: 'text must be a string' }
    if (args.text.length > MAX) return { ok: false, error: `That's too long for the clipboard tool (max ${MAX} characters).` }
    const previous = await clipboard.readText()
    await clipboard.writeText(args.text)
    // Verify (PS A3): read it back.
    if ((await clipboard.readText()) !== args.text) return { ok: false, error: 'The clipboard did not accept the text.' }
    return { result: { ok: true, copied: args.text.length, verified: true }, undo: { previous } }
  },
  async undo(undoData) {
    const { previous } = undoData as { previous: string }
    await clipboard.writeText(previous)
    return { ok: true, restored: 'the previous clipboard text' }
  }
}

export const CLIPBOARD_TOOLS: Tool[] = [readClipboard, writeClipboard]
