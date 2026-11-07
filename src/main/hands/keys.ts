// PRESS KEYS + SCREEN BRIGHTNESS. Added after Abhay's first long voice session: "can you full screen it?"
// and "turn the brightness to 50%" were both impossible (and Gemini had even offered brightness).

import { clickAt, listElements, mediaKey, pressElement } from './pcinput'
import { parseElements } from './pcmap'
import { listWindows } from './windows'
import { findWindow } from './system'
import { isHarmless, normalise, toSendKeys } from './keymap'
import type { Tool, ToolResult } from './tool'
import { NOT_WINDOWS, focusWindow, isWindows, psJson } from './windows'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// Sends to whatever window is in FRONT. If that's Dreamwalker itself (you clicked our window, then
// spoke), refuse: the keys were meant for something else.
const SEND_CS = String.raw`
using System; using System.Runtime.InteropServices;
public static class DwFront {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint Pid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
}`

function sendKeys(code: string, times: number): Promise<{ sent: boolean; frontPid: number }> {
  return psJson(
    `Add-Type -TypeDefinition @'\n${SEND_CS}\n'@
     Add-Type -AssemblyName System.Windows.Forms
     $front = [DwFront]::Pid()
     if ($front -eq [uint32]$env:DW_SELF) { [pscustomobject]@{ sent = $false; frontPid = $front } | ConvertTo-Json -Compress; return }
     for ($i = 0; $i -lt [int]$env:DW_TIMES; $i++) { [System.Windows.Forms.SendKeys]::SendWait($env:DW_CODE); Start-Sleep -Milliseconds 60 }
     [pscustomobject]@{ sent = $true; frontPid = $front } | ConvertTo-Json -Compress`,
    { code, times: String(times), self: String(process.pid) }
  )
}

export const pressKeys: Tool = {
  name: 'press_keys',
  description:
    'Press keys in a window, like the user would: "full screen it" = F11 (or "f" in a YouTube video), "pause" = ' +
    'space or "k" on YouTube, skip = right / "l", new tab = ctrl+t. Pass `window` (title or program name, e.g. ' +
    '"Chrome") to bring it to the front first; otherwise the keys go to the window in front. Keys: letters, digits, ' +
    'F1-F12, enter, esc, tab, space, backspace, delete, arrows, home, end, pageup, pagedown, with ctrl/alt/shift ' +
    '(e.g. "ctrl+shift+t"). `times` repeats it (1-10). It cannot type text or click.',
  parameters: {
    type: 'object',
    properties: {
      keys: { type: 'string', description: 'e.g. "F11", "space", "ctrl+t"' },
      window: { type: 'string' },
      times: { type: 'integer', minimum: 1, maximum: 10 }
    },
    required: ['keys']
  },
  family: 'pc-control', // a yes for a PC task covers the harmless keys too
  risk: 'high',
  // Moving, pausing, full screen can't hurt; anything else (ctrl+w, alt+f4, enter…) asks first.
  riskFor: (args) => (isHarmless(str(args.keys)) ? 'low' : 'high'),
  // Pausing a video asked "Press k?" after Orbi had read the window list (live demo, 2026-10-20).
  harmlessFor: (args) => isHarmless(str(args.keys)),
  effect: 'write',
  describe(args) {
    toSendKeys(str(args.keys)) // pre-check: refuse unknown keys before asking anyone anything
    const times = typeof args.times === 'number' && args.times > 1 ? ` ×${Math.min(10, Math.floor(args.times))}` : ''
    const where = str(args.window) ? ` in "${str(args.window)}"` : ' in the window in front'
    return `Press ${normalise(str(args.keys))}${times}${where}`
  },
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    let code: string
    try {
      code = toSendKeys(str(args.keys))
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const times = typeof args.times === 'number' ? Math.max(1, Math.min(10, Math.floor(args.times))) : 1
    let target = 'the window in front'
    if (str(args.window)) {
      const found = await findWindow(str(args.window))
      if (typeof found === 'string') return { ok: false, error: found }
      const f = await focusWindow(found.pid)
      if (!f.focused) return { ok: false, error: `Windows didn't let "${f.title}" come to the front, so I didn't press anything.` }
      target = `"${f.title}"`
    }
    const r = await sendKeys(code, times)
    if (!r.sent) {
      return { ok: false, error: "Dreamwalker's own window is in front, so I didn't press anything. Say which app the keys are for (e.g. Chrome)." }
    }
    // Keys can't be checked afterwards in general (what F11 does depends on the app): say so honestly.
    return { ok: true, pressed: normalise(str(args.keys)), times, in: target, verified: false, note: 'Sent the keys; I can\'t see what the app did with them.' }
  }
}

