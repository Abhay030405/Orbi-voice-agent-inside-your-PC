// PC CONTROL TOOLS (M5, PS C1 "look-and-click"). Guide: docs/build-log/12-pc-control.md.
//
//   pc_ui_elements  "what can I click in this window?": its buttons, links, text boxes… BY NAME, with ids
//   pc_click        click one of those (exact), or a point in the latest screenshot (fallback)
//   pc_type         type text (any language) into a field
//   pc_scroll       scroll a window
//
// Clicking an element doesn't need pixels at all: Windows' UI Automation asks the control to act
// ("press yourself"), which works even if the window is half hidden. Only controls without that get a
// real mouse click, at their CURRENT position.
//
// Safety: the names make one extra rule possible: Send / Pay / Buy / Delete / Uninstall / Sign out…
// ALWAYS ask, with the button's name in the question, even inside a task you already said yes to.
// Dreamwalker never clicks or types into its own windows (incl. the confirmation dialog).

import { resolveWindowTitle } from './screen'
import { isWindows, NOT_WINDOWS } from './windows'
import { bringToFront, clickAt, focusElement, listElements, navigateTop, parseRect, selectAll, pressElement, scrollAt, typeText, whatIsAt, windowRect } from './pcinput'
import { isRiskyName, matchElements, parseElements, shots, toPhysical, type UiElement } from './pcmap'
import type { Tool } from './tool'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const fail = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })

// The latest element list: ids refer to it. nth = which of several same-named controls.
interface Listed extends UiElement {
  nth: number
}
let listed: { title: string; items: Listed[] } | null = null


interface ClickTarget {
  label: string // for the question and the ledger: '"Install" (Button) in "Microsoft Store"'
  name: string
  element?: Listed
  title?: string
  point?: { x: number; y: number }
}

