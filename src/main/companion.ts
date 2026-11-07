// The COMPANION window: a small face, always on top, in the bottom-right corner. Its page can only
// receive presence/level and ask for: open the main window, show the menu, stop clicking through, move
// (preload/companion.ts). Guide: docs/build-log/09-ui.md.
//
// The window is bigger than the face (room for the hover tooltip above it) and fully transparent.
// Clicks on the transparent part must reach whatever is underneath, so the window ignores the mouse
// except while the pointer is over the face (the page tells us, see setHover).

import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC, type Presence } from '../shared/ipc'

// Same numbers as companion.css: the face is FACE px, centred at the bottom of a WIDTH × HEIGHT window.
const WIDTH = 260
const HEIGHT = 176
const FACE = 112
const FACE_BOTTOM = 8 // gap under the face
const MARGIN = 20 // distance from the screen edge
const SNAP = 48 // closer than this to an edge after a drag → snap to it

// Where the face sits inside the window.
const faceLeft = (WIDTH - FACE) / 2
const faceTop = HEIGHT - FACE - FACE_BOTTOM

export class Companion {
  private win: BrowserWindow | null = null
  private presence: Presence | null = null

  setVisible(on: boolean): void {
    if (!on) {
      // Destroy rather than hide: a hidden window's page keeps running (backgroundThrottling is off).
      this.destroy()
      return
    }
    const win = this.ensureWindow()
    if (!win.isVisible()) win.showInactive() // appear without stealing focus
  }

  setPresence(presence: Presence): void {
    this.presence = presence
    if (this.alive()) this.win!.webContents.send(IPC.presence, presence)
  }

  setLevel(level: number): void {
    if (this.alive() && this.win!.isVisible()) this.win!.webContents.send(IPC.overlayLevel, level)
  }

  // Over the face: take mouse events (click, drag, right-click). Elsewhere: let them through.
  // `forward: true` still sends us mouse MOVES while ignoring, so the page can tell when the pointer
  // comes back over the face.
  setHover(over: boolean): void {
    if (this.alive()) this.win!.setIgnoreMouseEvents(!over, { forward: true })
  }

  moveBy(dx: number, dy: number): void {
    if (!this.alive()) return
    const [x, y] = this.win!.getPosition()
    this.place(x + dx, y + dy)
  }

  // setBounds with the size every time, not setPosition: on a scaled display (125%, 150%) Electron's
  // setPosition on a transparent window rounds the size up a pixel or two per move (measured: 260 →
  // 281 px after two drags).
  private place(x: number, y: number): void {
    this.win!.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT })
  }

  // After a drag: keep the FACE fully on the screen it's on, and if it's near an edge, snap it to that
  // edge (the window itself may hang off-screen; only its transparent part does).
  snapToEdge(): void {
    if (!this.alive()) return
    const [x, y] = this.win!.getPosition()
    const face = { x: x + faceLeft, y: y + faceTop }
    const area = screen.getDisplayNearestPoint({ x: face.x + FACE / 2, y: face.y + FACE / 2 }).workArea
    const minX = area.x + MARGIN
    const maxX = area.x + area.width - FACE - MARGIN
    const minY = area.y + MARGIN
    const maxY = area.y + area.height - FACE - MARGIN
    let fx = Math.min(Math.max(face.x, minX), maxX)
    let fy = Math.min(Math.max(face.y, minY), maxY)
    if (fx - minX < SNAP) fx = minX
    if (maxX - fx < SNAP) fx = maxX
    if (fy - minY < SNAP) fy = minY
    if (maxY - fy < SNAP) fy = maxY
    this.place(fx - faceLeft, fy - faceTop)
  }

  // For IPC: was this message really sent by the companion window? (Every IPC event says which
  // page sent it. Main should only accept companion messages from the companion itself.)
  owns(senderId: number): boolean {
    return this.alive() && this.win!.webContents.id === senderId
  }

  private alive(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  window(): BrowserWindow | null {
    return this.alive() ? this.win : null
  }

  destroy(): void {
    this.win?.destroy()
    this.win = null
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const area = screen.getPrimaryDisplay().workArea // the screen minus the taskbar
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: Math.round(area.x + area.width - FACE - MARGIN - faceLeft),
      y: Math.round(area.y + area.height - FACE - MARGIN - faceTop),
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false, // clicking it never steals keyboard focus from what you're doing
      webPreferences: {
        preload: join(__dirname, '../preload/companion.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    // 'screen-saver' is the highest level: stays above full-screen-ish apps too.
    win.setAlwaysOnTop(true, 'screen-saver')
    // Like the glow: the agent's own screenshots shouldn't contain its own face.
    win.setContentProtection(true)
    win.setIgnoreMouseEvents(true, { forward: true }) // click-through until the pointer is over the face

    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/companion.html`)
    else win.loadFile(join(__dirname, '../renderer/companion.html'))
    win.webContents.on('did-finish-load', () => {
      if (this.presence) win.webContents.send(IPC.presence, this.presence)
    })
    // If it gets closed somehow (e.g. its page calls window.close()), forget it; it's recreated the
    // next time it's needed. Sending to a destroyed window throws.
    win.on('closed', () => (this.win = null))

    this.win = win
    return win
  }
}
