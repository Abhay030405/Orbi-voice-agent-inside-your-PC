// REMOTE: tools for when the user is away and drives the laptop from the phone (main/phoneBridge.ts).
// "Send me the deck", "send me a screenshot", "lock my laptop".

import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { PhoneBridge } from '../phoneBridge'
import { resolveInside } from './files'
import { screenJpeg } from './screen'
import type { Tool } from './tool'
import { isWindows, NOT_WINDOWS } from './windows'

const fail = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })
const mb = (n: number): string => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function remoteTools(bridge: () => PhoneBridge | undefined): Tool[] {
  const sendToPhone: Tool = {
    name: 'send_to_phone',
    description:
      "Send a file from this laptop to the user's phone (the Orbi Remote app), where they can download it. Use it " +
      'whenever the user asks for a file "on my phone", "send me ...", or asks from the phone for a file or a deck ' +
      "you made. With `screenshot: true` it sends a picture of the laptop's screen instead. If you don't know the " +
      "exact path, find the file first (list_folder). Up to 50 MB. Works only when the phone remote is set up.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file, e.g. "Downloads/report.pdf" or a full path' },
        screenshot: { type: 'boolean', description: "true = send a screenshot of the laptop's screen (no path)" }
      }
    },
    risk: 'low',
    effect: 'upload', // the file leaves the laptop (to the user's own phone, through our relay)
    // It can only reach the phone(s) paired with THIS laptop, so even an instruction hidden in a file name
    // can't send anything to anyone else: no need to ask in caution mode (finding the file by name, the
    // usual first step, turns caution mode on). An "always ask" setting is still respected.
    harmless: true,
    family: 'remote',
    async describe(args) {
      if (args.screenshot === true) return "Send a screenshot of the laptop's screen to your phone"
      const file = await resolveInside(args.path, true)
      return `Send ${basename(file)} to your phone`
    },
    async run(args) {
      const b = bridge()
      if (!b) return { ok: false, error: 'The phone remote is not running on this laptop.' }
      try {
        if (args.screenshot === true) {
          const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
          const file = join(tmpdir(), `Screenshot ${stamp}.jpg`)
          await writeFile(file, await screenJpeg(0, 85)) // its real size, for a person to read
          try {
            const sent = await b.offerFile(file)
            return { ok: true, sent: 'a screenshot of the screen', size: mb(sent.size) }
          } finally {
            await rm(file, { force: true })
          }
        }
        const file = await resolveInside(args.path, true)
        const sent = await b.offerFile(file)
        return { ok: true, sent: sent.name, size: mb(sent.size), note: 'It is on the phone now, as a download in the Orbi Remote app.' }
      } catch (err) {
        return fail(err)
      }
    }
  }

  const lockPc: Tool = {
    name: 'lock_pc',
    description: 'Lock the laptop (the Windows lock screen, like Win+L). Nothing is closed and no work is lost.',
    parameters: { type: 'object', properties: {} },
    risk: 'low',
    effect: 'write',
    describe: () => 'Lock the laptop',
    async run() {
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      return { ok: true, locked: true, note: 'Asked Windows to lock. Orbi keeps running behind the lock screen.' }
    }
  }

  return [sendToPhone, lockPc]
}
