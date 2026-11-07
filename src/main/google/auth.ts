// GOOGLE SIGN-IN for Gmail, Calendar and Drive (Abhay asked for them, 2026-10-21).
//
// The standard flow for desktop apps (OAuth 2.0 "installed app" with PKCE): open Google's sign-in page in
// the browser, Google sends the user back to a one-time local address on this computer (127.0.0.1), and we
// swap the code for tokens. No password ever passes through Dreamwalker.
//
// - The app's OAuth client (an ID Google gives each app) is created once by the user in their own Cloud
//   project and saved as userData/google-oauth.json (docs/google-setup.md). Nothing secret is in our code.
// - The refresh token is stored ENCRYPTED with Windows' own protection (Electron safeStorage, DPAPI), in
//   userData/google-token.bin. Signing out deletes it.
// - Scopes: read mail + send (sending always asks first), calendar events, Drive file names (not contents).

import { app, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { agentName } from '../about'
import { connectedPage } from './connectedPage'

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
]

interface Client {
  client_id: string
  client_secret?: string // Google issues one even for desktop apps; it is not really secret there
}
interface Tokens {
  refresh_token: string
  access_token?: string
  expires_at?: number // ms
  email?: string
}

const clientFile = (): string => join(app.getPath('userData'), 'google-oauth.json')
const tokenFile = (): string => join(app.getPath('userData'), 'google-token.bin')

// The downloaded file looks like {"installed": {"client_id": ..., "client_secret": ...}}.
function loadClient(): Client | null {
  if (!existsSync(clientFile())) return null
  const raw = JSON.parse(readFileSync(clientFile(), 'utf8')) as Record<string, Client>
  const c = raw.installed ?? raw.web ?? (raw as unknown as Client)
  return c?.client_id ? c : null
}

let cached: Tokens | null = null

async function loadTokens(): Promise<Tokens | null> {
  if (cached) return cached
  if (!existsSync(tokenFile()) || !safeStorage.isEncryptionAvailable()) return null
  cached = JSON.parse(safeStorage.decryptString(await fs.readFile(tokenFile()))) as Tokens
  return cached
}

async function saveTokens(t: Tokens): Promise<void> {
  cached = t
  await fs.writeFile(tokenFile(), safeStorage.encryptString(JSON.stringify(t)))
}

export type GoogleState = { connected: true; email: string } | { connected: false; reason: string }

export async function googleState(): Promise<GoogleState> {
  if (!loadClient()) return { connected: false, reason: 'not set up yet: the Google sign-in ID is missing (docs/google-setup.md)' }
  const t = await loadTokens().catch(() => null)
  return t ? { connected: true, email: t.email ?? 'your Google account' } : { connected: false, reason: 'not signed in yet' }
}

async function tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000)
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Google sign-in failed: ${String(json.error_description ?? json.error ?? res.status)}`)
  return json
}

// The email of the signed-in account, from the ID token Google returns (we only read our own token).
function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== 'string') return undefined
  try {
    return (JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string }).email
  } catch {
    return undefined
  }
}

// Opens the browser and waits (up to 3 minutes) for the user to finish signing in.
export async function signIn(): Promise<string> {
  const client = loadClient()
  if (!client) throw new Error('The Google sign-in ID is missing. Follow docs/google-setup.md once (2 minutes).')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  // The browser's request is answered only after the code is swapped and the permissions checked, so the
  // page it shows (connectedPage.ts) says what really happened: the account, or the real reason it failed.
  let page: ServerResponse | null = null
  const show = (opts: { ok: boolean; email?: string; message?: string }): void => {
    page?.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    page?.end(connectedPage({ ...opts, agentName: agentName() }))
    page = null
  }
  const code = new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/' || page) {
        res.writeHead(404).end() // e.g. the browser asking for /favicon.ico
        return
      }
      page = res
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code')
      server.close()
      clearTimeout(timer)
      if (ok) resolve({ code: url.searchParams.get('code')!, redirect })
      else reject(new Error(`Google sign-in was cancelled (${url.searchParams.get('error') ?? 'no code'}).`))
    })
    let redirect = ''
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Google sign-in timed out (3 minutes).'))
    }, 180_000)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      redirect = `http://127.0.0.1:${port}`
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      }).toString()
      void shell.openExternal(auth.toString())
    })
  })

  try {
    const email = await finishSignIn(client, await code, verifier)
    show({ ok: true, email })
    return email
  } catch (err) {
    show({ ok: false, message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

async function finishSignIn(client: Client, code: { code: string; redirect: string }, verifier: string): Promise<string> {
  const t = await tokenRequest({
    code: code.code,
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: code.redirect
  })
  if (typeof t.refresh_token !== 'string') throw new Error('Google did not return a long-term sign-in. Try again.')
  // Google's consent page lists each permission as a checkbox, UNTICKED for apps in testing. Signing in
  // without ticking them "worked", then every call failed with "insufficient scopes" (2026-10-21).
  const granted = String(t.scope ?? '').split(' ')
  const missing = SCOPES.filter((s) => s.startsWith('https://') && !granted.includes(s)).map((s) => s.split('/').pop())
  if (missing.length > 0) {
    throw new Error(`Signed in, but these permissions were not ticked on Google's page: ${missing.join(', ')}. Connect again and tick every box.`)
  }
  const email = emailFromIdToken(t.id_token)
  await saveTokens({
    refresh_token: t.refresh_token,
    access_token: String(t.access_token ?? ''),
    expires_at: Date.now() + Number(t.expires_in ?? 0) * 1000,
    email
  })
  return email ?? 'your Google account'
}

export async function signOut(): Promise<void> {
  cached = null
  await fs.rm(tokenFile(), { force: true })
}

// A fresh access token for the APIs (refreshed a minute before it runs out).
export async function accessToken(): Promise<string> {
  const client = loadClient()
  const t = await loadTokens()
  if (!client || !t) throw new Error('Google is not connected. Say "connect my Google account" first.')
  if (t.access_token && t.expires_at && t.expires_at - Date.now() > 60_000) return t.access_token
  const r = await tokenRequest({
    refresh_token: t.refresh_token,
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    grant_type: 'refresh_token'
  })
  await saveTokens({ ...t, access_token: String(r.access_token), expires_at: Date.now() + Number(r.expires_in ?? 3600) * 1000 })
  return String(r.access_token)
}

// Send a whole email (with attachments) through Gmail's upload address: the JSON one takes only about 5 MB.
export async function gmailUpload(mime: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'message/rfc822' },
    body: mime,
    signal: AbortSignal.timeout(120_000)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`Google answered ${res.status}: ${(json.error as { message?: string } | undefined)?.message ?? 'error'}`)
  return json
}

// GET/POST a Google API with the user's token.
export async function googleApi(url: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined
    throw new Error(`Google answered ${res.status}: ${err?.message ?? 'error'}`)
  }
  return json
}
