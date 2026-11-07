// The EDGE GLOW window: a transparent, full-screen, click-through window that lights the screen edges
// while the agent is active. Guide: docs/build-log/06-edge-glow.md.

import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC, type AgentState, type Theme } from '../shared/ipc'

const FADE_MS = 400 // matches the CSS opacity transition, so we hide only after it has faded out

export class EdgeGlow {
  private win: BrowserWindow | null = null
  private state: AgentState = 'idle'
  private theme: Theme = 'graphite'
  private enabled = true
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.hideNow()
    else this.setState(this.state)
  }

  setState(state: AgentState): void {
    this.state = state
    if (!this.enabled) return
    const win = this.ensureWindow()
    win.webContents.send(IPC.overlayState, state) // ensureWindow() never returns a destroyed one

    if (state === 'idle') {
      // Let the glow fade out first, then take the window off screen so it costs nothing.
      this.hideTimer ??= setTimeout(() => this.hideNow(), FADE_MS)
    } else {
      if (this.hideTimer) clearTimeout(this.hideTimer)
      this.hideTimer = null
      if (!win.isVisible()) win.showInactive() // show WITHOUT taking focus from the user's app
    }
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.overlayTheme, theme)
  }

  setLevel(level: number): void {
    if (this.win && !this.win.isDestroyed() && this.enabled && this.state !== 'idle') {
      this.win.webContents.send(IPC.overlayLevel, level)
    }
  }

  destroy(): void {
    this.win?.destroy()
    this.win = null
  }

  private hideNow(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    // Cover the whole primary screen, taskbar included. (Multi-monitor: follow the active screen, M6.)
    const { bounds } = screen.getPrimaryDisplay()
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true, // only what we draw is visible
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false,
      focusable: false, // can never take keyboard focus away from what the user is doing
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'), // can only RECEIVE state + level
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false // keep animating even though this window is never "focused"
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver') // above normal windows, even full-screen ones
    win.setIgnoreMouseEvents(true) // every click goes straight through to the app underneath
    // Hidden from screenshots and screen recording (Windows "exclude from capture"), so when the
    // agent looks at the screen (B5, C1) it never sees its own glow.
    win.setContentProtection(true)

    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
    else win.loadFile(join(__dirname, '../renderer/overlay.html'))

    // If the page reloads, re-send the current state (it only listens; it can't ask).
    win.webContents.on('did-finish-load', () => {
      win.webContents.send(IPC.overlayTheme, this.theme)
      win.webContents.send(IPC.overlayState, this.state)
    })
    win.on('closed', () => (this.win = null)) // recreated next time it's needed
    this.win = win
    return win
  }
}
