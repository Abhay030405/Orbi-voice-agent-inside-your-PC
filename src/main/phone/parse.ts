// Reading what adb prints. Pure (no adb, no Electron): unit-tested in parse.test.ts against output
// captured from a real phone (Motorola Signature, Android 16), with private values replaced.

export interface AdbDevice {
  serial: string
  state: string // "device" = connected and allowed; "unauthorized" = waiting for "Allow" on the phone
  model: string
}

// `adb devices -l`
export function parseDevices(out: string): AdbDevice[] {
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state] = l.split(/\s+/)
      const model = /model:(\S+)/.exec(l)?.[1]?.replace(/_/g, ' ') ?? ''
      return { serial, state, model }
    })
    .filter((d) => d.serial && d.state)
}

// `adb mdns services`: phones that announce wireless debugging on this network.
export function parseMdns(out: string): string[] {
  const found: string[] = []
  for (const l of out.split(/\r?\n/)) {
    if (!l.includes('_adb-tls-connect._tcp')) continue
    const addr = /(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})/.exec(l)?.[1]
    if (addr && !found.includes(addr)) found.push(addr)
  }
  return found
}

export interface Battery {
  level: number | null
  charging: boolean
}

// `dumpsys battery`: "level: 77", "status: 2" (2 = charging, 5 = full).
export function parseBattery(out: string): Battery {
  const level = /^\s*level:\s*(\d+)/m.exec(out)
  const status = /^\s*status:\s*(\d+)/m.exec(out)
  const plugged = /(AC|USB|Wireless) powered:\s*true/.test(out)
  return { level: level ? Number(level[1]) : null, charging: plugged || status?.[1] === '2' || status?.[1] === '5' }
}

