// PHONE LINK: keeps the phone connected and knows its status (battery, Wi-Fi, screen, what's open).
//
// - Finds the phone by itself: an adb "device" (USB or already-connected Wi-Fi); if none, phones that
//   announce wireless debugging on this network (mDNS), which we connect to. The port changes every
//   time wireless debugging is switched on, so a saved address would go stale; discovery doesn't.
// - Checks every 30 s, in ONE adb call (one small program run). Pushes status only when it changes.

import type { PhoneStatus } from '../../shared/ipc'
import { adb, shell } from './adb'
import { parseBattery, parseDevices, parseForeground, parseMdns, parseScreenOn } from './parse'

const POLL_MS = 30_000
const SEP = '=====DW====='

export class PhoneLink {
  private serial: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private status: PhoneStatus = { state: 'searching' }
  private last = ''
  private busy = false
  private readonly onStatus: (status: PhoneStatus) => void

  constructor(onStatus: (status: PhoneStatus) => void) {
    this.onStatus = onStatus
  }

  get current(): PhoneStatus {
    return this.status
  }

  start(): void {
    void this.refresh()
    this.timer ??= setInterval(() => void this.refresh(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // For the tools: the connected phone's serial, or a readable error.
  async device(): Promise<string> {
    if (this.status.state !== 'connected' || !this.serial) await this.refresh()
    if (this.serial && this.status.state === 'connected') return this.serial
    throw new Error(explain(this.status))
  }

  async refresh(): Promise<PhoneStatus> {
    if (this.busy) return this.status
    this.busy = true
    try {
      this.set(await this.check())
    } catch (err) {
      this.serial = null
      this.set({ state: 'error', detail: err instanceof Error ? err.message : String(err) })
    } finally {
      this.busy = false
    }
    return this.status
  }

  private async check(): Promise<PhoneStatus> {
    let list = await this.devices()
    if (list === null) return { state: 'no-adb' }
    if (!list.some((d) => d.state === 'device')) {
      // Nothing connected: try phones announcing wireless debugging on this Wi-Fi.
      const mdns = await adb(['mdns', 'services'], { timeoutMs: 8000 })
      for (const addr of parseMdns(mdns.stdout)) await adb(['connect', addr], { timeoutMs: 8000 })
      list = (await this.devices()) ?? []
    }
    const ready = list.find((d) => d.state === 'device')
    if (!ready) {
      this.serial = null
      if (list.some((d) => d.state === 'unauthorized')) return { state: 'unauthorized' }
      return { state: 'none' }
    }
    this.serial = ready.serial
    const out = await shell(
      ready.serial,
      [
        'dumpsys battery',
        `echo ${SEP}`,
        'cmd wifi status 2>/dev/null | head -1',
        `echo ${SEP}`,
        "dumpsys power | grep -m1 'mWakefulness='",
        `echo ${SEP}`,
        "dumpsys activity activities | grep -m1 'ResumedActivity'",
        `echo ${SEP}`,
        'getprop ro.build.version.release'
      ].join('; '),
      { timeoutMs: 12_000 }
    )
    const [battery, wifi, power, activity, version] = out.split(SEP)
    const b = parseBattery(battery ?? '')
    return {
      state: 'connected',
      model: titleCase(ready.model) || 'Android phone',
      android: (version ?? '').trim(),
      battery: b.level,
      charging: b.charging,
      wifi: /enabled/i.test(wifi ?? ''),
      screenOn: parseScreenOn(power ?? ''),
      foreground: parseForeground(activity ?? ''),
      via: ready.serial.includes('._adb-tls-connect.') || /:\d+$/.test(ready.serial) ? 'wifi' : 'usb'
    }
  }

  // null = adb itself couldn't run.
  private async devices() {
    const r = await adb(['devices', '-l'], { timeoutMs: 10_000 })
    if (r.error) return null
    return parseDevices(r.stdout)
  }

  private set(status: PhoneStatus): void {
    this.status = status
    const json = JSON.stringify(status)
    if (json === this.last) return
    this.last = json
    console.log(`[phone] ${status.state}${status.state === 'connected' ? `: ${status.model}, Android ${status.android}, ${status.battery ?? '?'}%, via ${status.via}` : status.detail ? `: ${status.detail}` : ''}`)
    this.onStatus(status)
  }
}

export function explain(s: PhoneStatus): string {
  switch (s.state) {
    case 'no-adb':
      return 'adb is missing on this computer (run npm run tools).'
    case 'unauthorized':
      return 'The phone is asking "Allow USB debugging?": tap Allow on the phone.'
    case 'none':
    case 'searching':
      return "No phone is connected. Turn on wireless debugging on the phone (same Wi-Fi as this PC), or plug it in with USB."
    case 'error':
      return `Couldn't reach the phone: ${s.detail ?? 'unknown error'}`
    default:
      return 'The phone is connected.'
  }
}

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase())
