// Where a click lands, and which clicks always ask. Pure (no Electron): unit-tested in pcmap.test.ts.
//
// Screenshots are sent SMALLER than the screen (1280 px wide, or a window up to 1600 × 1200), and Windows
// on a 150% display has two kinds of pixels ("physical" vs "scaled"). Gemini picks a point in OUR image;
// clicking needs the PHYSICAL screen pixel. So every screenshot records how its image maps to the screen.

export interface ShotMap {
  what: string // "the main screen" or a window title
  window?: string // set when it's ONE window's picture: that window's title
  left: number // physical screen pixel of the image's top-left corner
  top: number
  scale: number // image pixels per physical pixel (< 1 when the image is smaller)
  width: number // image size
  height: number
}

// The latest screenshot's mapping (whole screen or a window): pc_click on a point uses it.
let lastShot: ShotMap | null = null
export const shots = {
  set: (map: ShotMap): void => {
    lastShot = map
  },
  get: (): ShotMap | null => lastShot
}

export function toPhysical(map: ShotMap, x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('x and y must be numbers')
  if (x < 0 || y < 0 || x > map.width || y > map.height) {
    throw new Error(`(${Math.round(x)}, ${Math.round(y)}) is outside the last screenshot (${map.width}×${map.height}).`)
  }
  return { x: Math.round(map.left + x / map.scale), y: Math.round(map.top + y / map.scale) }
}

// Buttons whose click can't be taken back, or sends/spends something: ALWAYS asked, even inside a task
// the user already approved, with the button's name in the question.
const RISKY = /\b(delete|remove|send|pay|payment|buy|purchase|order|checkout|check out|submit|confirm|uninstall|format|erase|reset|sign out|log ?out|logout|transfer|withdraw|publish|post|tweet|share|discard|shut ?down|restart|empty (recycle bin|trash)|accept|agree|install)\b/i

export function isRiskyName(name: string): boolean {
  return RISKY.test(name)
}

export interface UiElement {
  id: number
  type: string // Button, Hyperlink, Edit, MenuItem…
  name: string
  x: number // centre, physical screen pixels
  y: number
  enabled: boolean
}

// The C# helper prints one element per line: type \t name \t left \t top \t width \t height \t enabled.
export function parseElements(out: string, max = 150): UiElement[] {
  const list: UiElement[] = []
  for (const line of out.split(/\r?\n/)) {
    const f = line.split('\t')
    if (f.length < 7) continue
    const [type, name, l, t, w, h, en] = f
    const [left, top, width, height] = [l, t, w, h].map(Number)
    if (![left, top, width, height].every(Number.isFinite) || width < 2 || height < 2) continue
    list.push({ id: list.length + 1, type, name: name.trim(), x: Math.round(left + width / 2), y: Math.round(top + height / 2), enabled: en === '1' })
    if (list.length >= max) break
  }
  return list
}

// pc_ui_elements' `find`: the controls whose names contain the most of the given words, best first,
// page order among equals. Words shorter than 2 letters are ignored ("a", "&").
export function matchElements<T extends UiElement>(items: T[], find: string, limit: number): T[] {
  const words = find.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
  if (words.length === 0) return items.slice(0, limit)
  return items
    .map((item, order) => ({ item, order, score: words.filter((w) => item.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.item)
}
