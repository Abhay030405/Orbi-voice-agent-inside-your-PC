// System tools: time, stats, browser, apps, windows, volume.

import { shell } from 'electron'
import os from 'node:os'
import type { Tool } from './tool'
import { fuzzyRank } from './fuzzy'
import { batteryStatus, closeWindowTitled, navigateTop } from './pcinput'
import {
  NOT_WINDOWS,
  focusWindow,
  getVolume,
  isWindows,
  launchStartApp,
  listStartApps,
  listWindows,
  openInBrowser,
  setVolume,
  type VolumeState,
  type WindowInfo
} from './windows'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export const getCurrentTime: Tool = {
  name: 'get_current_time',
  description: "Get the current local date and time on the user's computer.",
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  effect: 'read',
  async run() {
    const now = new Date()
    return {
      ok: true,
      iso: now.toISOString(),
      local: now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  }
}

export const getSystemStats: Tool = {
  name: 'get_system_stats',
  description:
    'Get battery, CPU load, memory use, uptime and OS of this computer. Use for "how is my laptop doing?", ' +
    '"how much battery is left?", "how much RAM is free?".',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  effect: 'read',
  async run() {
    const mb = (b: number): number => Math.round(b / 1024 / 1024)
    // "CPU, memory and battery" got "I cannot check your battery" (live test, 2026-10-20).
    const battery = isWindows ? await batteryStatus().catch(() => null) : null
    return {
      ok: true,
      battery: battery ?? 'no battery found (a desktop, or Windows did not say)',
      cpuLoadPercent: await cpuLoad(),
      freeMemoryMB: mb(os.freemem()),
      totalMemoryMB: mb(os.totalmem()),
      uptimeMinutes: Math.round(os.uptime() / 60),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cpuCores: os.cpus().length,
      os: `${os.type()} ${os.release()}`
    }
  }
}

// Browser executables, from a FIXED list. The AI picks a key; it never supplies a program name.
const BROWSERS: Record<string, string> = { chrome: 'chrome', edge: 'msedge', firefox: 'firefox', brave: 'brave' }
// Each browser's private-window switch. "Open it in incognito" was refused before (2026-10-21).
const PRIVATE_FLAG: Record<string, string> = { chrome: '--incognito', edge: '--inprivate', firefox: '-private-window', brave: '--incognito' }

// The browser opened last, for tab: "current" ("in the same window").
let lastBrowser: { browser: string; incognito: boolean } | null = null

export const openUrl: Tool = {
  name: 'open_url',
  description:
    "Open a web page in a browser. Only https:// links are allowed. Use it when the user asks to open, show, " +
    'or go to a website. Pass browser to choose one (chrome, edge, firefox, brave); otherwise the default ' +
    'browser is used. incognito: true opens a private window (incognito / InPrivate). To search or look ' +
    'something up ("open India vs New Zealand", "search for X"), open Google: https://www.google.com/search?q=... ' +
    '(the default). Use YouTube only when the user says YouTube or video: ' +
    'https://www.youtube.com/results?search_query=... (to PLAY a YouTube video, use play_youtube). ' +
    'tab: "current" loads it in the browser window the user sees (the one you opened last), for "in the same ' +
    'window / in it / there / on this window"; otherwise it opens a new tab or window. To SEARCH YouTube in a window ' +
    'that is open, use this with https://www.youtube.com/results?search_query=... and tab: "current" (not typing).',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL starting with https://' },
      browser: { type: 'string', enum: ['default', 'chrome', 'edge', 'firefox', 'brave'] },
      incognito: { type: 'boolean', description: 'open it in a private / incognito window' },
      tab: { type: 'string', enum: ['new', 'current'] }
    },
    required: ['url']
  },
  risk: 'low',
  effect: 'write', // opens something on screen (nothing to undo: you just close the tab)
  describe: (args) =>
    `Open ${String(args.url)}${args.browser && args.browser !== 'default' ? ` in ${String(args.browser)}` : ''}`,
  async run(args) {
    // The check lives HERE, in main, where nobody can skip it (docs/build-log/01-phase0-skeleton.md).
    // The caller is the AI, and a web page it read could have told it to open something nasty.
    if (typeof args.url !== 'string') return { ok: false, error: 'url must be a string' }
    let url: URL
    try {
      url = new URL(args.url) // throws on garbage like "not a url"
    } catch {
      return { ok: false, error: `"${args.url}" is not a valid URL` }
    }
    if (url.protocol !== 'https:') {
      // file:// or a custom protocol can launch programs. That's a real Electron attack class.
      return { ok: false, error: `Only https:// links are allowed, got ${url.protocol}` }
    }

    // "In the same window": type it into the window in front of the browser used last (or the one named).
    if (args.tab === 'current' && isWindows) {
      const named = str(args.browser) && str(args.browser) !== 'default' ? str(args.browser) : ''
      const which = named || lastBrowser?.browser || 'chrome'
      const exe = BROWSERS[which]
      if (exe) {
        const r = await navigateTop(exe, url.href).catch(() => 'none')
        if (r.startsWith('ok|')) return { ok: true, opened: url.href, where: `the same ${which} window ("${r.slice(3)}")` }
      }
      // No such window: open a new one, private again if the last one was.
      args = { ...args, browser: which, incognito: args.incognito ?? (lastBrowser?.browser === which && lastBrowser.incognito) }
    }

    const incognito = args.incognito === true
    // A private window needs a named browser (the default one can't be asked for one): Chrome unless said.
    const browser = str(args.browser) && str(args.browser) !== 'default' ? str(args.browser) : incognito ? 'chrome' : 'default'
    lastBrowser = browser === 'default' ? null : { browser, incognito }
    if (browser !== 'default') {
      const exe = BROWSERS[browser]
      if (!exe) return { ok: false, error: `Unknown browser "${browser}". Choose one of: ${Object.keys(BROWSERS).join(', ')}` }
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      try {
        await openInBrowser(exe, url.href, incognito ? PRIVATE_FLAG[browser] : '')
      } catch {
        return { ok: false, error: `${browser} doesn't seem to be installed (Windows couldn't start it).` }
      }
      return { ok: true, opened: url.href, where: incognito ? `a new ${browser} private (incognito) window` : `a new ${browser} window or tab` }
    }

    await shell.openExternal(url.href)
    // Say exactly what happened, including the limits. A vague `{ ok: true }` let Gemini claim it
    // had loaded the page "in that tab" when it had really opened a new one (PS A3).
    return { ok: true, opened: url.href, where: 'a NEW tab in the default browser (existing tabs were not touched)' }
  }
}

