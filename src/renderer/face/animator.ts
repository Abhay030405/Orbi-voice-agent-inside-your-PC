// FACE ANIMATOR: turns "the state is now X" into smooth frames for drawFace().
// Rules from the designer's mascot guide (docs/build-log/09-ui.md):
//   - A tool pose is a morph from the resting eyes: ent 0 → 1 over 450 ms (ease-out cubic), and back.
//   - Leaving a tool, or switching tool → tool: morph OUT to the resting eyes first, then go on.
//   - We always finish the morph IN before going out, so a 50 ms tool still shows a readable pose
//     instead of a twitch.
//   - Voice levels rise fast (30 ms) and fall slowly (120 ms), like a VU meter.
//   - Reduced motion: no clock, fixed level 0.55, morphs jump. State changes still show: they're
//     information, not decoration.

import type { FaceState, FaceTool } from '../../shared/ipc'
import { easeOutCubic, type FaceFrame } from './drawFace'

const MORPH_S = 0.45

export class FaceAnimator {
  private shown: FaceState = 'idle'
  private tool: FaceTool | null = null
  private pending: { face: FaceState; tool: FaceTool | null } | null = null
  private morph = 0
  private target = 0
  private caution = false
  private aU = 0
  private aA = 0
  reducedMotion = false
  onChange: (() => void) | null = null // the loop listens, to redraw at once instead of at its next tick
  private pet = 0
  private petTarget = 0
  private gaze = { x: 0, y: 0 }
  private gazeTarget = { x: 0, y: 0 }

  // Pointer over the companion = being petted.
  setPet(on: boolean): void {
    this.petTarget = on ? 1 : 0
    this.onChange?.()
  }

  // Where to look, -1..1 each way (0, 0 = straight ahead).
  setGaze(x: number, y: number): void {
    this.gazeTarget = { x, y }
    this.onChange?.()
  }

  set(face: FaceState, tool: FaceTool | null, caution: boolean): void {
    this.caution = caution
    this.onChange?.()
    if (this.shown === 'acting') {
      if (face === 'acting' && tool === this.tool) {
        this.pending = null // came back to the same tool before we left: stay
        this.target = 1
        return
      }
      this.pending = { face, tool } // morph out first (see step)
      return
    }
    this.enter(face, tool)
  }

  // True while something is moving fast (a morph, a voice): the loop then runs at full speed.
  get busy(): boolean {
    const settling = this.pet !== this.petTarget || this.gaze.x !== this.gazeTarget.x || this.gaze.y !== this.gazeTarget.y
    return settling || this.pet > 0 || this.morph !== this.target || this.pending !== null || this.shown === 'listening' || this.shown === 'speaking' || this.shown === 'acting' || this.shown === 'thinking' || this.shown === 'confirm'
  }

  get state(): FaceState {
    return this.shown
  }

  step(dt: number, level: number): void {
    if (this.reducedMotion) {
      if (this.pending) this.enter(this.pending.face, this.pending.tool)
      this.morph = this.target
    } else {
      // Finish the morph in before starting out.
      if (this.pending && this.target === 1 && this.morph >= 1) this.target = 0
      const delta = dt / MORPH_S
      this.morph = this.target > this.morph ? Math.min(this.target, this.morph + delta) : Math.max(this.target, this.morph - delta)
      if (this.pending && this.target === 0 && this.morph === 0) this.enter(this.pending.face, this.pending.tool)
    }
    // Petting eases in/out over ~250 ms; the eyes follow the gaze target quickly but smoothly.
    this.pet = approach(this.pet, this.petTarget, dt / 0.25)
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt / 0.08)
    this.gaze.x = settle(this.gaze.x + (this.gazeTarget.x - this.gaze.x) * k, this.gazeTarget.x)
    this.gaze.y = settle(this.gaze.y + (this.gazeTarget.y - this.gaze.y) * k, this.gazeTarget.y)
    // Only the active side follows the level; the other decays to 0.
    const u = this.shown === 'listening' ? level : 0
    const a = this.shown === 'speaking' ? level : 0
    this.aU = smooth(this.aU, u, dt)
    this.aA = smooth(this.aA, a, dt)
  }

  frame(t: number, progress: number | null = null): FaceFrame {
    const still = this.reducedMotion
    return {
      t: still ? 0 : t,
      st: this.shown,
      tool: this.tool,
      ent: easeOutCubic(this.morph),
      aU: still && this.shown === 'listening' ? 0.55 : this.aU,
      aA: still && this.shown === 'speaking' ? 0.55 : this.aA,
      caution: this.caution,
      progress,
      gx: this.gaze.x,
      gy: this.gaze.y,
      pet: this.reducedMotion ? this.petTarget : this.pet
    }
  }

  private enter(face: FaceState, tool: FaceTool | null): void {
    this.pending = null
    this.shown = face
    this.tool = face === 'acting' ? tool : null
    this.target = face === 'acting' ? 1 : 0
    if (face === 'acting') this.morph = 0 // every tool pose starts from the resting eyes
  }
}

function smooth(current: number, target: number, dt: number): number {
  const tau = target > current ? 0.03 : 0.12
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

function approach(v: number, target: number, step: number): number {
  return target > v ? Math.min(target, v + step) : Math.max(target, v - step)
}
const settle = (v: number, target: number): number => (Math.abs(v - target) < 0.002 ? target : v)
