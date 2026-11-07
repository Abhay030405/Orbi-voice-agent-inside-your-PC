// Gemini calls sometimes fail with "429 Resource exhausted" (too many requests at once) and work a moment
// later. The research agent failed with "a temporary system limit" because of one (live demo,
// 2026-10-20). Retry a few times, waiting longer each time; any other error fails at once.
//
// And a call can STALL: no answer, no error. One did (a document writer call, 2026-10-20), and since
// tool calls run in order, every later tool waited behind it: Orbi made up the time instead of asking
// the clock. So each attempt also has a time limit, and a stalled attempt is retried like a 429.
export async function retryBusy<T>(call: () => Promise<T>, waitsMs: number[] = [1500, 4000, 8000], attemptMs = 45_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(call(), attemptMs, 'Gemini took too long to answer')
    } catch (err) {
      const busy = /\b429\b|RESOURCE_EXHAUSTED|Resource exhausted|took too long/i.test(String(err))
      if (!busy || attempt >= waitsMs.length) throw err
      await new Promise((r) => setTimeout(r, waitsMs[attempt]))
    }
  }
}

// Reject if `promise` hasn't settled in `ms`. (The work itself can't be cancelled; it's just not waited for.)
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
