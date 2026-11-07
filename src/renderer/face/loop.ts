// One animation loop per face canvas: the animator steps, drawFace draws.
// Cost matters: this runs all day (docs/build-log/09-ui.md, "Performance").
//   moving (morph, voice, thinking)  → every animation frame (~60 fps)
//   resting (idle float, blink)      → 15 fps, on a timer: requestAnimationFrame alone would still
//                                       wake the page 60 times a second just to skip frames
//   still (muted, offline, danger)   → 4 fps
//   window not on screen             → no drawing; check twice a second

import type { Theme } from '../../shared/ipc'
import { FaceAnimator } from './animator'
import { PALETTES, drawFace } from './drawFace'

export interface FaceLoopOptions {
  canvas: HTMLCanvasElement
  animator: FaceAnimator
  theme: () => Theme
  level?: () => number // voice level 0..1 (yours while listening, its own while speaking)
  progress?: () => number | null
  visible?: () => boolean // is this canvas's window on screen? (default: yes)
}

const RESTING_MS = 1000 / 15
const STILL_MS = 250
const HIDDEN_MS = 500
const STILL_STATES = new Set(['paused', 'offline', 'danger'])
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

export function startFaceLoop(opts: FaceLoopOptions): () => void {
  const { canvas, animator } = opts
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  let raf = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = performance.now()
  let stopped = false

  const draw = (now: number): void => {
    // Size the bitmap to the element's CSS size × screen density, so it's sharp on high-DPI screens.
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    drawFace(ctx, w, h, animator.frame(now / 1000, opts.progress?.() ?? null), PALETTES[opts.theme()])
  }

  const tick = (): void => {
    raf = 0
    timer = null
    if (stopped) return
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (opts.visible && !opts.visible()) {
      timer = setTimeout(tick, HIDDEN_MS)
      return
    }
    animator.reducedMotion = reducedMotionQuery.matches
    animator.step(dt, opts.level?.() ?? 0)
    draw(now)
    if (animator.busy && !animator.reducedMotion) raf = requestAnimationFrame(tick)
    else timer = setTimeout(tick, STILL_STATES.has(animator.state) || animator.reducedMotion ? STILL_MS : RESTING_MS)
  }

  // A state change should show at once, not after the current timer: kick the loop.
  const kick = (): void => {
    if (stopped || raf) return
    if (timer) clearTimeout(timer)
    timer = null
    raf = requestAnimationFrame(tick)
  }
  animator.onChange = kick

  tick()
  return () => {
    stopped = true
    animator.onChange = null
    if (raf) cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
  }
}
