// The tool registry: the one list of everything Dreamwalker can do.
// Add a tool = write it (same shape as system.ts) and add it to BUILT_IN (or registerTools() it at
// startup if it needs something that only exists then, like the Ledger). Nothing else changes.

import { Behavior, type FunctionDeclaration } from '@google/genai'
import { CLIPBOARD_TOOLS } from './clipboard'
import { DOCUMENT_TOOLS } from './documents'
import { FILE_TOOLS } from './files'
import { KEY_TOOLS } from './keys'
import { createDocument } from './office'
import { pcTools } from './pc'
import { SCREEN_TOOLS } from './screen'
import { SHELL_TOOLS } from './shell'
import { SYSTEM_TOOLS } from './system'
import type { Tool } from './tool'
import { WEB_TOOLS } from './web'
import { playYoutube } from './youtube'
import { getWeather } from './weather'
import { GOOGLE_TOOLS } from '../google/tools'

const BUILT_IN: Tool[] = [
  ...SYSTEM_TOOLS,
  ...KEY_TOOLS,
  ...pcTools(),
  ...CLIPBOARD_TOOLS,
  ...FILE_TOOLS,
  createDocument,
  ...DOCUMENT_TOOLS,
  ...SHELL_TOOLS,
  ...SCREEN_TOOLS,
  ...WEB_TOOLS,
  playYoutube,
  getWeather,
  ...GOOGLE_TOOLS
]

const byName = new Map(BUILT_IN.map((tool) => [tool.name, tool]))

export function registerTools(tools: Tool[]): void {
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Two tools are called ${tool.name}`)
    byName.set(tool.name, tool)
  }
}

export function findTool(name: string): Tool | undefined {
  return byName.get(name)
}

export function allTools(): Tool[] {
  return [...byName.values()]
}

// The "menu" we hand Gemini at connect time: name + description + parameters, nothing else.
// Gemini never sees `run`, `risk` or `undo`. It only knows what each tool is for and what to send.
export function toolDeclarations(): FunctionDeclaration[] {
  return allTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
    ...(tool.background ? { behavior: Behavior.NON_BLOCKING } : {})
  }))
}
