import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { redactDeep, redactSecrets } from './secrets.ts'

const hide = (t: string): string => redactSecrets(t).text

describe('hiding secrets before they reach Gemini (C3)', () => {
  it('API keys and tokens', () => {
    assert.equal(hide('key AIzaSyA1234567890abcdefghijklmnopqrstuv ok'), 'key [hidden Google API key] ok')
    assert.equal(hide('AKIAIOSFODNN7EXAMPLE'), '[hidden AWS key]')
    assert.equal(hide('token ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'token [hidden GitHub token]')
    assert.equal(hide('OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz123456'), 'OPENAI=[hidden API key]')
    // A key under a name that the password rule also knows: hidden once, cleanly (found live, 2026-10-29).
    const r = redactSecrets('OPENAI_API_KEY=sk-proj-FAKEfakeFAKEfake1234567890abcd')
    assert.deepEqual(r, { text: 'OPENAI_API_KEY=[hidden API key]', hidden: ['API key'] })
    assert.equal(hide('xoxb-1234567890-abcdefghij'), '[hidden Slack token]')
    assert.equal(hide('sk_live_abcdefghijklmnop1234'), '[hidden Stripe key]')
    assert.match(hide('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), /^Bearer \[hidden token\]$/)
  })

  it('a private key block, whole', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----'
    assert.equal(hide(`before\n${pem}\nafter`), 'before\n[hidden private key]\nafter')
  })

  it('passwords in config files keep the name, lose the value', () => {
    assert.equal(hide('DB_PASSWORD=hunter2!x'), 'DB_PASSWORD=[hidden password]')
    assert.equal(hide('"password": "S3cret-Pass"'), '"password": [hidden password]')
    assert.equal(hide("api_key: 'abcd1234efgh'"), 'api_key: [hidden password]')
    assert.equal(hide('client_secret = 9f8e7d6c5b4a'), 'client_secret = [hidden password]')
  })

  it('a password inside a link or connection string', () => {
    assert.equal(hide('mongodb+srv://abhay:Pa55word@cluster0.x.net/db'), 'mongodb+srv://abhay:[hidden password]@cluster0.x.net/db')
    assert.equal(hide('postgres://me:longsecretvalue@localhost:5432/app'), 'postgres://me:[hidden password]@localhost:5432/app')
  })

  it('more keys: tokens by name, Hugging Face, Django, Bearer', () => {
    assert.equal(hide('GITHUB_TOKEN=abcdef1234567890abcdef'), 'GITHUB_TOKEN=[hidden password]')
    assert.equal(hide('HF_TOKEN=hf_abcdefghijklmnopqrstuvwxyz0123456789'), 'HF_TOKEN=[hidden Hugging Face token]')
    assert.equal(hide("SECRET_KEY = 'django-insecure-x9#k2!abc'"), 'SECRET_KEY = [hidden password]')
    assert.equal(hide('Authorization: Bearer abcdEFGH1234ijklMNOP5678'), 'Authorization: Bearer [hidden token]')
  })

  it('code stays readable (found in review, 2026-10-29)', () => {
    for (const t of [
      'api_key = os.environ.get("API_KEY")',
      'self.password = hash_password(raw)',
      'apiKey: config.apiKey,',
      'password = raw_password',
      'token = request.headers["x-token"]',
      'PWD=C:/Users/hp/projects',
      'OLDPWD=/home/me',
      'The secret: happiness.'
    ]) {
      assert.equal(hide(t), t, t)
    }
  })

  it('leaves ordinary text alone', () => {
    for (const t of [
      'Your password: must be at least eight characters',
      'Forgot password? Reset it from settings',
      'The task-management-system-overview is ready',
      'pwd prints the working directory',
      'https://example.com/a:b@c is odd but has no password',
      'Meeting at 5, OTP 482913 expires in 10 minutes'
    ]) {
      assert.equal(hide(t), t, t)
    }
  })

  it('counts what it hid, and walks a whole tool result', () => {
    const r = redactDeep({ ok: true, file: 'C:/x/.env', text: 'A=1\nAPI_KEY=abcd1234efgh5678\nB=2', lines: ['token: sk-abcdefghijklmnopqrstuvwxyz'] })
    assert.deepEqual(r.value, { ok: true, file: 'C:/x/.env', text: 'A=1\nAPI_KEY=[hidden password]\nB=2', lines: ['token: [hidden API key]'] })
    assert.deepEqual(r.hidden, ['password', 'API key'])
  })

  it('never hides twice, never breaks on odd input', () => {
    assert.equal(hide('[hidden password]'), '[hidden password]')
    assert.equal(hide(''), '')
    assert.deepEqual(redactDeep(null).value, null)
    assert.deepEqual(redactDeep(42).value, 42)
  })
})