// Match what was said to names: exact, then starts-with, then contains (also ignoring spaces: "whats app"),
// then fuzzy for misheard names ("spotfy"). Best first. See fuzzy.ts.
function bestMatches<T>(items: T[], query: string, key: (t: T) => string, cutoff = 78): T[] {
  return fuzzyRank(items, query, key, cutoff)
}

const APP_ALIASES: Record<string, string> = {
  'vs code': 'Visual Studio Code',
  vscode: 'Visual Studio Code',
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  explorer: 'File Explorer',
  files: 'File Explorer',
  cmd: 'Command Prompt',
  ppt: 'PowerPoint',
  'ms word': 'Word',
  'ms excel': 'Excel'
}

export const openApp: Tool = {
  name: 'open_app',
  description:
    'Open an installed app by name, the way the Start menu does (e.g. "Spotify", "VS Code", "Calculator", ' +
    '"WhatsApp", "Settings"). If several apps match, it tells you which; ask the user to pick.',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  risk: 'low',
  effect: 'write',
  describe: (args) => `Open the app "${str(args.name)}"`,
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    const asked = str(args.name)
    if (!asked) return { ok: false, error: 'Which app?' }
    const apps = await listStartApps()
    // What people say vs what the Start menu calls it ("VS Code" failed once, then worked as
    // "Visual Studio Code": a wasted round trip, 2026-10-19). Only used if the name itself matches nothing.
    // Order: the name as said (exact / starts / contains), then the alias, and only then a fuzzy guess.
    let name = asked
    let matches = bestMatches(apps, name, (a) => a.name, 95)
    const alias = APP_ALIASES[asked.toLowerCase()]
    if (matches.length === 0 && alias) {
      name = alias
      matches = bestMatches(apps, name, (a) => a.name, 95)
    }
    if (matches.length === 0) {
      name = asked
      matches = bestMatches(apps, name, (a) => a.name)
      if (matches.length === 1) name = matches[0].name // a fuzzy hit: say what was really opened
    }
    if (matches.length === 0) return { ok: false, error: `No installed app called "${name}" was found.` }
    const exact = matches.filter((a) => a.name.toLowerCase() === name.toLowerCase())
    const pick = exact[0] ?? (matches.length === 1 ? matches[0] : null)
    if (!pick) {
      const candidates = matches.slice(0, 6).map((a) => a.name)
      return { ok: false, error: `Several apps match "${name}" (${candidates.join(', ')}); ask the user which one.` }
    }
    const before = new Set((await listWindows()).map((w) => w.pid))
    await launchStartApp(pick.appId)
    // VERIFY (A3): wait up to 6 s for a NEW window whose title or program matches the app's name.
    // If none shows up, say so honestly instead of a confident "done".
    const words = pick.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const isThisApp = (w: WindowInfo): boolean =>
      words.some((word) => w.title.toLowerCase().includes(word) || w.process.toLowerCase().includes(word))
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const opened = (await listWindows()).find((w) => isThisApp(w) && (!before.has(w.pid) || i > 2))
      if (opened) return { ok: true, opened: pick.name, verified: true, window: opened.title }
    }
    return { ok: true, opened: pick.name, verified: false, note: "I launched it, but I couldn't see its window yet. It may still be starting, or open in the tray." }
  }
}

