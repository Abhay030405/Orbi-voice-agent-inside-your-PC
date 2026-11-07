// CONFIRMATION WINDOW page: shows one question and sends one answer (main/gatekeeper/confirmWindow.ts).
// Deny has the focus, so Enter = no; Esc = no; the bar at the bottom shows the time left (then: no).

import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../theme.css'
import './confirm.css'
import type { ConfirmView } from '../../shared/ipc'
import { FaceAnimator } from '../face/animator'
import { startFaceLoop } from '../face/loop'

const api = window.dreamwalkerConfirm
const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!

const animator = new FaceAnimator()
let theme: ConfirmView['theme'] = 'graphite'
startFaceLoop({ canvas: $<HTMLCanvasElement>('.face'), animator, theme: () => theme })

let current: ConfirmView | null = null
let answered = false

function answer(a: 'yes' | 'no'): void {
  if (!current || answered) return
  answered = true
  document.body.classList.add('leaving')
  api.answer(current.id, a)
}

api.onShow((view) => {
  current = view
  answered = false
  theme = view.theme
  document.documentElement.dataset.theme = view.theme
  const danger = view.irreversible
  document.body.classList.toggle('danger', danger)
  animator.set(danger ? 'danger' : 'confirm', null, false)

  $('#title').textContent = `${view.agentName} needs your OK`
  const tool = $('.tool')
  tool.hidden = !view.tool
  tool.textContent = view.tool ?? ''
  const chip = $('.chip')
  chip.hidden = view.risk !== 'high'
  chip.textContent = danger ? 'Can’t be undone' : 'High risk'

  // The first line is the sentence; the rest is the exact detail (a command, a path), never cut.
  const [first, ...rest] = view.action.split('\n')
  $('.action-line').textContent = first.trim()
  const detail = rest.map((l) => l.trim()).filter(Boolean).join('\n')
  const pre = $('.action-detail')
  pre.hidden = !detail
  pre.textContent = detail

  $('.fact-undo').textContent = view.undoable
    ? '↩  Can be undone afterwards: “undo that”.'
    : danger
      ? '⚠  This can’t be undone.'
      : '○  Nothing permanent: there’s nothing to undo.'
  $('.fact-why').textContent = `Asking because ${view.reason}.`
  const note = $('.fact-note')
  note.hidden = !view.note
  note.textContent = view.note ?? ''

  $('.btn-allow').textContent = danger ? 'Allow anyway' : 'Allow'
  const bar = $('.timer-bar')
  bar.style.animation = 'none'
  void bar.offsetWidth // restart the countdown
  bar.style.animation = `countdown ${view.timeoutMs}ms linear forwards`

  requestAnimationFrame(() => {
    api.fit(document.querySelector('.card')!.getBoundingClientRect().height)
    $('.btn-deny').focus() // Enter = Deny: the safe choice is the default
  })
})

$('.btn-allow').addEventListener('click', () => answer('yes'))
$('.btn-deny').addEventListener('click', () => answer('no'))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') answer('no')
})
