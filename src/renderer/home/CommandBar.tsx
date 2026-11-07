// The command bar at the bottom of the timeline: type a request, or hold the button / Space to talk.
// voice-glow (a library, see README) draws a glow along its bottom edge that follows the voice: yours
// while listening, Dreamwalker's while speaking. It reads OUR level getter; it never opens the mic
// itself (one microphone, owned by audio/ear.ts).

import { useEffect, useState } from 'react'
import { VoiceBeam } from 'voice-glow'
import type { Theme } from '../../shared/ipc'
import { Glyph } from '../ui/Glyph'
import type { Levels } from './levels'
import { useWindowVisible } from '../visibility'

export interface CommandBarProps {
  theme: Theme
  levels: Levels
  talking: boolean
  micLabel: string
  disabled: boolean // muted: push-to-talk is off
  voiceLive: boolean // listening or speaking: the only times the glow has something to show
  // timeline: floating over the Session timeline · hero: Home's big bar · compact: inside a card (Home
  // while a confirmation is pending). Same behaviour, different size.
  variant?: 'timeline' | 'hero' | 'compact'
  onSend(text: string): void
  onTalkStart(): void
  onTalkStop(): void
  onStop?(): void // shown while it thinks or speaks: silence the answer now
}

const PLACEHOLDER = {
  timeline: 'Type a command, or hold Space to talk',
  hero: 'Ask or tell it anything',
  compact: 'Type, or hold Space'
}

export function CommandBar(props: CommandBarProps) {
  const variant = props.variant ?? 'timeline'
  const [text, setText] = useState('')
  const visible = useWindowVisible()
  // Keep it running 1.5 s after the voice stops, so the glow fades out instead of freezing mid-glow.
  const [glowing, setGlowing] = useState(props.voiceLive)
  useEffect(() => {
    if (props.voiceLive) {
      setGlowing(true)
      return
    }
    const t = setTimeout(() => setGlowing(false), 1500)
    return () => clearTimeout(t)
  }, [props.voiceLive])
  return (
    <div className={`command-wrap command-${variant}`}>
      <VoiceBeam
        level={props.levels.active}
        colorVariant={props.theme === 'graphite' ? 'ice' : 'forest'}
        theme="dark"
        borderRadius={variant === 'compact' ? 10 : 12}
        paused={!visible || !glowing}
        className="command-beam"
      >
        <form
          className="command"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim() === '') return
            props.onSend(text)
            setText('')
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER[variant]}
            aria-label="Command"
            maxLength={2000}
          />
          {variant === 'timeline' && <code className="command-mic">{props.micLabel}</code>}
          {variant !== 'compact' && !props.onStop && <kbd>{variant === 'hero' ? 'hold Space' : 'Space'}</kbd>}
          {props.onStop && (
            <button type="button" className="stop-btn" onClick={props.onStop} aria-label="Stop" title="Stop the answer (Ctrl+Shift+Space)">
              <span className="stop-square" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={`ptt ${props.talking ? 'ptt-on' : ''}`}
            disabled={props.disabled}
            aria-label={props.talking ? 'Release to send' : 'Hold to talk'}
            title={props.disabled ? 'Muted' : 'Hold to talk'}
            onPointerDown={props.onTalkStart}
            onPointerUp={props.onTalkStop}
            onPointerLeave={props.onTalkStop}
          >
            <Glyph name="mic" size={variant === 'compact' ? 13 : 16} theme={props.theme} />
          </button>
        </form>
      </VoiceBeam>
    </div>
  )
}
