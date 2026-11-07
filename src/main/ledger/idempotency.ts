// EXACTLY-ONCE (PS A1): recognise a repeated request for the same action, so it isn't done twice.
// Guide: docs/build-log/08-exactly-once-verify-tasks.md.
//
// After a dropped connection, Gemini can ask for the same tool again, with a NEW call id (learn: the
// call id is like an order number, and a retry gets a new one). So we don't compare call ids. We
// compare WHAT is being asked, within the same user request:
//
//     key = <request id> | <tool> | <arguments in a stable order>
//
// - Same request + same tool + same args = a retry → return the saved result, don't run it again.
// - The user asking AGAIN ("send it again") is a new request → a new request id → a new key → runs.
// - The request id is random (crypto.randomUUID), not a counter: a counter restarts at 1 every time the
//   app starts and would collide with yesterday's keys in the ledger.
//
// The ledger's idem_key column is UNIQUE, so the database itself refuses a second copy.

// JSON with object keys sorted at every level, so {a:1,b:2} and {b:2,a:1} give the same text.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function idempotencyKey(requestId: string, tool: string, args: Record<string, unknown>): string {
  return `${requestId}|${tool}|${stableStringify(args)}`
}

// When is a repeated call a RETRY? Found 2026-10-19 on the phone: "screenshot → tap → screenshot" is
// a look-and-act loop, and the second screenshot is a NEW look, not a retry. Treating every identical
// call in a request as a retry returned the OLD picture, so Gemini tapped blind.
//
// Rule: an identical call is a retry only if NOTHING ELSE happened in between (the duplicates Gemini
// sends, and replays after a reconnect, come right after the original). If something else ran in
// between, it's a new occurrence and gets its own key: <base>#2, #3…
// One guard per user request. Reads count as "something happened" too, but get no key (never blocked).
export class RetryGuard {
  private last: string | null = null
  private readonly seen = new Map<string, number>()

  // base = idempotencyKey(…). Returns the ledger key for this call (undefined for reads) and whether it
  // is a retry of the call just before.
  check(base: string, isRead: boolean): { key: string | undefined; retry: boolean } {
    const retry = this.last === base
    this.last = base
    if (isRead) return { key: undefined, retry }
    if (!retry || !this.seen.has(base)) this.seen.set(base, (this.seen.get(base) ?? 0) + 1)
    return { key: `${base}#${this.seen.get(base)}`, retry }
  }
}