export const listOpenWindows: Tool = {
  name: 'list_windows',
  description: 'List the open windows (program and title). Use it to find a window before focusing or closing it.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // window titles are outside text (a web page's title, a file name...)
  async run() {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    return { ok: true, windows: await listWindows() }
  }
}

// Exported for take_screenshot's single-window mode (hands/screen.ts).
// Edge writes "Microsoft\u200b Edge" (a zero-width space) in its titles, so "Microsoft Edge" never matched.
const visible = (title: string): string => title.replace(/[\u200b-\u200f\u2060\ufeff]/g, '')

// What people call a program → its process name.
const PROCESS_NAMES: Record<string, string> = {
  word: 'winword',
  'microsoft word': 'winword',
  powerpoint: 'powerpnt',
  'microsoft powerpoint': 'powerpnt',
  excel: 'excel',
  'microsoft excel': 'excel',
  edge: 'msedge',
  'microsoft edge': 'msedge',
  paint: 'mspaint',
  'vs code': 'code',
  vscode: 'code',
  'visual studio code': 'code',
  'file explorer': 'explorer',
  calculator: 'calculatorapp'
}

export async function findWindow(query: string): Promise<WindowInfo | string> {
  const windows = await listWindows()
  const byTitle = bestMatches(windows, query, (w) => visible(w.title), 85) // stricter: a wrong window could be closed
  const processName = PROCESS_NAMES[query.trim().toLowerCase()]
  const matches =
    byTitle.length > 0
      ? byTitle
      : bestMatches(windows, processName ?? query, (w) => w.process, 95) // program names: no fuzzy guess ("teams" is not "steam")
  if (matches.length === 0) return `No open window matches "${query}".`
  const programs = new Set(matches.map((w) => w.pid))
  if (programs.size > 1 && matches[0].title.toLowerCase() !== query.toLowerCase()) {
    return `Several windows match "${query}" (${matches.slice(0, 6).map((w) => w.title).join(' | ')}); ask the user which.`
  }
  return matches[0]
}

export const focusAppWindow: Tool = {
  name: 'focus_window',
  description: 'Bring an open window to the front, by its title or program name (e.g. "Chrome", "report.docx").',
  parameters: { type: 'object', properties: { window: { type: 'string' } }, required: ['window'] },
  family: 'pc-control',
  harmless: true, // never asks: nothing to protect
  risk: 'low',
  effect: 'write',
  describe: (args) => `Bring "${str(args.window)}" to the front`,
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    const found = await findWindow(str(args.window))
    if (typeof found === 'string') return { ok: false, error: found }
    const r = await focusWindow(found.pid)
    // Verified, not assumed (PS A3): Windows sometimes refuses to switch, and we say so.
    return r.focused
      ? { ok: true, focused: r.title, verified: true }
      : { ok: false, error: `Windows didn't let "${r.title}" come to the front. The user may need to click it.` }
  }
}

// The exact titles of the windows close_app was asked to close. Throws if one can't be found.
async function closeTargets(args: Record<string, unknown>): Promise<string[]> {
  const asked = [...(Array.isArray(args.windows) ? args.windows : []), args.window].map(str).filter(Boolean).slice(0, 10)
  if (asked.length === 0) throw new Error('Which window?')
  const titles: string[] = []
  for (const q of asked) {
    const found = await findWindow(q)
    if (typeof found === 'string') throw new Error(found)
    if (!titles.includes(found.title)) titles.push(found.title)
  }
  return titles
}

