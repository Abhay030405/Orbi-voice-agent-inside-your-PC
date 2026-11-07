// EDGE GLOW: lights the screen edges while the agent is active. Guide: build log 10.
//
// Our own look, not Siri's rainbow (Abhay: "it looks copied"): ONE colour, the theme's signal colour
// (Graphite ice, Ember mint), the same colour the face and the "live / verified" marks use. Calm:
//   a faint wash along the edges, a thin brighter line at the very edge, and a LIGHT that travels
//   around the screen's border, like a scan.
//   listening  the wash breathes with your voice; the light rests (no travelling)
//   thinking   the light circles the screen, quicker (= working)
//   speaking   the light drifts slowly; the wash breathes with its voice
//
// Drawn on one canvas at half resolution, ~24 frames a second, and not at all while idle. (A first
// version spun two screen-sized colour squares 60×/s: ~33% of the Intel GPU + ~24% in the desktop
// compositor, measured.)

import './overlay.css'
import type { AgentState, Theme } from '../../shared/ipc'

const glow = document.querySelector<HTMLElement>('.glow')!
const canvas = glow.querySelector<HTMLCanvasElement>('canvas')!
const ctx = canvas.getContext('2d')!

const SCALE = 0.5 // canvas pixels per CSS pixel
const FRAME_MS = 1000 / 20
const SIGNAL: Record<Theme, [number, number, number]> = { graphite: [127, 211, 230], ember: [116, 217, 178] }

// How each state looks. travel = seconds per lap of the travelling light (0 = it rests).
const LOOK: Record<Exclude<AgentState, 'idle'>, { wash: number; washVoice: number; line: number; light: number; travel: number }> = {
  listening: { wash: 0.1, washVoice: 0.3, line: 0.22, light: 0.0, travel: 0 },
  thinking: { wash: 0.08, washVoice: 0, line: 0.18, light: 0.75, travel: 6 }, // Abhay: 2.6 s was too fast
  speaking: { wash: 0.12, washVoice: 0.25, line: 0.24, light: 0.45, travel: 9 }
}

let state: AgentState = 'idle'
let theme: Theme = 'graphite'
let level = 0
let washMask: HTMLCanvasElement | null = null
let lineMask: HTMLCanvasElement | null = null
// Made once per screen size / theme, so a frame is just a few copies: the wash and the line already in
// colour, and both masks together for the travelling light.
let washColored: HTMLCanvasElement | null = null
let lineColored: HTMLCanvasElement | null = null
let bothMasks: HTMLCanvasElement | null = null
const scratch = document.createElement('canvas')

// White where light may show (alpha = how much), clear in the middle. Rounded inner corners.
function frameMask(w: number, h: number, fade: number, radius: number): HTMLCanvasElement {
  const m = document.createElement('canvas')
  m.width = w
  m.height = h
  const c = m.getContext('2d')!
  c.fillStyle = '#fff'
  c.fillRect(0, 0, w, h)
  const f = fade * SCALE
  c.globalCompositeOperation = 'destination-out'
  c.filter = `blur(${(f / 2).toFixed(1)}px)` // the blur IS the soft inward fade
  c.beginPath()
  c.roundRect(f, f, w - 2 * f, h - 2 * f, radius * SCALE)
  c.fill()
  return m
}

function resize(): void {
  const w = Math.max(1, Math.round(window.innerWidth * SCALE))
  const h = Math.max(1, Math.round(window.innerHeight * SCALE))
  canvas.width = scratch.width = w
  canvas.height = scratch.height = h
  washMask = frameMask(w, h, 26, 48) // soft, close to the edge ("too much flowing into the screen" before)
  lineMask = frameMask(w, h, 5, 24) // the thin line at the very edge
  bothMasks = document.createElement('canvas')
  bothMasks.width = w
  bothMasks.height = h
  const b = bothMasks.getContext('2d')!
  b.globalAlpha = 0.8
  b.drawImage(washMask, 0, 0)
  b.globalAlpha = 1
  b.drawImage(lineMask, 0, 0)
  recolor()
  if (state !== 'idle') draw(performance.now())
}

