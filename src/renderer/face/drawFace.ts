// THE FACE: one pure drawing function, ported from the designer's reference renderer
// (Claude Design handoff, companion-renderer.reference.js). Geometry and timings are theirs; see
// docs/build-log/09-ui.md and docs/design/ for the rules (MASCOT_GUIDE).
//
// drawFace(ctx, w, h, frame, theme) draws ONE frame and remembers nothing. All motion comes from the
// inputs: t (a clock), ent (how far a tool morph has gone, 0..1) and the voice levels. That's what
// makes it easy to reuse in three places (companion, title bar, status cell) and to test by eye.
//
// Two additions to the reference, both from the designer's own notes:
//   - caution is an OVERLAY on any state (dashed amber outline + sceptical brow), not its own state
//   - task progress can be unknown (our background tasks don't report a %): the bar then sweeps

import type { FaceState, FaceTool, Theme } from '../../shared/ipc'

export interface FacePalette {
  ink: string
  acc: string // signal: live / acting / verified
  att: string // amber: needs you, nothing else
  err: string // red: can't be undone / error
  paper: string
  bg: string
  body: string
  bodyP: string // body while paused
}

export const PALETTES: Record<Theme, FacePalette> = {
  graphite: { ink: '#E6E8EB', acc: '#7FD3E6', att: '#F2B54A', err: '#F0705A', paper: '#E6E8EB', bg: '#0E1013', body: 'rgba(18,21,25,0.95)', bodyP: '#262A31' },
  ember: { ink: '#EFEAE2', acc: '#74D9B2', att: '#F4B860', err: '#F0715A', paper: '#EFEAE2', bg: '#15130F', body: 'rgba(27,24,20,0.95)', bodyP: '#2B261F' }
}

export interface FaceFrame {
  t: number // seconds, a global clock (blink, float, scans)
  st: FaceState
  tool: FaceTool | null // when st === 'acting'
  ent: number // 0..1 tool morph progress (0 = resting eyes, 1 = full tool pose)
  aU: number // your mic level 0..1 (listening)
  aA: number // its voice level 0..1 (speaking)
  caution: boolean
  progress: number | null // task bar fill 0..1, or null = unknown
  // Our additions (not in the designer's reference):
  gx?: number // where the eyes look, -1..1 (Home: they follow your cursor)
  gy?: number
  pet?: number // 0..1: being petted (pointer over the companion): happy eyes, a little squish
}

const TAU = Math.PI * 2
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v))
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp(x), 3)

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// Heartbeat curve: two peaks per period, at 10% and 28%. The "needs you" hop.
export function heart(t: number, period: number): number {
  const x = (t % period) / period
  return Math.exp(-Math.pow((x - 0.1) / 0.045, 2)) + 0.6 * Math.exp(-Math.pow((x - 0.28) / 0.05, 2))
}

