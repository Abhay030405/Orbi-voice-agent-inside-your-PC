// The CONFIRMATION WINDOW: our own small window that asks "Allow?" before a risky action.
// It replaced the plain Windows message box (Abhay, 2026-10-19: "it isn't our good-looking UI").
//
// The box was chosen because no page of ours could click it. This window keeps that property:
//   - only THIS window's answer is believed: main checks which page sent it, and that it answers the
//     question on screen right now (a stale or made-up id is ignored);
//   - the AI's own hands refuse Dreamwalker's windows: pc_click, pc_type and press_keys check the window
//     under the pointer / in front and won't act on our process (hands/pcinput.ts, hands/keys.ts);
//   - it loads one local page, can't navigate or open windows, and is hidden from screenshots;
//   - closing it, Esc, or no answer in time = no. The Deny button has the focus, so Enter = no.

import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { IPC, type ConfirmView } from '../../shared/ipc'

const WIDTH = 460
const MIN_HEIGHT = 220
const MAX_HEIGHT = 640

type Pending = { id: number; resolve: (answer: 'yes' | 'no') => void }

export class ConfirmWindow {
  private win: BrowserWindow | null = null
  private pending: Pending | null = null
  private nextId = 1

  constructor() {
    ipcMain.on(IPC.confirmAnswer, (event, id: unknown, answer: unknown) => {
      if (!this.win || this.win.isDestroyed() || event.sender.id !== this.win.webContents.id) return
      if (!this.pending || id !== this.pending.id || (answer !== 'yes' && answer !== 'no')) return
      this.settle(answer)
    })
    ipcMain.on(IPC.confirmSize, (event, height: unknown) => {
      if (!this.win || this.win.isDestroyed() || event.sender.id !== this.win.webContents.id) return
      if (typeof height !== 'number' || !Number.isFinite(height)) return
      const h = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
      const b = this.win.getBounds()
      // Grow/shrink around the same centre, so it doesn't jump.
      this.win.setBounds({ x: b.x, y: Math.round(b.y + (b.height - h) / 2), width: WIDTH, height: h })
    })
  }

  // Show one question; resolves with the answer (closing the window = no). Rejects if the page can't
  // load, so the caller can fall back to the plain Windows box instead of silently saying no.
  ask(view: Omit<ConfirmView, 'id'>, background: string): Promise<'yes' | 'no'> {
    this.settle('no') // only one question at a time; never leave an old one open
    const id = this.nextId++
    const win = this.create(background)
    const full: ConfirmView = { ...view, id }
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve }
      win.webContents.once('did-fail-load', (_e, code, why) => {
        if (this.pending?.id !== id) return
        this.pending = null
        if (!win.isDestroyed()) win.destroy()
        reject(new Error(`confirmation page failed to load (${code} ${why})`))
      })
      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return
        win.webContents.send(IPC.confirmShow, full)
        win.show()
        win.moveTop()
        win.focus()
        // Windows may refuse to hand focus to us (another app is in front): flash the taskbar button.
        if (!win.isFocused()) win.flashFrame(true)
      })
    })
  }

  // The voice answered, or the time ran out: close it.
  close(): void {
    this.settle('no')
  }

  focus(): boolean {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return false
    this.win.show()
    this.win.focus()
    return true
  }

  private settle(answer: 'yes' | 'no'): void {
    const p = this.pending
    this.pending = null
    p?.resolve(answer)
    // Destroy rather than hide: a hidden page would keep its face animating all day.
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private create(background: string): BrowserWindow {
    const area = screen.getPrimaryDisplay().workArea
    const height = 300
    const win = new BrowserWindow({
      width: WIDTH,
      height,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      title: 'Dreamwalker needs your OK', // index.ts CONFIRM_TITLE: Home's "Review" finds it by this
      backgroundColor: background,
      webPreferences: {
        preload: join(__dirname, '../preload/confirm.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // 'screen-saver' is the top level: 'floating' sat under full-screen apps (a full-screen YouTube or
    // browser), so the question was hidden and Orbi seemed not to answer (2026-10-27).
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setContentProtection(true) // not in screenshots, so the AI never sees (or aims at) it
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        const p = this.pending
        this.pending = null
        p?.resolve('no')
      }
    })
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/confirm.html`)
    else void win.loadFile(join(__dirname, '../renderer/confirm.html'))
    this.win = win
    return win
  }
}
