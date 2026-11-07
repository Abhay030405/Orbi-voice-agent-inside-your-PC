// NAVIGATION (design v2): 6 sections, some with sub-tabs. The app opens on Home.
// The last sub-tab used in each section is remembered on this computer (a convenience only: if the
// storage is unavailable, each section just opens on its first sub-tab).

export type Section = 'home' | 'activity' | 'automations' | 'phone' | 'safety' | 'settings'
export type Sub =
  | 'session'
  | 'ledger'
  | 'tasks'
  | 'routines'
  | 'watcher'
  | 'permissions'
  | 'privacy'
  | 'general'
  | 'diagnostics'

export interface Route {
  section: Section
  sub: Sub | null
}

export const SECTIONS: Array<{ id: Section; label: string; subs: Array<{ id: Sub; label: string }> }> = [
  { id: 'home', label: 'Home', subs: [] },
  {
    id: 'activity',
    label: 'Activity',
    subs: [
      { id: 'session', label: 'Session' },
      { id: 'ledger', label: 'Ledger' },
      { id: 'tasks', label: 'Tasks' }
    ]
  },
  {
    id: 'automations',
    label: 'Automations',
    subs: [
      { id: 'routines', label: 'Routines' },
      { id: 'watcher', label: 'Watcher' }
    ]
  },
  { id: 'phone', label: 'Phone', subs: [] },
  {
    id: 'safety',
    label: 'Safety',
    subs: [
      { id: 'permissions', label: 'Permissions' },
      { id: 'privacy', label: 'Privacy & Safety' }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    subs: [
      { id: 'general', label: 'Settings' },
      { id: 'diagnostics', label: 'Diagnostics' }
    ]
  }
]

const KEY = 'dreamwalker.lastSubTab'

function remembered(): Partial<Record<Section, Sub>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<Section, Sub>>
  } catch {
    return {}
  }
}

// Where clicking a section goes: its remembered sub-tab, else its first.
export function routeFor(section: Section, sub?: Sub): Route {
  const s = SECTIONS.find((x) => x.id === section)!
  if (s.subs.length === 0) return { section, sub: null }
  const wanted = sub ?? remembered()[section]
  return { section, sub: s.subs.some((x) => x.id === wanted) ? wanted! : s.subs[0].id }
}

export function remember(route: Route): void {
  if (!route.sub) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), [route.section]: route.sub }))
  } catch {
    // no storage: fine, it just won't remember
  }
}

// Every place you can go, for the Ctrl K palette.
export function destinations(): Array<{ route: Route; label: string }> {
  return SECTIONS.flatMap((s): Array<{ route: Route; label: string }> =>
    s.subs.length === 0
      ? [{ route: { section: s.id, sub: null }, label: s.label }]
      : s.subs.map((sub) => ({ route: { section: s.id, sub: sub.id }, label: `${s.label} → ${sub.label}` }))
  )
}