export function pcTools(): Tool[] {
  const targets = new Map<string, ClickTarget>() // resolved in describe() (the pre-check), reused by riskFor/run
  const keyOf = (args: Record<string, unknown>): string => JSON.stringify(args)

  async function resolveClick(args: Record<string, unknown>): Promise<ClickTarget> {
    if (typeof args.element === 'number') {
      const el = listed?.items.find((e) => e.id === args.element)
      if (!listed || !el) throw new Error('There is no such element: call pc_ui_elements first and use one of its ids.')
      return { label: `"${el.name || el.type}" (${el.type}) in "${listed.title}"`, name: el.name, element: el, title: listed.title }
    }
    if (typeof args.x === 'number' && typeof args.y === 'number') {
      const map = shots.get()
      if (!map) throw new Error('Take a screenshot first (take_screenshot): x and y are positions in it.')
      const p = toPhysical(map, args.x, args.y)
      let at = await whatIsAt(p.x, p.y)
      // A window's picture is of THAT window, even if something now covers it (often Dreamwalker itself:
      // every click was refused while our window sat over Chrome, 2026-10-20). Bring it forward first,
      // like a person would. (The only side effect a pre-check has: harmless, see focus_window.)
      if (at.ours && map.window) {
        await bringToFront(map.window)
        at = await whatIsAt(p.x, p.y)
      }
      if (at.ours) throw new Error("That point is on Dreamwalker's own window, so I won't click it.")
      const [type, ...rest] = at.what.split('|')
      const name = rest.join('|')
      return { label: `${name ? `"${name}"` : 'the point'}${type ? ` (${type})` : ''} at (${Math.round(args.x)}, ${Math.round(args.y)}) in ${map.what}`, name, point: p }
    }
    throw new Error('Give an element id (from pc_ui_elements) or x and y (from the latest screenshot).')
  }

  const elements: Tool = {
    name: 'pc_ui_elements',
    family: 'pc-control',
    description:
      'List what can be clicked or typed into in a window on this PC: buttons, links, text boxes, menu items, tabs, ' +
      'list items, each with an id and its name. Use it BEFORE pc_click / pc_type: clicking by id is exact. ' +
      '`window` = a title or program name ("Chrome", "Settings", "Spotify"). On big pages (YouTube, shops, feeds) ' +
      'pass `find` = a few words of what you are looking for (e.g. "lofi", "Add to cart", "search"): it searches ' +
      'the whole page, not just the first items. If it lists nothing useful (games, drawings), use take_screenshot ' +
      'with that window and click by position instead.',
    parameters: { type: 'object', properties: { window: { type: 'string' }, find: { type: 'string' } }, required: ['window'] },
    risk: 'low',
    effect: 'read',
    untrustedOutput: true, // the names come from the app: outside text
    async run(args) {
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      try {
        const title = await resolveWindowTitle(str(args.window))
        if (typeof title !== 'string') return { ok: false, error: title.error }
        // With `find`, read much more of the page and keep only what matches: the first 150 controls of
        // a YouTube page are its menus, so the videos were never in the list (2026-10-20).
        const find = str(args.find)
        const cap = find ? 1000 : 150
        const r = await listElements(title, cap)
        if (!r.found) return { ok: false, error: `Couldn't find the window "${title}".` }
        const seen = new Map<string, number>()
        const items: Listed[] = parseElements(r.text, cap).map((e) => {
          const k = `${e.type}|${e.name}`
          const nth = seen.get(k) ?? 0
          seen.set(k, nth + 1)
          return { ...e, nth }
        })
        listed = { title, items }
        if (items.length === 0) {
          return { ok: true, window: title, elements: [], note: "This app doesn't describe its controls to Windows. Use take_screenshot of this window and pc_click with x, y." }
        }
        const shown = find ? matchElements(items, find, 40) : items
        return {
          ok: true,
          window: title,
          count: shown.length,
          elements: shown.map((e) => ({ id: e.id, type: e.type, name: e.name, ...(e.enabled ? {} : { disabled: true }) })),
          ...(find && shown.length === 0 ? { note: `Nothing named like "${find}". Try other words, or take_screenshot.` } : {}),
          ...(!find && items.length >= cap ? { note: `Only the first ${cap} controls. Pass find with a few words to search the whole window.` } : {})
        }
      } catch (err) {
        return fail(err)
      }
    }
  }

  const click: Tool = {
    name: 'pc_click',
    family: 'pc-control',
    description:
      'Click something on the PC: `element` = an id from the latest pc_ui_elements (preferred, exact), or `x`, `y` = ' +
      'a point in the latest take_screenshot picture. `right: true` for a right-click, `double: true` for a ' +
      'double-click. Afterwards, look again to see what happened.',
    parameters: {
      type: 'object',
      properties: { element: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' }, right: { type: 'boolean' }, double: { type: 'boolean' } }
    },
    risk: 'low',
    // Send / Pay / Buy / Delete / Install… always ask (the name is known from the pre-check below).
    riskFor: (args) => (isRiskyName(targets.get(keyOf(args))?.name ?? '') ? 'high' : 'low'),
    effect: 'write',
    async describe(args) {
      const t = await resolveClick(args)
      targets.set(keyOf(args), t)
      return `${args.right === true ? 'Right-click' : args.double === true ? 'Double-click' : 'Click'} ${t.label}`
    },
    async run(args) {
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      try {
        const t = targets.get(keyOf(args)) ?? (await resolveClick(args))
        const right = args.right === true
        const count = args.double === true ? 2 : 1
        if (t.element && t.title) {
          await bringToFront(t.title)
          let point: { x: number; y: number } = { x: t.element.x, y: t.element.y }
          if (!right && count === 1) {
            // Ask the control itself to act; falls back to a mouse click at its CURRENT centre.
            const r = await pressElement(t.title, t.element.type, t.element.name, t.element.nth)
            if (r.result === 'invoked') return { ok: true, clicked: t.label, how: 'pressed', note: 'Clicked. Before telling the user any result, look again: report what the screen shows now.' }
            if (r.result === 'not found' || r.result === 'no window') return { ok: false, error: `${t.label} isn't there any more. List the elements again.` }
            const [x, y] = r.result.replace('click:', '').split(',').map(Number)
            point = { x, y }
          }
          const c = await clickAt(point.x, point.y, right, count)
          if (!c.clicked) return { ok: false, error: "That spot is covered by Dreamwalker's own window, so I didn't click." }
          return { ok: true, clicked: t.label, how: 'mouse', note: 'Clicked. Before telling the user any result, look again: report what the screen shows now.' }
        }
        if (!t.point) return { ok: false, error: 'Nothing to click.' }
        const c = await clickAt(t.point.x, t.point.y, right, count)
        if (!c.clicked) return { ok: false, error: "That spot is on Dreamwalker's own window, so I didn't click." }
        return { ok: true, clicked: t.label, how: 'mouse', note: 'Clicked. Before telling the user any result, take a new screenshot and report what it shows.' }
      } catch (err) {
        return fail(err)
      }
    }
  }

  const type: Tool = {
    name: 'pc_type',
    family: 'pc-control',
    description:
      'Type text on the PC (any language). `element` = a text box id from pc_ui_elements to type into (preferred); ' +
      'otherwise it types where the cursor is in `window` (or the window in front). `enter: true` presses Enter after ' +
      '(that may send or submit something, so it asks first). Typing into a box REPLACES what is in it (replace: false ' +
      'adds to it instead); text in documents (Word, Notepad) is never replaced.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, element: { type: 'integer' }, window: { type: 'string' }, enter: { type: 'boolean' }, replace: { type: 'boolean' } },
      required: ['text']
    },
    risk: 'low',
    riskFor: (args) => (args.enter === true ? 'high' : 'low'),
    effect: 'write',
    describe(args) {
      const el = typeof args.element === 'number' ? listed?.items.find((e) => e.id === args.element) : undefined
      if (typeof args.element === 'number' && !el) throw new Error('There is no such element: call pc_ui_elements first.')
      const where = el ? ` into "${el.name || el.type}"` : str(args.window) ? ` in "${str(args.window)}"` : ''
      return `Type "${str(args.text).slice(0, 100)}"${where}${args.enter === true ? ' and press Enter' : ''}`
    },
    async run(args) {
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      try {
        let text = typeof args.text === 'string' ? args.text : ''
        if (!text) return { ok: false, error: 'No text to type.' }
        if (text.length > 2000) return { ok: false, error: 'That is too much to type at once (max 2000 characters).' }
        const el = typeof args.element === 'number' ? listed?.items.find((e) => e.id === args.element) : undefined
        // "Search X on this (YouTube) window": YouTube's own box often isn't listed yet, so Gemini typed into the
        // browser's address bar and got a GOOGLE search (2026-10-21). On a YouTube window, words typed there
        // become YouTube's own search, in the same tab.
        let enter = args.enter === true
        if (el && listed && /address|search or type|type a url/i.test(el.name) && /youtube/i.test(listed.title) && !/^\S+\.\S+$|:\/\//.test(text.trim())) {
          // Through Ctrl+L (selects the whole address): typing at the cursor appended "youtube.com" to the words.
          const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(text.trim())}`
          const exe = /Microsoft.? Edge$/.test(listed.title) ? 'msedge' : / Brave$/.test(listed.title) ? 'brave' : /Firefox$/.test(listed.title) ? 'firefox' : 'chrome'
          const r = await navigateTop(exe, url)
          if (r.startsWith('ok|')) return { ok: true, searchedYouTube: true, note: 'Searched on YouTube itself, in the same tab.' }
          return { ok: false, error: "Couldn't reach that browser window. Use open_url with the YouTube search link and tab: \"current\"." }
        }
        if (el && listed) {
          await bringToFront(listed.title)
          const f = await focusElement(listed.title, el.type, el.name, el.nth)
          if (!f.focused) {
            const c = await clickAt(el.x, el.y, false, 1) // couldn't focus it directly: click into it
            if (!c.clicked) return { ok: false, error: "That field is covered by Dreamwalker's own window." }
          }
        } else if (str(args.window)) {
          const title = await resolveWindowTitle(str(args.window))
          if (typeof title !== 'string') return { ok: false, error: title.error }
          await bringToFront(title)
        }
        // A box's old text is replaced, not added to: typing at the cursor put "youtube.com" after the words in
        // Chrome's address bar (2026-10-21). Only one-line boxes; a document's text is never selected and replaced.
        if (el && (el.type === 'Edit' || el.type === 'ComboBox') && args.replace !== false) {
          await new Promise((r) => setTimeout(r, 80))
          await selectAll()
        }
        await new Promise((r) => setTimeout(r, 150))
        const t = await typeText(text, enter)
        if (!t.typed) return { ok: false, error: "Dreamwalker's own window is in front, so I didn't type. Say which app or field (pc_ui_elements first)." }
        return { ok: true, typed: text.length, pressedEnter: enter }
      } catch (err) {
        return fail(err)
      }
    }
  }

  const scroll: Tool = {
    name: 'pc_scroll',
    family: 'pc-control',
    description: 'Scroll a window on the PC up or down (`amount` 1-15 steps, default 5).',
    parameters: {
      type: 'object',
      properties: { window: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', minimum: 1, maximum: 15 } },
      required: ['window', 'direction']
    },
    risk: 'low',
    effect: 'write',
    describe: (args) => `Scroll ${str(args.direction) === 'up' ? 'up' : 'down'} in "${str(args.window)}"`,
    async run(args) {
      if (!isWindows) return { ok: false, error: NOT_WINDOWS }
      try {
        const title = await resolveWindowTitle(str(args.window))
        if (typeof title !== 'string') return { ok: false, error: title.error }
        await bringToFront(title)
        const rect = parseRect((await windowRect(title)).rect)
        if (!rect) return { ok: false, error: `Couldn't find "${title}".` }
        const amount = typeof args.amount === 'number' ? Math.max(1, Math.min(15, Math.floor(args.amount))) : 5
        const notches = str(args.direction) === 'up' ? amount : -amount
        const s = await scrollAt(rect.left + Math.round(rect.width / 2), rect.top + Math.round(rect.height / 2), notches)
        if (!s.scrolled) return { ok: false, error: "Dreamwalker's own window is over it, so I didn't scroll." }
        return { ok: true, scrolled: `${str(args.direction)} ${amount}`, in: title }
      } catch (err) {
        return fail(err)
      }
    }
  }

  return [elements, click, type, scroll]
}
