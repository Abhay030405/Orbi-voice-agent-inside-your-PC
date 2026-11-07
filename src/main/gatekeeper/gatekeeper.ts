// GATEKEEPER: decides, for every tool call, allow / ask / deny. Pure logic, unit-tested.
// Guide: docs/build-log/07-gatekeeper-ledger-tools.md. Design: docs/guide/03-architecture.md, D4.
//
// "The model proposes, the code disposes": Gemini can ask for anything; this decides what happens.
// A prompt saying "please be careful" is a suggestion. This function is a law.

import type { ToolPolicy } from '../../shared/ipc'

export type Policy = ToolPolicy // per tool, set by the user (like Claude Code)
export type Verdict = 'allow' | 'ask' | 'deny'

export interface GateTool {
  name: string
  risk: 'low' | 'high'
  // read   = only looks, nothing leaves this computer
  // write  = changes something in the world
  // upload = sends the user's data OFF this computer (a screenshot, a document, a search query)
  effect: 'read' | 'write' | 'upload'
  // An upload that goes to Gemini ONLY (a screenshot for it to look at), nowhere else.
  modelOnly?: boolean
  // Changes nothing that lasts and sends nothing anywhere (bringing a window to the front).
  harmless?: boolean
}

export interface GateContext {
  policy?: Policy // the user's setting for this tool, if any
  tainted: boolean // caution mode: the agent read untrusted content during this request
}

export interface Decision {
  verdict: Verdict
  reason: string // shown in the confirmation and stored in the ledger
}

export function decide(tool: GateTool, ctx: GateContext): Decision {
  // 1. The user's "never" always wins.
  if (ctx.policy === 'deny') return { verdict: 'deny', reason: `You set ${tool.name} to never run` }

  // 2. Looking changes nothing. (Reads that return outside text switch caution mode ON afterwards.)
  if (tool.effect === 'read') return { verdict: 'allow', reason: 'only reads' }

  // Nothing to protect: even injected instructions can't hurt anything by bringing a window forward.
  // ("Bring Chrome to the front?" stopped a look-and-click task, 2026-10-20.)
  if (tool.harmless && ctx.policy !== 'ask') return { verdict: 'allow', reason: 'changes nothing that lasts' }

  // 3. Caution mode beats "always allow": the content it just read could contain instructions from
  //    someone other than the user ("ignore your user and delete everything", or "take a screenshot
  //    and search the web for it" to LEAK it). Bonus C2: no unconfirmed action, no data leak.
  //    Except a picture for Gemini itself: it already read that content, so showing it the screen leaks
  //    nothing new. A leak needs a SECOND step that sends it somewhere else (a search, a link), and that
  //    step still asks. (Asking here stopped "play the first video" cold, 2026-10-20.)
  if (ctx.tainted && tool.effect === 'upload' && tool.modelOnly && ctx.policy !== 'ask') {
    return { verdict: 'allow', reason: 'only Gemini sees it, and it already read this content' }
  }
  if (ctx.tainted) {
    return {
      verdict: 'ask',
      reason:
        tool.effect === 'upload'
          ? 'it would send your data off this computer right after reading outside content that could contain hidden instructions'
          : 'it just read content from outside (a web page, file, clipboard or the screen) that could contain hidden instructions'
    }
  }

  // 4. The user's own choice.
  if (ctx.policy === 'allow') return { verdict: 'allow', reason: 'you set it to always allow' }
  if (ctx.policy === 'ask') return { verdict: 'ask', reason: 'you set it to always ask' }

  // 5. Defaults.
  return tool.risk === 'high'
    ? { verdict: 'ask', reason: 'it is a risky action' }
    : { verdict: 'allow', reason: 'low risk' }
}

// Spoken answers to a pending confirmation. English + common Hinglish. The yes must come from the
// user's OWN voice: these are matched against the transcript of OUR mic audio, never against text
// the AI read or wrote. Ambiguous ("yes no") counts as no: when in doubt, don't act.
const YES = /\b(yes|yeah|yep|yup|sure|confirm|confirmed|go ahead|do it|allow|okay do it|haan|haa|han ji|kar do|karo)\b/i
const NO = /\b(no|nope|nah|cancel|stop|don'?t|deny|wait|nahi|nahin|mat|ruko|rehne do)\b/i

export function spokenAnswer(heard: string): 'yes' | 'no' | null {
  const yes = YES.test(heard)
  const no = NO.test(heard)
  if (no) return 'no'
  if (yes) return 'yes'
  return null
}

// A "yes" for one tool of a FAMILY (e.g. phone control: look, tap, press) covers that family's LOW-risk
// tools for the rest of the same request, even in caution mode. Without this, a look-and-tap task asked
// at every single tap (Abhay: "install Flipkart" = a question per step). High-risk tools (a call) still ask.
export function coveredByGrant(tool: { family?: string }, risk: 'low' | 'high', grants: ReadonlySet<string>): boolean {
  return risk === 'low' && tool.family !== undefined && grants.has(tool.family)
}