// Rounded rectangle path.
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawFace(ctx: CanvasRenderingContext2D, w: number, h: number, o: FaceFrame, P: FacePalette): void {
  const { t, st, tool, aU, aA } = o
  const e = o.ent
  const act = st === 'acting'
  const S = Math.min(w, h) * 0.78
  const cx = w / 2
  let cy = h / 2
  if (st === 'idle' || st === 'task') cy += Math.sin(t * 1.3) * S * 0.018 // idle float
  if (st === 'confirm') cy -= heart(t, 1.6) * S * 0.035 // the hop

  const lerp = (a: number, b: number): number => a + (b - a) * e
  let bw = S
  let bh = S
  let brad = S * 0.34
  if (act && tool === 'phone') {
    bw = lerp(S, S * 0.64)
    bh = lerp(S, S * 1.1)
    brad = lerp(S * 0.34, S * 0.16)
  }

  ctx.save()
  // Petted: squish down a little from the bottom and sway, like a pleased pet. Only at rest.
  const pet = st === 'idle' || st === 'task' ? clamp(o.pet ?? 0) : 0
  if (pet > 0) {
    const base = cy + bh / 2
    ctx.translate(cx, base)
    ctx.rotate(Math.sin(t * 5) * 0.035 * pet)
    ctx.scale(1 + 0.05 * pet, 1 - 0.07 * pet)
    ctx.translate(-cx, -base)
  }
  if (act && tool === 'phone' && t % 1.6 < 0.4) {
    const a = e * Math.sin(t * 46) * 0.05 // ring shake
    ctx.translate(cx, cy)
    ctx.rotate(a)
    ctx.translate(-cx, -cy)
  }

  const x0 = cx - bw / 2
  const y0 = cy - bh / 2
  const L = S * 0.045 // line weight for every stroke detail
  const ink = P.ink
  const bodyPath = (): void => {
    ctx.beginPath()
    rr(ctx, x0, y0, bw, bh, brad)
  }
  const line = (x1: number, y1: number, x2: number, y2: number, col: string, l: number): void => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = col
    ctx.lineWidth = l
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  const pill = (x: number, y: number, pw: number, ph: number, col: string): void => {
    ph = Math.max(ph, pw * 0.25)
    ctx.beginPath()
    rr(ctx, x - pw / 2, y - ph / 2, pw, ph, Math.min(pw, ph) / 2)
    ctx.fillStyle = col
    ctx.fill()
  }
  const dot = (x: number, y: number, r: number, col: string): void => {
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0, r), 0, TAU)
    ctx.fillStyle = col
    ctx.fill()
  }
  const eyes = (fn: (side: number) => void): void => {
    fn(-1)
    fn(1)
  }

  // Folder tab (behind the body).
  if (act && tool === 'file' && e > 0.01) {
    ctx.beginPath()
    rr(ctx, x0 + S * 0.1, y0 - S * 0.08 * e, S * 0.32, S * 0.22, S * 0.06)
    ctx.fillStyle = P.body
    ctx.fill()
    ctx.strokeStyle = rgba(P.acc, 0.6)
    ctx.lineWidth = 1.3
    ctx.stroke()
  }

  // Body: a dark hairline outside + the fill + a state-coloured outline. The two hairlines keep it
  // readable on any wallpaper.
  ctx.beginPath()
  rr(ctx, x0 - 0.8, y0 - 0.8, bw + 1.6, bh + 1.6, brad + 0.8)
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 1
  ctx.stroke()
  bodyPath()
  ctx.fillStyle = st === 'paused' ? P.bodyP : P.body
  ctx.fill()

  let sc = 'rgba(255,255,255,0.16)'
  let sl = 1
  let dash: number[] | null = null
  if (st === 'listening') {
    sc = rgba(P.acc, 0.4 + 0.5 * aU)
    sl = 1.6
  } else if (st === 'thinking' || act || st === 'speaking') {
    sc = rgba(P.acc, 0.55)
    sl = 1.3
  } else if (st === 'confirm') {
    sc = P.att
    sl = 2.2
  } else if (st === 'danger') {
    sc = P.err
    sl = 2.2
  } else if (st === 'reconnecting') {
    sc = 'rgba(255,255,255,0.32)'
    dash = [2, 3]
  }
  // Caution overlay: confirm/danger already say more, so they keep their own outline.
  const cautionShown = o.caution && st !== 'confirm' && st !== 'danger'
  if (cautionShown) {
    sc = P.att
    sl = 1.5
    dash = [3, 3]
  }
  ctx.save()
  if (dash) ctx.setLineDash(dash)
  ctx.strokeStyle = sc
  ctx.lineWidth = sl
  ctx.stroke()
  ctx.restore()

  const ex = S * 0.17 // eye offset from the centre
  const ey = cy - S * 0.05
  const ew = S * 0.1
  const eh = S * 0.17
  const bp = t % 4.3 // blink every 4.3 s, 160 ms
  const bl = bp < 0.16 ? Math.max(0.08, Math.abs(Math.cos((bp / 0.16) * Math.PI))) : 1
  // Gaze: the eyes shift a little toward where it's looking (never out of the face).
  const gzx = clamp(o.gx ?? 0, -1, 1) * S * 0.07
  const gzy = clamp(o.gy ?? 0, -1, 1) * S * 0.05

  if (!act) {
    if (st === 'idle' || st === 'task') {
      // Resting eyes fade into happy ^ ^ arcs while petted.
      if (pet < 1) eyes((s) => pill(cx + s * ex + gzx, ey + gzy, ew, eh * bl, rgba(ink, 0.9 * (1 - pet))))
      if (pet > 0) {
        eyes((s) => {
          ctx.beginPath()
          ctx.arc(cx + s * ex, ey + eh * 0.3, ew * 0.8, Math.PI * 1.15, Math.PI * 1.85)
          ctx.strokeStyle = rgba(ink, 0.9 * pet)
          ctx.lineWidth = L
          ctx.lineCap = 'round'
          ctx.stroke()
        })
        // Faint signal-coloured cheeks.
        eyes((s) => dot(cx + s * (ex + ew * 0.9), ey + eh * 0.85, S * 0.035, rgba(P.acc, 0.45 * pet)))
      }
      if (st === 'task') {
        const y = cy + S * 0.21
        const left = cx - S * 0.15
        const width = S * 0.3
        line(left, y, left + width, y, rgba(ink, 0.18), L)
        if (o.progress !== null) {
          line(left, y, left + width * clamp(o.progress), y, P.acc, L)
        } else {
          // Unknown progress: a short segment sweeping back and forth.
          const seg = width * 0.34
          const pos = (0.5 + 0.5 * Math.sin(t * 1.6)) * (width - seg)
          line(left + pos, y, left + pos + seg, y, P.acc, L)
        }
      }
    } else if (st === 'listening') {
      eyes((s) => pill(cx + s * ex + gzx, ey + gzy, ew * 1.05, eh * (1.15 + 0.35 * aU) * bl, P.acc))
    } else if (st === 'thinking') {
      const dx = Math.sin(t * 1.4) * S * 0.05
      const dy = -S * 0.06
      eyes((s) => pill(cx + s * ex + dx, ey + dy, ew * 0.9, eh * 0.8, ink))
      for (let i = 0; i < 3; i++) {
        dot(cx + (i - 1) * S * 0.09, cy + S * 0.21, S * 0.028, rgba(P.acc, 0.25 + 0.75 * Math.max(0, Math.sin(t * 6 - i * 0.9))))
      }
    } else if (st === 'speaking') {
      eyes((s) => {
        ctx.beginPath()
        ctx.arc(cx + s * ex, ey + eh * 0.25, ew * 0.75, Math.PI * 1.15, Math.PI * 1.85)
        ctx.strokeStyle = ink
        ctx.lineWidth = L
        ctx.lineCap = 'round'
        ctx.stroke()
      })
      pill(cx, cy + S * 0.2, S * 0.2, S * (0.035 + 0.15 * aA), P.acc)
    } else if (st === 'confirm') {
      eyes((s) => {
        dot(cx + s * ex, ey, ew * 0.62, ink)
        line(cx + s * (ex - ew * 0.8), ey - eh * 0.85, cx + s * (ex + ew * 0.8), ey - eh * 1.1, P.att, L)
      })
      ctx.beginPath()
      ctx.arc(cx, cy + S * 0.2, S * 0.04, 0, TAU)
      ctx.strokeStyle = ink
      ctx.lineWidth = L * 0.8
      ctx.stroke()
    } else if (st === 'danger') {
      eyes((s) => {
        dot(cx + s * ex, ey, ew * 0.55, ink)
        line(cx + s * (ex - ew * 0.9), ey - eh * 0.62, cx + s * (ex + ew * 0.9), ey - eh * 0.9, P.err, L)
      })
      line(cx - S * 0.07, cy + S * 0.2, cx + S * 0.07, cy + S * 0.2, rgba(ink, 0.75), L * 0.9)
    } else if (st === 'reconnecting') {
      const dx = Math.sin(t * 0.9) * S * 0.07
      eyes((s) => pill(cx + s * ex + dx, ey, ew, eh * 0.75, rgba(ink, 0.45)))
    } else if (st === 'offline') {
      eyes((s) => line(cx + s * ex - ew * 0.6, ey + eh * 0.15, cx + s * ex + ew * 0.6, ey + eh * 0.15, rgba(ink, 0.4), L))
      const bx = cx + S * 0.36
      const by = cy - S * 0.36
      ctx.beginPath()
      ctx.arc(bx, by, S * 0.1, 0, TAU)
      ctx.fillStyle = P.err
      ctx.fill()
      ctx.strokeStyle = P.bg
      ctx.lineWidth = 2
      ctx.stroke()
      line(bx - S * 0.045, by, bx + S * 0.045, by, P.bg, S * 0.03)
    } else if (st === 'paused') {
      // Blindfold: a light band across the eyes, two knot tails on the right.
      ctx.save()
      bodyPath()
      ctx.clip()
      ctx.fillStyle = P.paper
      ctx.fillRect(x0, ey - S * 0.11, bw, S * 0.22)
      ctx.restore()
      line(cx + S * 0.48, ey, cx + S * 0.55, ey + S * 0.13, P.paper, S * 0.05)
      line(cx + S * 0.48, ey, cx + S * 0.57, ey + S * 0.03, P.paper, S * 0.05)
    }
    // Caution brows: left lowered (sceptical), right flat. Only over the resting-type eyes, where
    // they have room; confirm/danger/paused/offline have their own brows or none.
    if (cautionShown && (st === 'idle' || st === 'task' || st === 'listening' || st === 'thinking' || st === 'speaking')) {
      line(cx - ex - ew * 0.9, ey - eh * 0.95, cx - ex + ew * 0.9, ey - eh * 0.6, P.att, L)
      line(cx + ex - ew * 0.9, ey - eh * 0.85, cx + ex + ew * 0.9, ey - eh * 0.85, P.att, L)
    }
  } else if (tool === 'app') {
    // Becomes a window: eyes square up, a title bar draws across, three window dots.
    const w2 = lerp(ew, S * 0.13)
    const h2 = lerp(eh * bl, S * 0.12)
    const r2 = lerp(ew / 2, S * 0.025)
    const yy = ey + S * 0.06 * e
    eyes((s) => {
      ctx.beginPath()
      rr(ctx, cx + s * ex - w2 / 2, yy - h2 / 2, w2, h2, r2)
      ctx.fillStyle = ink
      ctx.fill()
    })
    ctx.save()
    bodyPath()
    ctx.clip()
    const by = y0 + S * 0.25
    if (e > 0.01) line(cx - (bw / 2) * e, by, cx + (bw / 2) * e, by, rgba(P.acc, 0.85), 1.4)
    for (let i = 0; i < 3; i++) dot(x0 + S * 0.17 + i * S * 0.075, y0 + S * 0.135, S * 0.022, rgba(P.acc, e * (i === 0 ? 1 : 0.5)))
    ctx.restore()
  } else if (tool === 'term') {
    // Left eye folds into a > prompt; right eye becomes a typing cursor.
    const lx = cx - ex
    const a = ew * 0.6 * e
    const hh = lerp((eh - ew) / 2, eh * 0.42)
    ctx.beginPath()
    ctx.moveTo(lx - a, ey - hh)
    ctx.lineTo(lx + a, ey)
    ctx.lineTo(lx - a, ey + hh)
    ctx.strokeStyle = ink
    ctx.lineWidth = lerp(ew, L * 1.1)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    const n = e > 0.95 ? Math.floor((t * 3.5) % 4) : 0
    const base = cx + ex - S * 0.07
    const yR = lerp(ey, ey + eh * 0.42)
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = rgba(ink, 0.75)
      ctx.fillRect(base + k * S * 0.055 - S * 0.015, yR - S * 0.1, S * 0.03, S * 0.07)
    }
    const al = e > 0.95 ? (t % 0.7 < 0.4 ? 1 : 0.3) : 1
    pill(lerp(cx + ex, base + n * S * 0.055), yR, lerp(ew, S * 0.06), lerp(eh * bl, S * 0.035), rgba(P.acc, al))
  } else if (tool === 'web') {
    // A lens grows over the right eye; both eyes scan; result lines draw in.
    const dx = Math.sin(t * 1.8) * S * 0.07 * e
    eyes((s) => pill(cx + s * ex + dx, ey, lerp(ew, ew * 0.85), lerp(eh * bl, eh * 0.7), ink))
    if (e > 0.01) {
      const lx = cx + ex + dx
      const lr = ew * 1.35 * e
      ctx.beginPath()
      ctx.arc(lx, ey, lr, 0, TAU)
      ctx.strokeStyle = P.acc
      ctx.lineWidth = L * 0.8
      ctx.stroke()
      const a = Math.PI / 4
      line(lx + Math.cos(a) * lr, ey + Math.sin(a) * lr, lx + Math.cos(a) * (lr + S * 0.12 * e), ey + Math.sin(a) * (lr + S * 0.12 * e), P.acc, L)
      for (let i = 0; i < 3; i++) {
        const yy = cy + S * 0.19 + i * S * 0.065
        line(cx - S * 0.16, yy, cx - S * 0.16 + S * (0.26 - i * 0.07) * e, yy, rgba(ink, 0.3), L * 0.6)
      }
    }
  } else if (tool === 'file') {
    // A sheet slides left → right; the eyes look down and follow it.
    const ph = (t * 0.8) % 1
    const fx = cx + S * (-0.18 + 0.36 * ph)
    const al = e * Math.sin(Math.PI * ph)
    const dx = (fx - cx) * 0.3 * e
    const dy = S * 0.045 * e
    eyes((s) => pill(cx + s * ex + dx, ey + dy, ew, lerp(eh * bl, eh * 0.72), ink))
    if (e > 0.01) {
      ctx.beginPath()
      rr(ctx, fx - S * 0.05, cy + S * 0.15, S * 0.1, S * 0.13, S * 0.02)
      ctx.strokeStyle = rgba(P.acc, al)
      ctx.lineWidth = L * 0.7
      ctx.stroke()
      line(fx - S * 0.025, cy + S * 0.2, fx + S * 0.025, cy + S * 0.2, rgba(P.acc, al), L * 0.5)
    }
  } else if (tool === 'phone') {
    // The body narrows into a handset (above); speaker line on top, signal-coloured home bar below.
    const ex2 = lerp(ex, S * 0.12)
    eyes((s) => pill(cx + s * ex2, ey, lerp(ew, ew * 0.85), eh * bl * lerp(1, 0.85), ink))
    if (e > 0.01) {
      line(cx - S * 0.05, y0 + S * 0.08, cx + S * 0.05, y0 + S * 0.08, rgba(ink, 0.35 * e), L * 0.6)
      line(cx - S * 0.08, y0 + bh - S * 0.08, cx + S * 0.08, y0 + bh - S * 0.08, rgba(P.acc, 0.85 * e), L * 0.6)
    }
  } else if (tool === 'screen') {
    // Viewfinder corners close in, pupils dilate, a scan line sweeps.
    const bx = lerp(S * 0.47, S * 0.33)
    const byy = lerp(S * 0.4, S * 0.24)
    const k = S * 0.08
    if (e > 0.01) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const X = cx + sx * bx
          const Y = ey + sy * byy
          ctx.beginPath()
          ctx.moveTo(X, Y - sy * k)
          ctx.lineTo(X, Y)
          ctx.lineTo(X - sx * k, Y)
          ctx.strokeStyle = rgba(P.acc, e)
          ctx.lineWidth = L * 0.7
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
      }
    }
    eyes((s) => {
      pill(cx + s * ex, ey, lerp(ew, ew * 1.3), lerp(eh * bl, ew * 1.3), ink)
      dot(cx + s * ex, ey, ew * (0.22 + 0.12 * Math.sin(t * 2.2)) * e, P.bg)
    })
    if (e > 0.5) {
      const sy = ey - byy + 2 * byy * ((t * 0.7) % 1)
      line(cx - bx + S * 0.04, sy, cx + bx - S * 0.04, sy, rgba(P.acc, 0.4 * e), 1)
    }
  } else if (tool === 'click') {
    // Eyes glance down-right; a pointer slides in and taps with a ripple.
    const dx = S * 0.035 * e
    const dy = S * 0.03 * e
    eyes((s) => pill(cx + s * ex + dx, ey + dy, ew, lerp(eh * bl, eh * 0.55), ink))
    const ph = (t % 1.2) / 1.2
    const press = ph < 0.12 ? 0.88 : 1
    const px = lerp(cx + S * 0.45, cx + S * 0.12)
    const py = lerp(cy + S * 0.4, cy + S * 0.1)
    if (e > 0.01) {
      if (ph > 0.08 && ph < 0.85) {
        const q = (ph - 0.08) / 0.77
        ctx.beginPath()
        ctx.arc(px, py, S * (0.03 + 0.13 * q), 0, TAU)
        ctx.strokeStyle = rgba(P.acc, (1 - q) * e)
        ctx.lineWidth = L * 0.6
        ctx.stroke()
      }
      const k = (press * S) / 100
      ctx.save()
      ctx.translate(px, py)
      ctx.scale(k, k)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, 22)
      ctx.lineTo(6, 17)
      ctx.lineTo(10, 26)
      ctx.lineTo(14, 24)
      ctx.lineTo(10, 15.5)
      ctx.lineTo(17, 15.5)
      ctx.closePath()
      ctx.fillStyle = rgba(ink, e)
      ctx.fill()
      ctx.strokeStyle = P.bg
      ctx.lineWidth = 1.4 / k
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    }
  } else if (tool === 'tile') {
    // A divider splits the face; each eye slides into its own pane.
    ctx.save()
    bodyPath()
    ctx.clip()
    if (e > 0.01) line(cx, cy - (bh / 2) * e, cx, cy + (bh / 2) * e, rgba(P.acc, 0.75), 1.4)
    ctx.restore()
    eyes((s) => {
      const X = cx + s * lerp(ex, S * 0.24)
      if (e > 0.01) {
        ctx.beginPath()
        rr(ctx, X - S * 0.15 * e, ey - S * 0.17 * e, S * 0.3 * e, S * 0.36 * e, S * 0.05)
        ctx.strokeStyle = rgba(ink, 0.5 * e)
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
      pill(X, ey, lerp(ew, ew * 0.85), lerp(eh * bl, eh * 0.75), ink)
    })
  }
  ctx.restore()
}

