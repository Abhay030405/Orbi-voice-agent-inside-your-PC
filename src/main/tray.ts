// SYSTEM TRAY: the icon by the clock. Its colour follows the agent's state, and its menu is the same
// menu the companion shows on right-click. Closing the main window hides it; Dreamwalker keeps
// running (and listening) in the tray, like Discord or WhatsApp. "Quit" is the only real exit.

import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { AgentState, Settings } from '../shared/ipc'
import { trayIconPng } from './trayIcon'

export interface TrayActions {
  showMain(): void
  startTalking(): void
  getSettings(): Settings
  isMuted(): boolean
  setMuted(muted: boolean): void
  setSetting(patch: Partial<Settings>): void
  quit(): void
}

const LABEL: Record<AgentState, string> = {
  idle: 'idle',
  listening: 'listening…',
  thinking: 'thinking…',
  speaking: 'speaking'
}

export class AppTray {
  private tray: Tray | null = null
  private readonly actions: TrayActions

  constructor(actions: TrayActions) {
    this.actions = actions
  }

  create(): void {
    this.tray = new Tray(nativeImage.createFromBuffer(trayIconPng('idle')))
    this.tray.setToolTip(`${this.actions.getSettings().agentName}: idle`)
    this.tray.on('click', () => this.actions.showMain())
    this.refreshMenu()
  }

  setState(state: AgentState): void {
    if (!this.tray) return
    this.tray.setImage(nativeImage.createFromBuffer(trayIconPng(state)))
    this.tray.setToolTip(`${this.actions.getSettings().agentName}: ${LABEL[state]}`)
  }

  // Rebuild after settings change, so the checkboxes match.
  refreshMenu(): void {
    this.tray?.setContextMenu(this.menu())
  }

  // The same menu, for the companion's right-click.
  menu(): Menu {
    const s = this.actions.getSettings()
    const template: MenuItemConstructorOptions[] = [
      { label: `Open ${s.agentName}`, click: () => this.actions.showMain() },
      { label: 'Start talking', enabled: !this.actions.isMuted(), click: () => this.actions.startTalking() },
      { type: 'separator' },
      {
        label: 'Mute microphone',
        type: 'checkbox',
        checked: this.actions.isMuted(),
        click: (item) => this.actions.setMuted(item.checked)
      },
      {
        label: 'Listen for wake word',
        type: 'checkbox',
        checked: s.wakeWordEnabled,
        click: (item) => this.actions.setSetting({ wakeWordEnabled: item.checked })
      },
      {
        label: 'Edge glow',
        type: 'checkbox',
        checked: s.edgeGlow,
        click: (item) => this.actions.setSetting({ edgeGlow: item.checked })
      },
      {
        label: 'Floating companion',
        type: 'checkbox',
        checked: s.companion,
        click: (item) => this.actions.setSetting({ companion: item.checked })
      },
      { type: 'separator' },
      { label: 'Quit', click: () => this.actions.quit() }
    ]
    return Menu.buildFromTemplate(template)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
