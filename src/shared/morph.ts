// Which picture a tool gets: the face's "tool morph" (main/presence.ts) and the timeline card's icon
// (renderer) both use this, so they always agree. A plain table: no Node, no DOM.

import type { FaceTool } from './ipc'

const MORPH: Record<string, FaceTool> = {
  open_app: 'app',
  close_app: 'app',
  focus_window: 'app',
  list_windows: 'app',
  run_command: 'term',
  open_terminal: 'term',
  start_task: 'term',
  web_search: 'web',
  open_url: 'web',
  list_folder: 'file',
  open_file: 'file',
  create_text_file: 'file',
  create_folder: 'file',
  move_file: 'file',
  delete_file: 'file',
  read_document: 'file',
  read_text_file: 'file',
  read_clipboard: 'file',
  write_clipboard: 'file',
  take_screenshot: 'screen',
  press_keys: 'click',
  pc_click: 'click',
  pc_type: 'click',
  pc_scroll: 'click',
  pc_ui_elements: 'screen'
}

// Tools without a fitting picture (time, volume...) return null: the face shows "thinking" while they run.
export const morphFor = (tool: string): FaceTool | null => MORPH[tool] ?? (tool.startsWith('phone_') ? 'phone' : null)
