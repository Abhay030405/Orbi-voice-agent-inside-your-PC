// User settings, saved as JSON in Electron's per-user data folder
// (Windows: %APPDATA%\dreamwalker\settings.json). Survives restarts.

import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings, Theme, ToolPolicy } from '../shared/ipc'

export const DEFAULT_SETTINGS: Settings = {
  agentName: 'Orbi',
  wakeWordEnabled: true,
  // Off by default: on loud speakers it heard its own voice and answered itself (live demo, 2026-10-20).
  // Off, you interrupt by saying its name (brain.ts), which can't be fooled by its own voice.
  voiceBargeIn: false,
  edgeGlow: true,
  companion: true,
  theme: 'graphite',
  userName: '',
  memory: true, // Abhay asked for it on (2026-10-19); the setting explains what it sends
  permissions: {}
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

// The file is outside our control (a user could edit it, or it could be from an older version), so
// keep only known keys with the right types and fall back to defaults for the rest.
function sanitize(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    agentName: typeof r.agentName === 'string' ? r.agentName : DEFAULT_SETTINGS.agentName,
    wakeWordEnabled:
      typeof r.wakeWordEnabled === 'boolean' ? r.wakeWordEnabled : DEFAULT_SETTINGS.wakeWordEnabled,
    voiceBargeIn: typeof r.voiceBargeIn === 'boolean' ? r.voiceBargeIn : DEFAULT_SETTINGS.voiceBargeIn,
    edgeGlow: typeof r.edgeGlow === 'boolean' ? r.edgeGlow : DEFAULT_SETTINGS.edgeGlow,
    companion: typeof r.companion === 'boolean' ? r.companion : DEFAULT_SETTINGS.companion,
    theme: isTheme(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    memory: typeof r.memory === 'boolean' ? r.memory : DEFAULT_SETTINGS.memory,
    userName: typeof r.userName === 'string' && validUserName(r.userName) ? r.userName.trim() : DEFAULT_SETTINGS.userName,
    permissions: sanitizePermissions(r.permissions)
  }
}

export const isTheme = (value: unknown): value is Theme => value === 'graphite' || value === 'ember'

const POLICIES: readonly string[] = ['allow', 'ask', 'deny']

// Keep only `toolName: 'allow' | 'ask' | 'deny'` pairs; drop anything else.
export function sanitizePermissions(raw: unknown): Record<string, ToolPolicy> {
  const out: Record<string, ToolPolicy> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [tool, policy] of Object.entries(raw)) {
    if (/^[a-z_]{1,40}$/.test(tool) && typeof policy === 'string' && POLICIES.includes(policy)) {
      out[tool] = policy as ToolPolicy
    }
  }
  return out
}

export function loadSettings(): Settings {
  try {
    return sanitize(JSON.parse(readFileSync(file(), 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS } // first run, or an unreadable file
  }
}

// Atomic write: write a temp file, then rename it over the real one. A rename on the same disk
// happens all at once, so a crash or power cut mid-save leaves either the old settings or the new
// ones, never half a JSON file. (The Ledger in M2 needs the same guarantee, done by SQLite.)
export function saveSettings(settings: Settings): void {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2))
  renameSync(tmp, file())
}

// The wake word is always "Hey <name>". A name: 1–2 words of letters, 2–20 characters each.
export function validAgentName(name: string): boolean {
  return /^[A-Za-z']{2,20}( [A-Za-z']{2,20})?$/.test(name.trim())
}

// Your name, for the greeting: optional, up to 30 letters/spaces/'-.
export const validUserName = (name: string): boolean => /^[\p{L}' .-]{0,30}$/u.test(name.trim())

export const wakePhraseFor = (agentName: string): string => `Hey ${agentName.trim()}`
