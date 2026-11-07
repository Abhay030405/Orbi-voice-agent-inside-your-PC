// Turning Google's API answers into plain, short facts for Gemini (and an email to send into the format
// Gmail wants). Pure: unit-tested in parse.test.ts.

interface Part {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: Part[]
  headers?: { name: string; value: string }[]
}

const decode = (data: string): string => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

export function header(part: Part, name: string): string {
  return part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

// The files attached to an email (PDFs, images...): name, size and the id Gmail needs to download it.
export function attachmentParts(payload: Part): { name: string; id: string; size: number }[] {
  const out: { name: string; id: string; size: number }[] = []
  const walk = (p: Part): void => {
    if (p.filename && p.body?.attachmentId) out.push({ name: p.filename, id: p.body.attachmentId, size: p.body.size ?? 0 })
    for (const c of p.parts ?? []) walk(c)
  }
  walk(payload)
  return out
}

// The readable text of an email: the plain-text part if there is one, else the HTML with the tags removed.
export function messageText(payload: Part): string {
  const find = (p: Part, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return decode(p.body.data)
    for (const c of p.parts ?? []) {
      const t = find(c, type)
      if (t) return t
    }
    return null
  }
  const plain = find(payload, 'text/plain')
  if (plain) return plain.replace(/\r\n/g, '\n').trim()
  const html = find(payload, 'text/html') ?? (payload.body?.data ? decode(payload.body.data) : '')
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// An email in the format Gmail's send API wants (RFC 2822, base64url). Header values can't contain line
// breaks: a "subject" with one could otherwise add hidden headers (e.g. a Bcc).
export function rawEmail(to: string, subject: string, body: string): string {
  return Buffer.from(mimeEmail(to, subject, body), 'utf8').toString('base64url')
}

export interface Attachment {
  name: string
  data: Buffer
}

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip'
}
export const mimeType = (name: string): string => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

// The whole email as text (RFC 5322). With attachments it is multipart/mixed: the text, then each file in
// base64. Header values can't contain line breaks, so nothing typed can add a header (a Bcc).
export function mimeEmail(to: string, subject: string, body: string, attachments: Attachment[] = []): string {
  const clean = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim()
  const word = (s: string): string => `=?UTF-8?B?${Buffer.from(clean(s), 'utf8').toString('base64')}?=`
  const head = [`To: ${clean(to)}`, `Subject: ${word(subject)}`, 'MIME-Version: 1.0']
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '', body]
  if (attachments.length === 0) return [...head, ...textPart].join('\r\n')
  const boundary = `dw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  const lines = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...textPart]
  for (const a of attachments) {
    const name = word(a.name)
    lines.push(
      `--${boundary}`,
      `Content-Type: ${mimeType(a.name)}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      ...(a.data.toString('base64').match(/.{1,76}/g) ?? [])
    )
  }
  lines.push(`--${boundary}--`, '')
  return lines.join('\r\n')
}

export const looksLikeEmail = (s: string): boolean => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s.trim())

interface CalendarEvent {
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
  hangoutLink?: string
  attendees?: { email: string; responseStatus?: string; self?: boolean }[]
}

// One line per event, in the user's local time: "Mon 21 Oct, 15:00-16:00 · Team sync · Meet link".
export function eventSummary(e: CalendarEvent, timeZone?: string): Record<string, unknown> {
  const when = (v?: { dateTime?: string; date?: string }): string => {
    if (!v) return ''
    if (v.date) return `${v.date} (all day)`
    const d = new Date(v.dateTime ?? '')
    return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  }
  return {
    title: e.summary ?? '(no title)',
    start: when(e.start),
    end: e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }) : undefined,
    ...(e.location ? { location: e.location } : {}),
    ...(e.hangoutLink ? { meetLink: e.hangoutLink } : {}),
    ...(e.attendees?.length ? { people: e.attendees.filter((a) => !a.self).map((a) => a.email).slice(0, 8) } : {})
  }
}
