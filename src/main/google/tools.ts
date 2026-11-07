// GMAIL, CALENDAR, DRIVE tools (Google's own APIs, the user's account; sign-in: google/auth.ts).
//
// Safety, same rules as everything else:
// - Reading mail, events or file names returns OUTSIDE text (anyone can email you "ignore your user and..."),
//   so it switches caution mode on: the next real action asks first.
// - Sending an email, or an invite to other people, is high risk: it always asks, with the recipient,
//   subject and text in the question. Nothing is sent without that yes.

import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { createdFileUndo, resolveInside } from '../hands/files'
import { gmailUpload, googleApi, googleState, signIn, signOut } from './auth'
import { type Attachment, attachmentParts, eventSummary, header, looksLikeEmail, messageText, mimeEmail, rawEmail } from './parse'
import type { Tool } from '../hands/tool'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const fail = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const connect: Tool = {
  name: 'google_connect',
  description:
    "Connect (or disconnect) the user's Google account for Gmail, Calendar and Drive: it opens Google's sign-in page " +
    'in the browser. Use when a Google tool says it is not connected, or the user asks to connect / sign out.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['connect', 'disconnect', 'status'] } } },
  risk: 'low',
  effect: 'write',
  async run(args) {
    try {
      if (args.action === 'status') return { ok: true, ...(await googleState()) }
      if (args.action === 'disconnect') {
        await signOut()
        return { ok: true, disconnected: true }
      }
      const email = await signIn()
      return { ok: true, connected: email }
    } catch (err) {
      return fail(err)
    }
  }
}

