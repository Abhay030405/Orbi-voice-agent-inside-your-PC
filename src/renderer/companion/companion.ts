// COMPANION: the small always-on-top face. Shows what Dreamwalker is doing at a glance, so you never
// need the big window. Click → open Dreamwalker, drag → move (snaps to edges), right-click → menu,
// hover → the last thing it did. Guide: docs/build-log/09-ui.md.

import '@fontsource-variable/geist'
import './companion.css'
import type { Presence } from '../../shared/ipc'
import { FaceAnimator } from '../face/animator'
import { startFaceLoop } from '../face/loop'

const api = window.dreamwalkerCompanion
const canvas = document.querySelector<HTMLCanvasElement>('.face')!
const tip = document.querySelector<HTMLDivElement>('.tip')!
const live = document.querySelector<HTMLDivElement>('[aria-live]')!

let presence: Presence | null = null
let level = 0
const animator = new FaceAnimator()

api.onPresence((p) => {
  const urgent = p.face === 'confirm' || p.face === 'danger'
  if (p.label !== presence?.label) {
    // Screen readers: "assertive" (interrupt) only when it needs you; otherwise "polite".
    live.setAttribute('aria-live', urgent ? 'assertive' : 'polite')
    live.textContent = p.label
  }
  presence = p
  animator.set(p.face, p.tool, p.caution)
  tip.dataset.theme = p.theme
  if (!tip.hidden) tip.textContent = tipText()
})
api.onLevel((l) => (level = Math.max(0, Math.min(1, l))))

startFaceLoop({ canvas, animator, theme: () => presence?.theme ?? 'graphite', level: () => level })

// ── Tooltip: what it's doing, or (when idle) the last thing it did ──
function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}
function tipText(): string {
  if (!presence) return 'Dreamwalker'
  const resting = presence.face === 'idle' || presence.face === 'task'
  if (!resting) return presence.label
  if (presence.lastAction) return `${presence.lastAction.text} · ${ago(presence.lastAction.at)}`
  return `${presence.label} · click to open`
}

// ── Hit-testing: the window is click-through except over the face's body ──
// Main ignores the mouse for this window but still forwards moves (setIgnoreMouseEvents forward), so
// we can tell when the pointer is over the body and ask main to start taking clicks.
const BODY_INSET = 0.11 // the body is 78% of the canvas, centred: (1 - 0.78) / 2
function overBody(x: number, y: number): boolean {
  const r = canvas.getBoundingClientRect()
  const inset = r.width * BODY_INSET
  return x >= r.left + inset && x <= r.right - inset && y >= r.top + inset && y <= r.bottom - inset
}
let over = false
function setOver(value: boolean): void {
  if (value === over) return
  over = value
  document.body.classList.toggle('over', value)
  api.hover(value)
  animator.setPet(value) // pointer over it = being petted: happy eyes, a little squish
  tip.hidden = !value
  if (value) tip.textContent = tipText()
}
document.addEventListener('mousemove', (e) => {
  if (!dragging) setOver(overBody(e.clientX, e.clientY))
})
document.addEventListener('mouseleave', () => {
  if (!dragging) setOver(false)
})

// ── Click vs drag ──
// Pointer capture keeps the moves coming even when the pointer runs ahead of the window. We move the
// window by the screen-space distance; a press that moved less than 4 px is a click.
let pressed: { x: number; y: number } | null = null
let lastPos = { x: 0, y: 0 }
let dragging = false
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !over) return
  canvas.setPointerCapture(e.pointerId)
  pressed = { x: e.screenX, y: e.screenY }
  lastPos = { ...pressed }
})
canvas.addEventListener('pointermove', (e) => {
  if (!pressed) return
  if (!dragging && Math.hypot(e.screenX - pressed.x, e.screenY - pressed.y) < 4) return
  if (!dragging) {
    dragging = true
    document.body.classList.add('dragging')
    tip.hidden = true
    animator.setPet(false) // being carried, not petted
  }
  api.drag(e.screenX - lastPos.x, e.screenY - lastPos.y)
  lastPos = { x: e.screenX, y: e.screenY }
})
canvas.addEventListener('pointerup', (e) => {
  if (!pressed) return
  canvas.releasePointerCapture(e.pointerId)
  pressed = null
  if (dragging) {
    dragging = false
    document.body.classList.remove('dragging')
    api.dragEnd()
    setOver(overBody(e.clientX, e.clientY))
  } else {
    api.openMain()
  }
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (over) api.showMenu()
})