export const closeApp: Tool = {
  name: 'close_app',
  description:
    'Close open windows, the polite way (like clicking their X): a program can still ask to save. By title or ' +
    'program name ("Word", "Edge", "Settings"). Several at once: `windows` = a list (one question for all). ' +
    'It never force-kills.',
  parameters: {
    type: 'object',
    properties: { window: { type: 'string' }, windows: { type: 'array', items: { type: 'string' } } }
  },
  risk: 'high', // unsaved work could be lost if the program doesn't ask
  effect: 'write',
  // The question names each EXACT window: "Close PowerPoint" once matched the user's own ch11.ppt.
  async describe(args) {
    const titles = await closeTargets(args)
    return titles.length === 1
      ? `Close "${titles[0]}" (unsaved work in it could be lost)`
      : `Close these ${titles.length} windows (unsaved work in them could be lost):\n${titles.join('\n')}`
  },
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    try {
      const titles = await closeTargets(args)
      const results: Record<string, string> = {}
      for (const title of titles) results[title] = await closeWindowTitled(title)
      const stuck = titles.filter((t) => results[t] === 'still open')
      return stuck.length === 0
        ? { ok: true, closed: titles, verified: true }
        : {
            ok: false,
            error: `${stuck.map((t) => `"${t}"`).join(', ')} didn't close; it may be asking to save, or it ignored the request.`,
            closed: titles.filter((t) => results[t] !== 'still open')
          }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const getVolumeTool: Tool = {
  name: 'get_volume',
  description: 'Get the system volume (0-100) and whether it is muted.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  effect: 'read',
  async run() {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    return { ok: true, ...(await getVolume()) }
  }
}

export const setVolumeTool: Tool = {
  name: 'set_volume',
  description: 'Set the system volume (0-100) and/or mute or unmute. "Turn it up a bit" = about +15.',
  parameters: {
    type: 'object',
    properties: { level: { type: 'number', minimum: 0, maximum: 100 }, muted: { type: 'boolean' } }
  },
  risk: 'low',
  effect: 'write',
  describe: (args) =>
    [
      typeof args.level === 'number' ? `Set the volume to ${Math.round(args.level)}` : '',
      typeof args.muted === 'boolean' ? (args.muted ? 'mute' : 'unmute') : ''
    ]
      .filter(Boolean)
      .join(' and ') || 'Change the volume',
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    const level = typeof args.level === 'number' ? Math.round(args.level) : undefined
    const muted = typeof args.muted === 'boolean' ? args.muted : undefined
    if (level === undefined && muted === undefined) return { ok: false, error: 'Give a level (0-100) or muted (true/false).' }
    if (level !== undefined && (level < 0 || level > 100)) return { ok: false, error: 'Volume must be 0-100.' }
    const before = await getVolume()
    const after = await setVolume({ level, muted })
    // Verify the real result (PS A3), and remember the old state so "undo that" can restore it.
    if (level !== undefined && Math.abs(after.level - level) > 1) {
      return { ok: false, error: `Asked for ${level} but the volume is ${after.level}.` }
    }
    return { result: { ok: true, ...after, verified: true }, undo: before }
  },
  async undo(undoData) {
    const before = undoData as VolumeState
    const now = await setVolume({ level: before.level, muted: before.muted })
    return { ok: true, restored: now }
  }
}

export const SYSTEM_TOOLS: Tool[] = [
  getCurrentTime,
  getSystemStats,
  openUrl,
  openApp,
  listOpenWindows,
  focusAppWindow,
  closeApp,
  getVolumeTool,
  setVolumeTool
]

// Whole-machine CPU use over a short sample (os.cpus() gives time spent per mode since boot).
async function cpuLoad(sampleMs = 400): Promise<number> {
  const snap = () => os.cpus().reduce((a, c) => {
    const t = c.times
    a.idle += t.idle
    a.total += t.user + t.nice + t.sys + t.irq + t.idle
    return a
  }, { idle: 0, total: 0 })
  const a = snap()
  await new Promise((r) => setTimeout(r, sampleMs))
  const b = snap()
  const total = b.total - a.total
  return total > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / total)) : 0
}