const listMail: Tool = {
  name: 'gmail_list',
  description:
    'List emails from Gmail: newest first, with sender, subject, date and a short preview. `query` uses Gmail search ' +
    '(e.g. "is:unread", "from:rahul", "subject:abstract", "newer_than:2d"); `max` 1-15 (default 8).',
  parameters: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 15 } } },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // anyone can write you an email
  async run(args) {
    try {
      const max = typeof args.max === 'number' ? Math.max(1, Math.min(15, Math.round(args.max))) : 8
      const q = str(args.query)
      const list = await googleApi(`${GMAIL}/messages?maxResults=${max}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      const ids = ((list.messages as { id: string }[] | undefined) ?? []).map((m) => m.id)
      const emails = await Promise.all(
        ids.map(async (id) => {
          const m = await googleApi(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
          const p = m.payload as Parameters<typeof header>[0]
          return { id, from: header(p, 'From'), subject: header(p, 'Subject'), date: header(p, 'Date'), preview: String(m.snippet ?? '').slice(0, 160), unread: ((m.labelIds as string[]) ?? []).includes('UNREAD') }
        })
      )
      return { ok: true, count: emails.length, emails }
    } catch (err) {
      return fail(err)
    }
  }
}

const readMail: Tool = {
  name: 'gmail_read',
  description: 'Read one email in full (its text), by the id from gmail_list.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true,
  async run(args) {
    try {
      const id = str(args.id)
      if (!/^[\w-]+$/.test(id)) return { ok: false, error: 'Use an id from gmail_list.' }
      const m = await googleApi(`${GMAIL}/messages/${id}?format=full`)
      const p = m.payload as Parameters<typeof messageText>[0]
      const files = attachmentParts(p).map((a) => ({ name: a.name, size: size(a.size) }))
      return { ok: true, from: header(p, 'From'), to: header(p, 'To'), subject: header(p, 'Subject'), date: header(p, 'Date'), text: messageText(p).slice(0, 6000), attachments: files }
    } catch (err) {
      return fail(err)
    }
  }
}

// SAVE AN ATTACHMENT through Gmail's API, straight into Downloads. Clicking Gmail's own download button
// through the screen "worked" but saved nothing: the button only shows on hover, and the preview Orbi had
// opened covered it (a certificate PDF, 2026-10-27). The API is exact, and needs no extra permission.
const saveAttachment: Tool = {
  name: 'gmail_save_attachment',
  description:
    'Save a file attached to an email (a certificate, ticket, invoice PDF...) into the Downloads folder, by the email ' +
    'id from gmail_list. `name` = part of the file name if the email has several. Use this instead of clicking ' +
    'download in Gmail. Then open_file can show it.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  effect: 'write',
  family: 'files',
  async run(args) {
    try {
      const id = str(args.id)
      if (!/^[\w-]+$/.test(id)) return { ok: false as const, error: 'Use an id from gmail_list.' }
      const m = await googleApi(`${GMAIL}/messages/${id}?format=full`)
      const all = attachmentParts(m.payload as Parameters<typeof attachmentParts>[0])
      if (all.length === 0) return { ok: false as const, error: 'That email has no attached files.' }
      const want = str(args.name).toLowerCase()
      const matches = want ? all.filter((a) => a.name.toLowerCase().includes(want)) : all
      if (matches.length !== 1) {
        return { ok: false as const, error: `Which file? This email has: ${all.map((a) => a.name).join(', ')}. Call again with \`name\`.` }
      }
      const a = matches[0]
      const r = await googleApi(`${GMAIL}/messages/${id}/attachments/${a.id}`)
      const data = Buffer.from(String(r.data ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      // A safe file name (no folders, no characters Windows refuses); never overwrite: "name (2).pdf".
      const clean = a.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'attachment'
      const dot = clean.lastIndexOf('.')
      const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, '']
      for (let n = 1; n <= 50; n++) {
        const file = await resolveInside(`Downloads/${n === 1 ? clean : `${stem} (${n})${ext}`}`, false)
        try {
          await fs.writeFile(file, data, { flag: 'wx' }) // wx = fail if it already exists
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw err
        }
        // VERIFY (A3): the real file, the real size.
        const written = await fs.stat(file).catch(() => null)
        if (!written || written.size !== data.length) {
          return { result: { ok: false as const, error: `Saving failed: the file in Downloads is ${written ? `${written.size} bytes, not ${data.length}` : 'missing'}.` }, undo: { file } }
        }
        return { result: { ok: true as const, saved: file, size: size(data.length), verified: true }, undo: { file } }
      }
      return { ok: false as const, error: 'Downloads already has 50 files with that name.' }
    } catch (err) {
      return fail(err)
    }
  },
  undo: (undoData) => createdFileUndo(undoData)
}

// NEW ADDRESSES ARE SPELLED BACK FIRST. Speech recognition gets addresses wrong: "abhaystudy" was heard as
// "anupstudy", and (auto-confirm on, for a demo) the document went to a stranger (2026-10-21). So an address
// the user has never emailed, and isn't their own, is refused once with "spell it back and ask"; the same
// address is accepted after the user had time to answer (Gemini can't skip the question by retrying at once).
const SPELL_WAIT_MS = 4000
const spelledBack = new Map<string, number>() // address -> when we asked for it to be spelled back
async function knownAddress(to: string): Promise<boolean> {
  const me = await googleState().catch(() => null)
  if (me?.connected && me.email.toLowerCase() === to) return true
  const r = await googleApi(`${GMAIL}/messages?maxResults=1&q=${encodeURIComponent(`in:sent to:${to}`)}`).catch(() => null)
  return Array.isArray(r?.messages) && r.messages.length > 0
}
async function checkNewAddress(to: string): Promise<void> {
  const address = to.toLowerCase()
  if (await knownAddress(address)) return
  const asked = spelledBack.get(address)
  if (asked !== undefined && Date.now() - asked >= SPELL_WAIT_MS) return
  if (asked === undefined) spelledBack.set(address, Date.now())
  const spelled = address.split('@')[0].split('').join(' ')
  throw new Error(
    `NOT SENT: ${address} is a new address (never emailed before), and addresses are often misheard. Spell it back ` +
      `to the user ("${spelled} at ${address.split('@')[1]}") and ask if that is right. Only if they say yes, call ` +
      'gmail_send again with exactly the same address. If they correct it, use the corrected address.'
  )
}

