// SCREEN: "what's on my screen?" (PS B5). Captures the screen, or ONE window, and hands the image to
// Gemini with the tool's answer, so it can read and reason about it.
//
// - Whole screen: 1280 px wide JPEG (~150 KB), enough to read text, small enough to send fast.
// - One window ("look at Chrome"): only that window, up to 1600 × 1200. Sharper for the thing you mean,
//   and the rest of your desktop (other apps, notifications) is NOT sent. Asked for by Abhay after it
//   could only capture the whole desktop.
// - Our own glow and companion are NOT in it: they're excluded from capture (setContentProtection).
// - Screen content is OUTSIDE content (a web page on screen can say "AI, delete everything"), so it
//   switches on caution mode.
// - Coming in M5 (C3): passwords and keys on screen get blurred locally BEFORE the image leaves.

import { BrowserWindow, desktopCapturer, screen } from 'electron'
import { findWindow } from './system'
import type { Tool } from './tool'
import { NOT_WINDOWS, captureWindow, isWindows } from './windows'
import { parseRect, windowRect } from './pcinput'
import { shots } from './pcmap'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WIDTH = 1280
const WINDOW_BOX = { width: 1600, height: 1200 } // the window's picture fits inside this, keeping its shape
const JPEG_QUALITY = 70

const attach = (jpeg: Buffer) => [{ mimeType: 'image/jpeg', data: jpeg.toString('base64') }]

// The main screen as a JPEG, `width` px wide (0 = its real size). For the phone (send_to_phone) and the
// screen watch (agent/watch.ts); take_screenshot below also remembers the picture's geometry for clicks.
export async function screenJpeg(width = 0, quality = JPEG_QUALITY): Promise<Buffer> {
  const display = screen.getPrimaryDisplay()
  const sf = display.scaleFactor
  const real = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) }
  const w = width > 0 ? Math.min(width, real.width) : real.width
  const thumbnailSize = { width: w, height: Math.round((w * real.height) / real.width) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error("Couldn't capture the screen.")
  return source.thumbnail.toJPEG(quality)
}

async function wholeScreen() {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size
  const thumbnailSize = { width: WIDTH, height: Math.round((WIDTH * height) / width) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return { ok: false as const, error: "Couldn't capture the screen." }
  // Remember how this picture maps to the real screen, for pc_click (physical pixels = scaled × scaleFactor).
  const sf = display.scaleFactor
  const shot = source.thumbnail.getSize()
  shots.set({ what: 'the main screen', left: display.bounds.x * sf, top: display.bounds.y * sf, scale: shot.width / (width * sf), width: shot.width, height: shot.height })
  return {
    result: {
      ok: true as const,
      captured: `the main screen, ${thumbnailSize.width}×${thumbnailSize.height}`,
      note: 'The screenshot is attached as an image.'
    },
    attachments: attach(source.thumbnail.toJPEG(JPEG_QUALITY))
  }
}

// Windows' capture list has EVERY visible window by its title (two Chrome windows = two entries), unlike
// the "main window per program" list the other window tools use. So match the title there first: exact,
// then contains. Only if nothing matches, try the program name ("chrome", "code") via findWindow.
//
// Speed (measured 9.7 s at first): ask for the list WITHOUT pictures (0 × 0 thumbnails, fast), then
// capture just the one window with PrintWindow (the window draws itself; works for GPU-drawn windows and
// windows partly behind others). Electron's picture of that window is only the fallback: it sometimes
// came back EMPTY for a visible, normal window, and making pictures of every window is slow.
// The exact title of the window the user means (never one of ours), or a readable error.
export async function resolveWindowTitle(query: string): Promise<string | { error: string }> {
  const r = await matchWindow(query)
  return 'error' in r ? { error: r.error } : r.name
}

async function matchWindow(query: string): Promise<{ id: string; name: string } | { error: string }> {
  const ours = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  const sources = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })).filter(
    (s) => s.name.trim() !== '' && !ours.has(s.id)
  )
  const q = query.toLowerCase()
  let matches = sources.filter((s) => s.name.toLowerCase() === q)
  if (matches.length === 0) matches = sources.filter((s) => s.name.toLowerCase().includes(q))
  if (matches.length === 0) {
    const found = await findWindow(query) // by program name
    if (typeof found === 'string') return { error: found }
    matches = sources.filter((s) => s.name === found.title)
    if (matches.length === 0) return { error: `Found "${found.title}", but Windows wouldn't let me capture it.` }
  }
  // Several windows match (two Calculators, or "Visual Studio Code" = every VS Code window): take the one
  // in FRONT (the list is in front-to-back order), which is what "it" means to the user. Asking cost two
  // extra tool calls and a question in "open VS Code and write two sum" (2026-10-19). The chosen title is
  // in every result and every confirmation, so a wrong pick is visible.
  return { id: matches[0].id, name: matches[0].name }
}