// `dumpsys activity activities`: "ResumedActivity: ActivityRecord{… u0 com.android.settings/.Foo t303}"
export function parseForeground(out: string): string | null {
  return /ResumedActivity:?\s*ActivityRecord\{\S+ \S+ ([A-Za-z0-9._]+)\//.exec(out)?.[1] ?? null
}

// `dumpsys power`: "mWakefulness=Awake" (screen on) / "Asleep" / "Dozing" (screen off).
export function parseScreenOn(out: string): boolean | null {
  const m = /mWakefulness=(\w+)/.exec(out)
  return m ? m[1] === 'Awake' : null
}

export interface PhoneNotification {
  app: string // package name
  title: string
  text: string
}

// `dumpsys notification --noredact`. Each record starts with "NotificationRecord(… pkg=<package>",
// then its extras: "android.title=String (Hello)". A record can carry a public version first with
// "=null" values, so we keep the first real value of each.
export function parseNotifications(out: string, max = 15): PhoneNotification[] {
  const list: PhoneNotification[] = []
  let current: PhoneNotification | null = null
  const value = (line: string): string | null => {
    const m = /=\s*\w+ \((.*)\)\s*$/.exec(line)
    return m ? m[1].trim() : null
  }
  for (const line of out.split(/\r?\n/)) {
    const rec = /NotificationRecord\([^ ]+ pkg=([A-Za-z0-9._]+)/.exec(line)
    if (rec) {
      current = { app: rec[1], title: '', text: '' }
      list.push(current)
      continue
    }
    if (!current) continue
    const t = line.trim()
    if (t.startsWith('android.title=') && !current.title) current.title = value(t) ?? ''
    else if (t.startsWith('android.bigText=')) current.text = value(t) ?? current.text
    else if (t.startsWith('android.text=') && !current.text) current.text = value(t) ?? ''
  }
  // Drop Android's own system entries and empty ones ("USB debugging connected" etc.).
  return list.filter((n) => n.app !== 'android' && (n.title || n.text)).slice(0, max)
}

export interface Contact {
  name: string
  number: string
}

// `content query --uri content://com.android.contacts/data/phones --projection display_name:data1`
// "Row: 0 display_name=Rahul Sharma, data1=+91 98…"
export function parseContacts(out: string): Contact[] {
  const list: Contact[] = []
  for (const l of out.split(/\r?\n/)) {
    const m = /display_name=(.*?), data1=(.*)$/.exec(l.trim())
    if (m && m[2].trim()) list.push({ name: m[1].trim(), number: m[2].trim() })
  }
  return list
}

// Best contact match for a spoken name: exact, then starts-with, then contains (case-insensitive).
// Same name twice with the same number counts once.
// Edit distance (Levenshtein): the fewest single-character insert/delete/replace steps from a to b.
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// 0..1 similarity of a spoken name to a contact, best over the whole name AND each word — so "abhey"
// still finds "Abhay Agarwal" and "rahil" finds "Rahul Sharma" when speech-to-text slips a letter.
export function nameScore(name: string, q: string): number {
  const nn = normName(name)
  const nq = normName(q)
  if (!nn || !nq) return 0
  let best = 0
  for (const part of [nn, ...nn.split(' ')]) {
    if (part) best = Math.max(best, 1 - editDistance(part, nq) / Math.max(part.length, nq.length))
  }
  return best
}

export function findContacts(all: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const unique = (list: Contact[]) => list.filter((c, i) => list.findIndex((d) => d.name === c.name && digits(d.number) === digits(c.number)) === i)
  const exact = all.filter((c) => c.name.toLowerCase() === q)
  if (exact.length) return unique(exact)
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(q))
  if (starts.length) return unique(starts)
  const has = all.filter((c) => c.name.toLowerCase().includes(q))
  if (has.length) return unique(has)
  // Fuzzy fallback: the name was misheard. Keep close matches (≥ 0.7), best first. The caller already
  // handles "several names match" by asking which — fuzzy just widens what counts as a match.
  const scored = all
    .map((c) => ({ c, s: nameScore(c.name, q) }))
    .filter((x) => x.s >= 0.7)
    .sort((a, b) => b.s - a.s)
  return unique(scored.map((x) => x.c))
}

export const digits = (n: string): string => n.replace(/[^\d+]/g, '')

// A phone number we're willing to dial or text: digits, an optional leading +, 3-15 digits.
export function cleanNumber(n: string): string | null {
  const d = digits(n)
  return /^\+?\d{3,15}$/.test(d) ? d : null
}

// Quote ONE value for the phone's shell (adb sends `adb shell …` to the phone as a command line, which
// /system/bin/sh parses again). Single quotes make everything literal; a ' inside becomes '\''.
// Without this, a message like  hi; rm -rf /sdcard  would run as a command ON THE PHONE.
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// For `input text`: it can't type spaces (they become %s) or non-ASCII; refuse those instead of
// typing something different from what was asked.
export function inputText(text: string): string {
  if (!/^[\x20-\x7E]*$/.test(text)) throw new Error('The phone can only type plain English letters, digits and symbols this way.')
  return text.replace(/%/g, '\\%').replace(/ /g, '%s')
}

// Find the app for a spoken name among the phone's launchable packages.
const KNOWN: Record<string, string> = {
  whatsapp: 'com.whatsapp',
  youtube: 'com.google.android.youtube',
  'youtube music': 'com.google.android.apps.youtube.music',
  chrome: 'com.android.chrome',
  gmail: 'com.google.android.gm',
  maps: 'com.google.android.apps.maps',
  'google maps': 'com.google.android.apps.maps',
  camera: 'com.motorola.camera3',
  photos: 'com.google.android.apps.photos',
  settings: 'com.android.settings',
  'play store': 'com.android.vending',
  messages: 'com.google.android.apps.messaging',
  phone: 'com.google.android.dialer',
  contacts: 'com.google.android.contacts',
  calendar: 'com.google.android.calendar',
  clock: 'com.google.android.deskclock',
  calculator: 'com.google.android.calculator',
  instagram: 'com.instagram.android',
  spotify: 'com.spotify.music',
  telegram: 'org.telegram.messenger',
  snapchat: 'com.snapchat.android',
  netflix: 'com.netflix.mediaclient',
  discord: 'com.discord',
  linkedin: 'com.linkedin.android',
  x: 'com.twitter.android',
  twitter: 'com.twitter.android',
  files: 'com.google.android.documentsui'
}
export function findApp(packages: string[], name: string): string[] {
  const q = name.trim().toLowerCase()
  const known = KNOWN[q]
  if (known && packages.includes(known)) return [known]
  const words = q.split(/\s+/).filter((w) => w.length > 1)
  if (words.length === 0) return []
  const hits = packages.filter((p) => words.every((w) => p.toLowerCase().includes(w)))
  // Prefer the shortest names (com.spotify.music over com.spotify.music.extension).
  return hits.sort((a, b) => a.length - b.length).slice(0, 5)
}

// `cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`
// prints "package/activity" lines; we want the packages.
export function parseLaunchable(out: string): string[] {
  const set = new Set<string>()
  for (const l of out.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9._]+)\/\S+/.exec(l)
    if (m) set.add(m[1])
  }
  return [...set]
}