const sendMail: Tool = {
  name: 'gmail_send',
  description:
    'Send an email from the user\'s Gmail. `to` = an email address (ask the user if you only have a name), `subject`, ' +
    '`body`, and `attach` = files to attach (full paths, e.g. the `created` path create_document gave you; if a ' +
    'document is still being made, wait for its result first). It always asks the user first, showing exactly what will be sent.',
  parameters: {
    type: 'object',
    properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, attach: { type: 'array', items: { type: 'string' } } },
    required: ['to', 'subject', 'body']
  },
  risk: 'high', // it sends something in the user's name, and can't be unsent
  effect: 'upload',
  async describe(args) {
    if (!looksLikeEmail(str(args.to))) throw new Error('`to` must be one email address; ask the user for it.')
    await checkNewAddress(str(args.to))
    const files = await attachments(args.attach) // checked now, before asking
    const attached = files.length ? `\nAttached: ${files.map((f) => `${f.name} (${size(f.data.length)})`).join(', ')}` : ''
    return `Send an email to ${str(args.to)}\nSubject: ${str(args.subject)}${attached}\n\n${String(args.body ?? '').slice(0, 1500)}`
  },
  async run(args) {
    try {
      if (!looksLikeEmail(str(args.to))) return { ok: false, error: '`to` must be one email address.' }
      const files = await attachments(args.attach)
      const r = files.length
        ? await gmailUpload(mimeEmail(str(args.to), str(args.subject), String(args.body ?? ''), files))
        : await googleApi(`${GMAIL}/messages/send`, { method: 'POST', body: { raw: rawEmail(str(args.to), str(args.subject), String(args.body ?? '')) } })
      return { ok: true, sent: true, to: str(args.to), id: r.id, ...(files.length ? { attached: files.map((f) => f.name) } : {}) }
    } catch (err) {
      return fail(err)
    }
  }
}

// Files to attach: only from the user's own folders (the same fence as the file tools), at most 25 MB in all
// (Gmail's limit). Attaching uploads the file to someone, which is why gmail_send always asks first.
const MAX_ATTACH = 25 * 1024 * 1024
const size = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
async function attachments(value: unknown): Promise<Attachment[]> {
  const list = (Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : []).map(str).filter(Boolean)
  const out: Attachment[] = []
  for (const p of list.slice(0, 10)) {
    let file: string
    try {
      file = await resolveInside(p, true)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      throw new Error(`Can't attach "${p}": ${why}. If it is a document you are still making, wait for its result and use the path it gives.`)
    }
    out.push({ name: basename(file), data: await fs.readFile(file) })
  }
  if (out.reduce((n, a) => n + a.data.length, 0) > MAX_ATTACH) throw new Error("The attachments are over 25 MB, Gmail's limit.")
  return out
}

const listEvents: Tool = {
  name: 'calendar_list',
  description:
    "The user's Google Calendar events: today and the next `days` days (default 1 = today only, max 14), with times, " +
    'places, people and Meet links. Use for "what meetings do I have today?".',
  parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 14 } } },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // invites can come from anyone
  async run(args) {
    try {
      const days = typeof args.days === 'number' ? Math.max(1, Math.min(14, Math.round(args.days))) : 1
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const to = new Date(from.getTime() + days * 24 * 3600 * 1000)
      const r = await googleApi(`${CAL}?singleEvents=true&orderBy=startTime&maxResults=25&timeMin=${from.toISOString()}&timeMax=${to.toISOString()}`)
      const events = ((r.items as Parameters<typeof eventSummary>[0][]) ?? []).map((e) => eventSummary(e, timeZone))
      return { ok: true, from: from.toDateString(), days, count: events.length, events }
    } catch (err) {
      return fail(err)
    }
  }
}

