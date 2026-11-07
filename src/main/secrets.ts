// HIDING SECRETS (PS C3): passwords, API keys and tokens that a tool READS (a .env file, the clipboard, a
// web page, an email, text on screen) are replaced with "[hidden …]" on this computer, before the result
// goes to Gemini or into the Ledger. The agent can still say "there's an API key there", never the key.
//
// Only outside content is scrubbed (tools marked untrustedOutput, main/index.ts runTool): what the user
// says, and what our own tools report, pass through as they are. Pure functions, tested on their own.
//
// Not covered: secrets visible in a SCREENSHOT (that would need on-device text recognition).

interface Rule {
  kind: string
  re: RegExp
  // Which part to hide; default: the whole match.
  keep?: (m: RegExpExecArray) => { before: string; after: string }
  // Only if this says so (prose like "password: must be 8 characters" is not a secret).
  when?: (m: RegExpExecArray) => boolean
}

// A value that looks like a real secret: long, or with a digit or a symbol in it. Not code: in a source file
// `api_key = os.environ.get("API_KEY")` or `password = hash_password(raw)` must stay readable.
const secretish = (v: string): boolean => {
  const quoted = /^["']/.test(v)
  const s = v.replace(/^["']|["']$/g, '')
  if (!quoted) {
    if (/^[A-Za-z_$][\w$]*(\.[\w$]+)+/.test(s)) return false // config.apiKey, os.environ...
    if (/[([]/.test(s)) return false // a call or an index: hash_password(raw), env["X"]
    if (/^[A-Za-z_]+[.!?]?$/.test(s)) return false // a plain name or word, no digits: raw_password, "happiness."
  }
  return s.length >= 12 || (s.length >= 6 && /[^A-Za-z]/.test(s))
}

const RULES: Rule[] = [
  { kind: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'AWS key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'API key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Stripe key', re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/g },
  { kind: 'token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g }, // a JWT
  { kind: 'token', re: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})/g, keep: (m) => ({ before: m[1], after: '' }) },
  // user:password@host in a link or connection string: hide the password only.
  {
    kind: 'password',
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi,
    keep: (m) => ({ before: m[1], after: m[3] })
  },
  // password = "…", API_KEY: …, "secret": "…" (config files, .env, JSON): keep the name, hide the value.
  {
    kind: 'password',
    re: /\b((?:[A-Za-z0-9_]*?)(?:password|passwd|passcode|secret[_-]?key|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"',;}{]{4,})/gi,
    keep: (m) => ({ before: m[1], after: '' }),
    when: (m) => secretish(m[2])
  }
]

export interface Redacted {
  text: string
  hidden: string[] // the kinds hidden, one per secret
}

export function redactSecrets(text: string): Redacted {
  const hidden: string[] = []
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray // match + groups (offset and input dropped)
      // Something already hidden by an earlier rule is not a secret again.
      if (m[0].includes('[hidden') || (rule.when && !rule.when(m))) return m[0]
      hidden.push(rule.kind)
      const k = rule.keep?.(m)
      return k ? `${k.before}[hidden ${rule.kind}]${k.after}` : `[hidden ${rule.kind}]`
    })
  }
  return { text: out, hidden }
}

// Every string inside a tool result (nested objects and arrays too). Keys are left alone.
export function redactDeep<T>(value: T, hidden: string[] = []): { value: T; hidden: string[] } {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      const r = redactSecrets(v)
      hidden.push(...r.hidden)
      return r.text
    }
    if (depth > 8 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]))
  }
  return { value: walk(value, 0) as T, hidden }
}
