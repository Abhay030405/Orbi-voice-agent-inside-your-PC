// Tells TypeScript that `window.dreamwalker` exists and has the DreamwalkerApi shape.
// The preload creates it at runtime; this file only describes it for the compiler.
import type { CompanionApi, ConfirmApi, DreamwalkerApi, OverlayApi } from '../shared/ipc'

declare global {
  interface Window {
    dreamwalker: DreamwalkerApi // main window only
    dreamwalkerOverlay: OverlayApi // edge-glow window only
    dreamwalkerCompanion: CompanionApi // companion orb window only
    dreamwalkerConfirm: ConfirmApi // confirmation window only
  }
}

export {}
