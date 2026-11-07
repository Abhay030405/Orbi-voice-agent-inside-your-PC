import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachmentParts, eventSummary, header, looksLikeEmail, messageText, mimeEmail, rawEmail } from './parse.ts'

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')

describe('Google parsing', () => {
  it('reads the plain-text part of an email', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      headers: [{ name: 'Subject', value: 'Hello' }],
      parts: [
        { mimeType: 'text/html', body: { data: b64('<p>HTML</p>') } },
        { mimeType: 'text/plain', body: { data: b64('Plain body\r\nline 2') } }
      ]
    }
    assert.equal(messageText(payload), 'Plain body\nline 2')
    assert.equal(header(payload, 'subject'), 'Hello')
  })

  it('falls back to HTML without tags or scripts', () => {
    const payload = { mimeType: 'text/html', body: { data: b64('<style>x{}</style><p>Hi &amp; bye</p><script>evil()</script>') } }
    assert.equal(messageText(payload), 'Hi & bye')
  })

  it('builds an email Gmail accepts, and a subject cannot smuggle in extra headers', () => {
    const raw = Buffer.from(rawEmail('a@b.com', 'Hi\r\nBcc: spy@x.com', 'Body'), 'base64url').toString('utf8')
    assert.match(raw, /^To: a@b\.com\r\nSubject: =\?UTF-8\?B\?/)
    assert.ok(!/\r\nBcc:/i.test(raw), 'no injected Bcc header')
    assert.ok(raw.endsWith('\r\n\r\nBody'))
  })

  it('attaches files as multipart/mixed, base64 in short lines', () => {
    const data = Buffer.alloc(200, 7)
    const mime = mimeEmail('a@b.com', 'Doc', 'See attached', [{ name: 'Report (1).docx', data }])
    const boundary = /boundary="([^"]+)"/.exec(mime)?.[1] ?? ''
    assert.ok(boundary)
    const parts = mime.split(`--${boundary}`)
    assert.equal(parts.length, 4) // head, text, file, closing
    assert.match(parts[1], /text\/plain[\s\S]*See attached/)
    assert.match(parts[2], /wordprocessingml\.document; name="=\?UTF-8\?B\?/)
    const b64 = parts[2].split('\r\n\r\n')[1].trim()
    assert.ok(b64.split('\r\n').every((l) => l.length <= 76))
    assert.deepEqual(Buffer.from(b64.replace(/\r\n/g, ''), 'base64'), data)
    assert.ok(mime.trimEnd().endsWith(`--${boundary}--`))
  })

  it('finds the attachments in an email, however deep they are', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: 'aGk' } }] },
        { mimeType: 'application/pdf', filename: 'Certificate.pdf', body: { attachmentId: 'A1', size: 120000 } },
        { mimeType: 'image/png', filename: '', body: { attachmentId: 'inline' } } // no name: not a file the user sees
      ]
    }
    assert.deepEqual(attachmentParts(payload), [{ name: 'Certificate.pdf', id: 'A1', size: 120000 }])
  })

  it('checks email addresses', () => {
    assert.equal(looksLikeEmail('rahul@gmail.com'), true)
    assert.equal(looksLikeEmail('Rahul'), false)
    assert.equal(looksLikeEmail('a@b.com, c@d.com'), false)
  })

  it('summarises a calendar event', () => {
    const e = eventSummary(
      {
        summary: 'Team sync',
        start: { dateTime: '2026-10-21T15:00:00+05:30' },
        end: { dateTime: '2026-10-21T16:00:00+05:30' },
        hangoutLink: 'https://meet.google.com/abc',
        attendees: [{ email: 'me@x.com', self: true }, { email: 'rahul@x.com' }]
      },
      'Asia/Kolkata'
    )
    assert.equal(e.title, 'Team sync')
    assert.match(String(e.start), /15:00/)
    assert.equal(e.end, '16:00')
    assert.equal(e.meetLink, 'https://meet.google.com/abc')
    assert.deepEqual(e.people, ['rahul@x.com'])
  })
})