// Small stroked icons from the same design (the timeline's tool cards). 1 unit = s; round caps.
export type GlyphName = 'app' | 'term' | 'phone' | 'web' | 'file' | 'screen' | 'tile' | 'check' | 'undo' | 'mic' | 'wave' | 'net' | 'caution'

export function glyph(ctx: CanvasRenderingContext2D, g: GlyphName, x: number, y: number, s: number, col: string, lw?: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = col
  ctx.fillStyle = col
  ctx.lineWidth = lw ?? Math.max(1.2, s * 0.09)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  const h = s / 2
  let dotY: number | null = null
  ctx.beginPath()
  if (g === 'app') {
    rr(ctx, -h, -s * 0.4, s, s * 0.8, s * 0.12)
    ctx.moveTo(-h, -s * 0.16)
    ctx.lineTo(h, -s * 0.16)
  } else if (g === 'term') {
    rr(ctx, -h, -s * 0.4, s, s * 0.8, s * 0.12)
    ctx.moveTo(-s * 0.26, -s * 0.12)
    ctx.lineTo(-s * 0.08, s * 0.02)
    ctx.lineTo(-s * 0.26, s * 0.16)
    ctx.moveTo(s * 0.02, s * 0.16)
    ctx.lineTo(s * 0.24, s * 0.16)
  } else if (g === 'phone') {
    rr(ctx, -s * 0.28, -h, s * 0.56, s, s * 0.12)
    ctx.moveTo(-s * 0.07, s * 0.34)
    ctx.lineTo(s * 0.07, s * 0.34)
  } else if (g === 'web') {
    ctx.arc(0, 0, h * 0.95, 0, TAU)
    ctx.moveTo(h * 0.42, 0)
    ctx.ellipse(0, 0, h * 0.42, h * 0.95, 0, 0, TAU)
    ctx.moveTo(-h * 0.95, 0)
    ctx.lineTo(h * 0.95, 0)
  } else if (g === 'file') {
    ctx.moveTo(-h, -s * 0.34)
    ctx.lineTo(-s * 0.12, -s * 0.34)
    ctx.lineTo(0, -s * 0.22)
    ctx.lineTo(h, -s * 0.22)
    ctx.lineTo(h, s * 0.36)
    ctx.lineTo(-h, s * 0.36)
    ctx.closePath()
  } else if (g === 'screen') {
    rr(ctx, -h, -s * 0.38, s, s * 0.76, s * 0.1)
    ctx.moveTo(s * 0.14, 0)
    ctx.arc(0, 0, s * 0.14, 0, TAU)
  } else if (g === 'tile') {
    rr(ctx, -h, -s * 0.4, s, s * 0.8, s * 0.1)
    ctx.moveTo(0, -s * 0.4)
    ctx.lineTo(0, s * 0.4)
  } else if (g === 'check') {
    ctx.moveTo(-s * 0.36, s * 0.02)
    ctx.lineTo(-s * 0.1, s * 0.27)
    ctx.lineTo(s * 0.38, -s * 0.26)
  } else if (g === 'undo') {
    ctx.arc(s * 0.04, s * 0.06, s * 0.32, Math.PI, Math.PI * 2.35)
    ctx.moveTo(-s * 0.44, -s * 0.1)
    ctx.lineTo(-s * 0.28, s * 0.07)
    ctx.lineTo(-s * 0.1, -s * 0.08)
  } else if (g === 'mic') {
    rr(ctx, -s * 0.15, -h, s * 0.3, s * 0.6, s * 0.15)
    ctx.moveTo(s * 0.32, -s * 0.04)
    ctx.arc(0, -s * 0.04, s * 0.32, 0, Math.PI)
    ctx.moveTo(0, s * 0.28)
    ctx.lineTo(0, h)
  } else if (g === 'wave') {
    for (const [px, ph] of [
      [-0.33, 0.25],
      [-0.11, 0.7],
      [0.11, 0.48],
      [0.33, 0.22]
    ]) {
      ctx.moveTo(px * s, -ph * h)
      ctx.lineTo(px * s, ph * h)
    }
  } else if (g === 'net') {
    for (const r of [0.2, 0.4, 0.6]) {
      ctx.moveTo(Math.cos(-0.75 * Math.PI) * r * s, s * 0.32 + Math.sin(-0.75 * Math.PI) * r * s)
      ctx.arc(0, s * 0.32, r * s, -0.75 * Math.PI, -0.25 * Math.PI)
    }
    dotY = s * 0.32
  } else if (g === 'caution') {
    ctx.moveTo(0, -h * 0.9)
    ctx.lineTo(h, h * 0.8)
    ctx.lineTo(-h, h * 0.8)
    ctx.closePath()
    ctx.moveTo(0, -s * 0.12)
    ctx.lineTo(0, s * 0.12)
    dotY = s * 0.27
  }
  ctx.stroke()
  if (dotY !== null) {
    ctx.beginPath()
    ctx.arc(0, dotY, ctx.lineWidth * 0.75, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}