function colored(mask: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = mask.width
  c.height = mask.height
  const x = c.getContext('2d')!
  x.drawImage(mask, 0, 0)
  x.globalCompositeOperation = 'source-in'
  x.fillStyle = rgba(1)
  x.fillRect(0, 0, c.width, c.height)
  return c
}
function recolor(): void {
  if (!washMask || !lineMask) return
  washColored = colored(washMask)
  lineColored = colored(lineMask)
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const rgba = (a: number): string => `rgba(${SIGNAL[theme].join(',')},${Math.max(0, Math.min(1, a)).toFixed(3)})`

// Paint `fill` only where `mask` is, at strength `alpha`, onto the glow.
function paint(mask: HTMLCanvasElement, fill: string | CanvasGradient, alpha: number): void {
  if (alpha <= 0.002) return
  const s = scratch.getContext('2d')!
  s.globalCompositeOperation = 'source-over'
  s.clearRect(0, 0, scratch.width, scratch.height)
  s.drawImage(mask, 0, 0)
  s.globalCompositeOperation = 'source-in'
  s.fillStyle = fill
  s.fillRect(0, 0, scratch.width, scratch.height)
  ctx.globalAlpha = alpha
  ctx.drawImage(scratch, 0, 0)
  ctx.globalAlpha = 1
}

function draw(now: number): void {
  if (state === 'idle' || !washColored || !lineColored || !bothMasks) return
  const look = LOOK[state]
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  // 1. The wash: even all round; breathes with the voice.
  ctx.globalAlpha = Math.min(1, look.wash + level * look.washVoice)
  ctx.drawImage(washColored, 0, 0)
  // 2. The thin edge line.
  ctx.globalAlpha = look.line
  ctx.drawImage(lineColored, 0, 0)
  ctx.globalAlpha = 1
  // 3. The travelling light: a conic gradient that is bright in one direction only, turned over time.
  //    Seen through the masks it's a soft patch of light gliding along the border.
  if (look.light > 0) {
    const lap = look.travel > 0 && !reducedMotion.matches ? (now / 1000 / look.travel) % 1 : 0.125
    const g = ctx.createConicGradient(lap * Math.PI * 2 - Math.PI / 2, w / 2, h / 2)
    g.addColorStop(0, rgba(0))
    g.addColorStop(0.06, rgba(1))
    g.addColorStop(0.16, rgba(0))
    g.addColorStop(1, rgba(0))
    paint(bothMasks, g, look.light)
  }
}

// ── The loop: ~24 fps while visible, nothing while idle ──
let timer: ReturnType<typeof setTimeout> | null = null
function loop(): void {
  timer = null
  if (state === 'idle') return
  level += (target - level) * (target > level ? 0.5 : 0.15)
  draw(performance.now())
  // While the light travels, 30 frames a second (20 made it step visibly); otherwise 20.
  const moving = LOOK[state].travel > 0 && !reducedMotion.matches
  timer = setTimeout(() => requestAnimationFrame(loop), moving ? 1000 / 30 : FRAME_MS)
}
function start(): void {
  if (timer === null && state !== 'idle') requestAnimationFrame(loop)
}

resize()
let resizeTimer: ReturnType<typeof setTimeout> | null = null
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(resize, 200)
})

window.dreamwalkerOverlay.onTheme((t) => {
  theme = t
  recolor()
})
window.dreamwalkerOverlay.onState((s) => {
  state = s
  glow.dataset.state = s
  start()
})

// Loudness arrives ~30×/s but jumpy: the drawing loop eases toward it (rise fast, fall slower).
let target = 0
window.dreamwalkerOverlay.onLevel((value) => {
  target = Math.max(0, Math.min(1, value))
})