// ── Brightness: the laptop's own screen (Windows' WMI brightness methods). External monitors usually
// don't support it; we say so.
function getBrightness(): Promise<{ level: number }> {
  return psJson(
    `$b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
     [pscustomobject]@{ level = [int]$b.CurrentBrightness } | ConvertTo-Json -Compress`
  )
}
function setBrightness(level: number): Promise<{ level: number }> {
  return psJson(
    `$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
     Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][int]$env:DW_LEVEL } | Out-Null
     Start-Sleep -Milliseconds 400
     $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
     [pscustomobject]@{ level = [int]$b.CurrentBrightness } | ConvertTo-Json -Compress`,
    { level: String(level) }
  )
}
const NO_BRIGHTNESS = "This screen doesn't let Windows change its brightness (usually an external monitor: use its own buttons)."

export const getBrightnessTool: Tool = {
  name: 'get_brightness',
  description: "Get the laptop screen's brightness (0-100).",
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  effect: 'read',
  async run() {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    try {
      return { ok: true, ...(await getBrightness()) }
    } catch {
      return { ok: false, error: NO_BRIGHTNESS }
    }
  }
}

export const setBrightnessTool: Tool = {
  name: 'set_brightness',
  description: 'Set the laptop screen\'s brightness (0-100). "A bit brighter" = about +15.',
  parameters: { type: 'object', properties: { level: { type: 'number', minimum: 0, maximum: 100 } }, required: ['level'] },
  risk: 'low',
  effect: 'write',
  describe: (args) => `Set the screen brightness to ${Math.round(Number(args.level))}%`,
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    const level = Math.round(Number(args.level))
    if (!Number.isFinite(level) || level < 0 || level > 100) return { ok: false, error: 'Brightness must be 0-100.' }
    let before: { level: number }
    let after: { level: number }
    try {
      before = await getBrightness()
      after = await setBrightness(level)
    } catch {
      return { ok: false, error: NO_BRIGHTNESS }
    }
    // Verify (PS A3). Some screens only have steps, so allow a little difference.
    if (Math.abs(after.level - level) > 5) return { ok: false, error: `Asked for ${level}% but the screen is at ${after.level}%.` }
    return { result: { ok: true, level: after.level, verified: true }, undo: before }
  },
  async undo(undoData) {
    const before = undoData as { level: number }
    const now = await setBrightness(before.level)
    return { ok: true, restored: now }
  }
}

// Play / pause / skip whatever is playing (a YouTube tab, Spotify...), with Windows' media keys: they
// reach the player wherever it is. Pressing "k" went to the wrong window and the video kept playing
// (live demo, 2026-10-20).
// "Skip the ad": YouTube's skip button, found by its name in the browser window showing YouTube and pressed
// like any control (no mouse needed when the browser supports it). Asked for during the demo (2026-10-21).
async function skipAd(): Promise<ToolResult> {
  try {
    const windows = (await listWindows()).filter((w) => /youtube/i.test(w.title))
    if (windows.length === 0) return { ok: false, error: 'No YouTube window is open in a browser.' }
    for (const w of windows) {
      const items = parseElements((await listElements(w.title, 1500)).text, 1500)
      const seen = new Map<string, number>()
      for (const e of items) {
        const k = `${e.type}|${e.name}`
        const nth = seen.get(k) ?? 0
        seen.set(k, nth + 1)
        if (!/^skip( ad| ads)?$/i.test(e.name) || !e.enabled) continue
        const r = (await pressElement(w.title, e.type, e.name, nth)).result
        if (r === 'invoked') return { ok: true, skipped: true }
        const at = /^click:(-?\d+),(-?\d+)$/.exec(r)
        if (at && (await clickAt(Number(at[1]), Number(at[2]), false, 1)).clicked) return { ok: true, skipped: true }
      }
    }
    return { ok: true, skipped: false, note: 'There is no Skip button right now: the ad may not be skippable yet (YouTube shows it after about 5 seconds), or no ad is playing.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const mediaControl: Tool = {
  name: 'media_control',
  description:
    'Play/pause, next, previous or stop whatever music or video is playing (YouTube in a browser, Spotify, a ' +
    "video player), like the keyboard's media keys. Works whatever window is in front. Prefer it over press_keys " +
    'for pausing and playing. It cannot tell whether something was playing, so say what you did, not the result. ' +
    'skip_ad presses YouTube\'s "Skip" button on an ad (in a browser on this computer).',
  parameters: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop', 'skip_ad'] } },
    required: ['action']
  },
  risk: 'low',
  harmless: true, // nothing to lose
  effect: 'write',
  describe: (args) => `Media key: ${String(args.action ?? 'play_pause').replace('_', '/')}`,
  async run(args) {
    if (!isWindows) return { ok: false, error: NOT_WINDOWS }
    if (args.action === 'skip_ad') return skipAd()
    const action = (['play_pause', 'next', 'previous', 'stop'] as const).find((a) => a === args.action) ?? 'play_pause'
    try {
      await mediaKey(action)
      return {
        ok: true,
        pressed: action,
        // "The video is now paused" when nothing had been playing (it may have STARTED it): it can't know.
        note: 'Sent the media key (it toggles). Answer briefly, matching what the user asked: "Paused." or "Playing."'
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const KEY_TOOLS: Tool[] = [pressKeys, mediaControl, getBrightnessTool, setBrightnessTool]
