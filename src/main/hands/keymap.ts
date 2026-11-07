// Key names → Windows "SendKeys" codes, for press_keys (hands/keys.ts). Pure: unit-tested in keymap.test.ts.
//
// Input: "F11", "space", "ctrl+t", "shift+n"… (case-insensitive, "+" between keys). Only plain keys we
// know; anything else is refused rather than guessed (a wrong key in the wrong window can do damage).

const NAMED: Record<string, string> = {
  enter: '{ENTER}',
  return: '{ENTER}',
  esc: '{ESC}',
  escape: '{ESC}',
  tab: '{TAB}',
  space: ' ',
  backspace: '{BS}',
  delete: '{DEL}',
  del: '{DEL}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  plus: '{+}', // "+" separates keys in our names, and means Shift to SendKeys
  minus: '-'
}
const MODIFIERS: Record<string, string> = { ctrl: '^', control: '^', alt: '%', shift: '+' }

// Keys that can't lose or send anything (they move, play/pause, go full screen, open something new, find,
// copy, save, zoom): run without asking, and a PC-control "yes" covers them for the rest of the task.
// Everything else (Ctrl+W closes a tab, Enter submits a form, Delete deletes, Ctrl+X/V change text…) asks.
// (Ctrl+N was asking on its own: "open VS Code and write two sum" stopped at it, 2026-10-19.)
const HARMLESS = new Set([
  'f11', 'f5', 'esc', 'escape', 'space', 'tab', 'shift+tab', 'k', 'j', 'l', 'f', 'm',
  'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end',
  'ctrl+t', 'ctrl+n', 'ctrl+shift+n', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+pageup', 'ctrl+pagedown',
  'ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9',
  'alt+left', 'alt+right', 'ctrl+r', 'ctrl+l', 'ctrl+f', 'ctrl+c', 'ctrl+a', 'ctrl+s',
  'ctrl+plus', 'ctrl+minus', 'ctrl+0', 'ctrl+home', 'ctrl+end'
])

export function normalise(keys: string): string {
  return keys
    .toLowerCase()
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .join('+')
}

export function isHarmless(keys: string): boolean {
  return HARMLESS.has(normalise(keys))
}

// "ctrl+shift+t" → "^+t". Throws a readable error for anything it doesn't know.
export function toSendKeys(keys: string): string {
  const parts = normalise(keys).split('+')
  if (parts.length === 0 || parts[0] === '') throw new Error('No key given.')
  const main = parts.pop()!
  let prefix = ''
  for (const m of parts) {
    const code = MODIFIERS[m]
    if (!code) throw new Error(`"${m}" isn't a key I can hold (use ctrl, alt or shift).`)
    if (prefix.includes(code)) throw new Error(`"${m}" is given twice.`)
    prefix += code
  }
  let code: string
  if (NAMED[main]) code = NAMED[main]
  else if (/^f([1-9]|1[0-2])$/.test(main)) code = `{${main.toUpperCase()}}`
  else if (/^[a-z0-9]$/.test(main)) code = main
  else throw new Error(`"${main}" isn't a key I know. Use a letter, a digit, F1–F12, or a name like enter, space, esc, up.`)
  return prefix + code
}