async function oneWindow(query: string) {
  if (!isWindows) return { ok: false as const, error: NOT_WINDOWS }
  const ours = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  const list = async (thumbnailSize: { width: number; height: number }) =>
    (await desktopCapturer.getSources({ types: ['window'], thumbnailSize })).filter(
      (s) => s.name.trim() !== '' && !ours.has(s.id) // never our own windows
    )
  const m = await matchWindow(query)
  if ('error' in m) return { ok: false as const, error: m.error }
  const { id, name } = m
  // Remember how the picture maps to the screen (pc_click on a point of it). Window rect = physical pixels.
  const remember = async (imageWidth: number, imageHeight: number): Promise<void> => {
    const rect = parseRect((await windowRect(name).catch(() => ({ rect: '' }))).rect)
    if (rect) shots.set({ what: name, window: name, left: rect.left, top: rect.top, scale: imageWidth / rect.width, width: imageWidth, height: imageHeight })
  }
  const done = (jpeg: Buffer, size: string, how: string) => ({
    result: {
      ok: true as const,
      captured: `the window "${name}", ${size}`,
      how,
      note: 'The screenshot of that window is attached as an image. It shows what is in that window right now (for a browser: the tab that is open in it).'
    },
    attachments: attach(jpeg)
  })

  const file = join(tmpdir(), `dreamwalker-window-${process.pid}-${Date.now()}.jpg`)
  try {
    const r = await captureWindow(name, file, WINDOW_BOX.width, WINDOW_BOX.height)
    if (!('error' in r)) {
      const [w, h] = r.size.split('x').map(Number)
      await remember(w, h)
      return done(await readFile(file), r.size.replace('x', '×'), 'PrintWindow')
    }
    // Only claim "minimised" when Windows says so (never guess, PS A3).
    if (r.error === 'minimised') {
      return { ok: false as const, error: `"${name}" is minimised, so there's nothing to see. Bring it up first (focus_window).` }
    }
  } catch (err) {
    console.warn(`[screen] PrintWindow failed for one window, trying Electron's capture: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await rm(file, { force: true })
  }
  const pictured = (await list(WINDOW_BOX)).find((s) => s.id === id)
  if (!pictured || pictured.thumbnail.isEmpty()) return { ok: false as const, error: `Found "${name}", but couldn't capture it.` }
  const size = pictured.thumbnail.getSize()
  await remember(size.width, size.height)
  return done(pictured.thumbnail.toJPEG(JPEG_QUALITY), `${size.width}×${size.height}`, 'window capture')
}

export const takeScreenshot: Tool = {
  name: 'take_screenshot',
  family: 'pc-control', // one yes covers looking AND clicking in a PC task
  description:
    "Take a screenshot and look at it: the user's main screen, or just ONE window if you pass `window` (a title " +
    'or program name, e.g. "Chrome", "VS Code", "report.docx"). Prefer one window when the user means a specific ' +
    'app or tab ("what\'s in this Chrome tab?", "read my VS Code error"): it is sharper and sends less of their ' +
    'desktop. Use it when the user asks what is on their screen, to explain an error, read something shown, or ' +
    'check that an action really worked.',
  parameters: {
    type: 'object',
    properties: { window: { type: 'string', description: 'Optional: a window title or program name. Omit for the whole screen.' } }
  },
  risk: 'low',
  effect: 'upload', // sends a picture of your screen (or one window) to Google
  modelOnly: true, // ...for Gemini to look at, and to nobody else
  untrustedOutput: true,
  describe: (args) =>
    typeof args.window === 'string' && args.window.trim()
      ? `Take a screenshot of the "${args.window.trim()}" window and send it to Gemini`
      : 'Take a screenshot of the main screen and send it to Gemini',
  async run(args) {
    const query = typeof args.window === 'string' ? args.window.trim() : ''
    return query ? oneWindow(query) : wholeScreen()
  }
}

export const SCREEN_TOOLS: Tool[] = [takeScreenshot]