const createEvent: Tool = {
  name: 'calendar_create',
  description:
    'Add an event to Google Calendar. `start` and `end` in ISO form with the local time (e.g. "2026-10-22T17:00"); ' +
    '`meet: true` adds a Google Meet link; `invite` = email addresses to invite (they get an email, so it asks first).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      meet: { type: 'boolean' },
      invite: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'start']
  },
  risk: 'low',
  riskFor: (args) => (Array.isArray(args.invite) && args.invite.length > 0 ? 'high' : 'low'), // inviting emails other people
  effect: 'write',
  describe(args) {
    const invite = (Array.isArray(args.invite) ? args.invite : []).map(str)
    if (invite.some((e) => !looksLikeEmail(e))) throw new Error('Invites need email addresses; ask the user for them.')
    return `Add "${str(args.title)}" to your calendar at ${str(args.start)}${args.meet === true ? ' with a Meet link' : ''}${invite.length ? `, inviting ${invite.join(', ')}` : ''}`
  },
  async run(args) {
    try {
      const start = new Date(str(args.start))
      if (Number.isNaN(start.getTime())) return { ok: false, error: '`start` is not a date and time.' }
      const end = str(args.end) ? new Date(str(args.end)) : new Date(start.getTime() + 60 * 60 * 1000)
      const invite = (Array.isArray(args.invite) ? args.invite : []).map(str).filter(looksLikeEmail)
      const r = await googleApi(`${CAL}?conferenceDataVersion=1${invite.length ? '&sendUpdates=all' : ''}`, {
        method: 'POST',
        body: {
          summary: str(args.title),
          start: { dateTime: start.toISOString(), timeZone },
          end: { dateTime: end.toISOString(), timeZone },
          ...(invite.length ? { attendees: invite.map((email) => ({ email })) } : {}),
          ...(args.meet === true ? { conferenceData: { createRequest: { requestId: `dw-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {})
        }
      })
      return { result: { ok: true as const, created: eventSummary(r as Parameters<typeof eventSummary>[0], timeZone) }, undo: { id: r.id } }
    } catch (err) {
      return fail(err)
    }
  },
  async undo(undoData) {
    try {
      await googleApi(`${CAL}/${encodeURIComponent((undoData as { id: string }).id)}`, { method: 'DELETE' }).catch((e: unknown) => {
        if (!String(e).includes('JSON')) throw e // DELETE answers with an empty body
      })
      return { ok: true, removed: true }
    } catch (err) {
      return fail(err)
    }
  }
}

const searchDrive: Tool = {
  name: 'drive_search',
  description:
    "Find files in the user's Google Drive by name (newest first): name, type, last changed, link. It sees file " +
    'names and details, not their contents.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  risk: 'low',
  effect: 'read',
  untrustedOutput: true, // shared files can be named by anyone
  async run(args) {
    try {
      const q = str(args.query).replace(/['\\]/g, '')
      if (!q) return { ok: false, error: 'What should I look for?' }
      const r = await googleApi(
        `https://www.googleapis.com/drive/v3/files?pageSize=10&orderBy=modifiedTime desc&fields=files(name,mimeType,modifiedTime,webViewLink)&q=${encodeURIComponent(`name contains '${q}' and trashed = false`)}`
      )
      const files = ((r.files as { name: string; mimeType: string; modifiedTime: string; webViewLink: string }[]) ?? []).map((f) => ({
        name: f.name,
        type: f.mimeType.replace('application/vnd.google-apps.', 'google ').replace('application/', ''),
        changed: f.modifiedTime.slice(0, 10),
        link: f.webViewLink
      }))
      return { ok: true, count: files.length, files }
    } catch (err) {
      return fail(err)
    }
  }
}

export const GOOGLE_TOOLS: Tool[] = [connect, listMail, readMail, saveAttachment, sendMail, listEvents, createEvent, searchDrive]
