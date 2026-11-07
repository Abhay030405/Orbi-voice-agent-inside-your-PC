// HANDS: what a tool is. Every tool in Dreamwalker has exactly this shape (docs/guide/03-architecture.md, D3).

export type Risk = 'low' | 'high' // high → the Gatekeeper asks a human first (unless you allow-listed it)
// read = only looks, nothing leaves the computer · write = changes something in the world ·
// upload = sends the user's data OFF the computer (screenshot, document, search query)
export type Effect = 'read' | 'write' | 'upload'

// What a tool returns. It goes straight back to Gemini, which reads it and tells the user. So a
// failure is a normal RESULT ({ ok: false, error }), not a crash: the AI must be able to say
// truthfully "that didn't work, because...". The PS says it must never claim a failed action succeeded.
// `hint` on a failure is for Gemini only (how to go on), not shown to the user.
export type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; error: string; hint?: string }

// A tool that changed something can also return how to reverse it. That goes into the Ledger and is
// handed back to the same tool's undo() later, even after a restart, so it must be plain JSON.
// What a running tool can do besides returning: report progress ("Writing the slides").
export interface ToolRunContext {
  progress(line: string): void
}

export interface ToolOutcome {
  result: ToolResult
  undo?: unknown
  // Images (or other files) handed to Gemini WITH the result, e.g. a screenshot. Not stored in the
  // Ledger (too big); the Ledger keeps the text result only.
  attachments?: { mimeType: string; data: string }[] // data = base64
}

export interface Tool {
  name: string // what Gemini calls it: snake_case, like an API endpoint
  description: string // Gemini READS this to decide when to use the tool. Bad description = wrong tool.
  parameters: object // JSON Schema of the arguments
  risk: Risk
  // Risk that depends on the arguments, e.g. a document whose name looks like an ID card is high risk
  // to upload. Defaults to `risk`.
  riskFor?(args: Record<string, unknown>): Risk
  effect: Effect
  // Returns text from OUTSIDE the user (web pages, files, clipboard, the screen, messages). Reading it
  // switches on caution mode for the rest of the request (the Gatekeeper's rule 3).
  untrustedOutput?: boolean
  // An upload to Gemini only (a screenshot for it to look at). Allowed even in caution mode: see gatekeeper.ts.
  modelOnly?: boolean
  // Changes nothing that lasts and sends nothing (bringing a window forward): never asks. See gatekeeper.ts.
  harmless?: boolean
  // The same, decided per call (press_keys: K to pause is harmless, Ctrl+W is not).
  harmlessFor?(args: Record<string, unknown>): boolean
  // Tools that work together on one thing (e.g. 'phone-control': look at the phone, tap, press). After
  // the user says yes to one of them, the family's LOW-risk tools don't ask again in the same request.
  family?: string
  // Plain words for the confirmation dialog and the ledger: "Move report.pdf (2.1 MB) to Dreamwalker's
  // trash". May look things up (file sizes...), but must not change anything.
  // It's ALSO the pre-check: throw if the action can't happen (outside the fence, file missing...).
  // Then the user is never asked to approve something that would be refused anyway.
  describe?(args: Record<string, unknown>): string | Promise<string>
  // `args` comes from the AI, and the AI can be tricked (prompt injection), so treat it like input
  // from a stranger: check every field before using it.
  run(args: Record<string, unknown>, ctx?: ToolRunContext): Promise<ToolResult | ToolOutcome>
  // Long work (writing a document): runs in the BACKGROUND so the conversation goes on (Gemini's
  // non-blocking function calls). It is listed as a task with its progress lines, and its result reaches
  // Gemini when it's done, which then tells the user (Abhay: "it shouldn't be blocked by those things").
  background?: boolean
  // Reverse a previous run, given the undo data that run returned. Tools without it can't be undone,
  // and the confirmation says so ("This can't be undone").
  undo?(undoData: unknown): Promise<ToolResult>
}

// run() may return just a result, or a result + undo data. This makes both look the same.
export function asOutcome(r: ToolResult | ToolOutcome): ToolOutcome {
  return 'ok' in r ? { result: r } : r
}
