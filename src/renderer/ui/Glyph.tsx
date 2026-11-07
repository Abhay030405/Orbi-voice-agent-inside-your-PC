// <Glyph>: the design's stroked icons (app, term, web, file, check, undo...). Drawn with the same
// geometry as the face (face/drawFace.ts glyph()), in the element's CSS `color`, so a class like
// .verified colours it. Redrawn when the theme or class changes.

import { useLayoutEffect, useRef } from 'react'
import type { Theme } from '../../shared/ipc'
import { morphFor } from '../../shared/morph'
import { glyph, type GlyphName } from '../face/drawFace'

export function Glyph(props: { name: GlyphName; size?: number; className?: string; theme: Theme }) {
  const size = props.size ?? 16
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    glyph(ctx, props.name, size / 2, size / 2, size * 0.78, getComputedStyle(canvas).color)
  }, [props.name, size, props.className, props.theme])
  return (
    <canvas
      ref={ref}
      className={`glyph ${props.className ?? ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}

// The icon for a tool's timeline card: its face morph where it has one.
export function glyphForTool(tool: string): GlyphName {
  const morph = morphFor(tool)
  if (morph === 'click') return 'screen'
  if (morph) return morph
  if (tool.includes('volume')) return 'wave'
  if (tool.includes('undo') || tool.includes('recent_actions')) return 'undo'
  if (tool.includes('task')) return 'term'
  return 'app'
}
