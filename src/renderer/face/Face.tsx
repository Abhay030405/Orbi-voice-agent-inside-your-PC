// <Face>: the companion face as a React component, for the title bar and the status cell.
// The loop lives outside React (refs, not state): a frame 60 times a second must not re-render.

import { useEffect, useRef } from 'react'
import type { Presence } from '../../shared/ipc'
import { FaceAnimator } from './animator'
import { startFaceLoop } from './loop'
import { windowVisible } from '../visibility'

export function Face(props: { presence: Presence; size: number; level?: () => number; className?: string; followCursor?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animator = useRef(new FaceAnimator()).current
  // The loop reads these through refs, so new props reach it without restarting it.
  const presenceRef = useRef(props.presence)
  presenceRef.current = props.presence
  const levelRef = useRef(props.level)
  levelRef.current = props.level

  useEffect(() => {
    animator.set(props.presence.face, props.presence.tool, props.presence.caution)
  }, [animator, props.presence.face, props.presence.tool, props.presence.caution])

  // Eyes follow the cursor (Home's big face). Looks fully sideways at ~500 px away; straight ahead when
  // the pointer leaves the window.
  useEffect(() => {
    if (!props.followCursor) return
    const move = (e: MouseEvent): void => {
      const r = canvasRef.current?.getBoundingClientRect()
      if (!r) return
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      const d = Math.hypot(dx, dy)
      const reach = Math.min(1, d / 500)
      animator.setGaze(d ? (dx / d) * reach : 0, d ? (dy / d) * reach : 0)
    }
    const away = (): void => animator.setGaze(0, 0)
    window.addEventListener('mousemove', move)
    document.addEventListener('mouseleave', away)
    return () => {
      window.removeEventListener('mousemove', move)
      document.removeEventListener('mouseleave', away)
      animator.setGaze(0, 0)
    }
  }, [animator, props.followCursor])

  useEffect(() => {
    if (!canvasRef.current) return
    return startFaceLoop({
      canvas: canvasRef.current,
      animator,
      theme: () => presenceRef.current.theme,
      level: () => levelRef.current?.() ?? 0,
      visible: windowVisible
    })
  }, [animator])

  return (
    <canvas
      ref={canvasRef}
      className={props.className}
      style={{ width: props.size, height: props.size }}
      role="img"
      aria-label={props.presence.label}
    />
  )
}
