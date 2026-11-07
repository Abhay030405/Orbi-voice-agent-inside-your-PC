// CONFIRMATION: asking the human before a risky action. Two ways to answer, whichever comes first:
//   1. Our confirmation WINDOW (confirmWindow.ts): only that window's answer is believed, and the AI's
//      own hands refuse to click or type into Dreamwalker's windows. (It replaced the plain Windows
//      message box on 2026-10-19; the box is still the fallback if the window can't load.)
//   2. The user's own voice ("yes" / "no", English or Hinglish), matched against the transcript of OUR
//      mic audio, never against anything the AI read or said.
// No answer within the time limit = no. When in doubt, don't act.

import { dialog, type BrowserWindow } from 'electron'
import type { Theme } from '../../shared/ipc'
import type { ConfirmWindow } from './confirmWindow'
import { spokenAnswer } from './gatekeeper'

export interface ConfirmRequest {
  action: string // plain words: "Delete 3 files from Downloads (2.1 MB)"
  undoable: boolean
  irreversible?: boolean // high risk AND no undo: "can't be undone" (a call). Otherwise there's simply nothing to undo.
  note?: string
  reason: string // why we're asking
  tool?: string
  risk?: 'low' | 'high'
}

export type Answer = 'yes' | 'no' | 'timeout'

export interface ConfirmLook {
  agentName: string
  theme: Theme
  background: string // the window colour before the page paints
}

export class Confirmer {
  // Tests only (DREAMWALKER_DEBUG=1 + DREAMWALKER_AUTO_CONFIRM=yes|no): answer without a dialog,
  // so automated runs don't pop windows up on the user's screen. main/index.ts only sets it in debug.
  autoAnswer: 'yes' | 'no' | null = null

  private voiceListener: ((heard: string) => void) | null = null
  private voiceResolve: ((answer: Answer) => void) | null = null
  private heard = ''
  private readonly window: ConfirmWindow
  private readonly look: () => ConfirmLook

  constructor(window: ConfirmWindow, look: () => ConfirmLook) {
    this.window = window
    this.look = look
  }

  // A yes/no recognised on THIS computer from the user's mic (wake/spotter.ts SpokenAnswers). Needed
  // because Gemini sends no transcript while one of its actions waits for an answer.
  heardAnswer(answer: 'yes' | 'no'): void {
    this.voiceResolve?.(answer)
  }

  // Feed every fragment of the user's transcribed speech here. Only used while a question is open.
  userSaid(text: string): void {
    if (!this.voiceListener) return
    this.heard += ` ${text}`
    this.voiceListener(this.heard)
  }

  get pending(): boolean {
    return this.voiceListener !== null
  }

  // Bring the open question to the front (Home's "Review" button). False if none is open.
  focus(): boolean {
    return this.window.focus()
  }

  async ask(req: ConfirmRequest, parent: BrowserWindow | null, timeoutMs = 60_000): Promise<Answer> {
    if (this.autoAnswer) {
      console.log(`[confirm:auto-${this.autoAnswer}] ${req.action}`)
      return this.autoAnswer
    }
    this.heard = ''

    const byVoice = new Promise<Answer>((resolve) => {
      this.voiceResolve = resolve
      this.voiceListener = (heard) => {
        const answer = spokenAnswer(heard)
        if (answer) resolve(answer)
      }
    })
    const byTimeout = new Promise<Answer>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))

    const look = this.look()
    const controller = new AbortController() // closes the fallback box if voice or the timeout answered first
    const byWindow = this.window
      .ask(
        {
          agentName: look.agentName,
          theme: look.theme,
          action: req.action,
          tool: req.tool,
          risk: req.risk ?? 'high',
          undoable: req.undoable,
          irreversible: req.irreversible === true,
          reason: req.reason,
          note: req.note,
          timeoutMs
        },
        look.background
      )
      .catch((err: unknown) => {
        console.error(`[confirm] ${err instanceof Error ? err.message : String(err)}: using the Windows box`)
        return nativeBox(req, parent, controller.signal)
      })

    try {
      return await Promise.race([byWindow, byVoice, byTimeout])
    } finally {
      this.voiceListener = null
      this.voiceResolve = null
      this.window.close()
      controller.abort()
    }
  }
}

// The fallback: Windows draws it, not our page.
async function nativeBox(req: ConfirmRequest, parent: BrowserWindow | null, signal: AbortSignal): Promise<Answer> {
  const options = {
    type: 'warning' as const,
    title: 'Dreamwalker needs your OK',
    message: req.action,
    detail:
      `${req.undoable ? '↩ Can be undone afterwards ("undo that").' : req.irreversible ? '⚠ This CAN\'T be undone.' : 'Nothing permanent: there is nothing to undo.'}\n\n` +
      `Asking because ${req.reason}.${req.note ? `\n\n${req.note}` : ''}\n\nYou can also say "yes, go ahead" or "no, cancel".`,
    buttons: ['Allow', 'Deny'],
    defaultId: 1, // Enter = Deny: the safe choice is the default
    cancelId: 1, // Esc / closing the box = Deny
    noLink: true,
    signal
  }
  const { response } = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
  return response === 0 ? 'yes' : 'no'
}
