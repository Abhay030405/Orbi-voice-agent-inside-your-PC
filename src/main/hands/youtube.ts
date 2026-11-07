// PLAY ON YOUTUBE in one step. "Open YouTube and play a lofi video" stopped at the search page ("please
// select a video", live demo 2026-10-20), or took a look-click-confirm round. YouTube's own results page
// lists the videos in order, so: read it, take the top video, open that video's page (it plays itself).

import { openUrl } from './system'
import type { Tool, ToolOutcome, ToolResult } from './tool'

const resultOf = (o: ToolResult | ToolOutcome): ToolResult => ('ok' in o ? (o as ToolResult) : o.result)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// The first video on a YouTube results page: its id and title. Pure, for tests and for the tool.
export function firstVideo(html: string): { id: string; title: string } | null {
  const at = html.search(/"videoRenderer":\{"videoId":"[\w-]{11}"/)
  if (at < 0) return null
  const chunk = html.slice(at, at + 4000)
  const id = /"videoId":"([\w-]{11})"/.exec(chunk)?.[1]
  if (!id) return null
  const title = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(chunk)?.[1] ?? ''
  return { id, title: title.replace(/\\u0026/g, '&').replace(/\\"/g, '"') }
}

// The top video for a search, read from YouTube's own results page (null if offline or blocked).
export async function topVideo(query: string): Promise<{ id: string; title: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000)
    })
    return res.ok ? firstVideo(await res.text()) : null
  } catch {
    return null
  }
}

export const playYoutube: Tool = {
  name: 'play_youtube',
  description:
    'PLAY something on YouTube in one step: `query` = what to play ("lofi hip hop", "Arijit Singh latest song"). ' +
    'Only when the user asks to play; for "search YouTube for X" open the results page with open_url instead. ' +
    'It finds the top result and opens that video, which starts playing. `browser` optional (chrome, edge...). ' +
    'Use it instead of searching and clicking, also for "play the first video" when YouTube results are open: ' +
    'pass that search and tab: "current". Not for a video the user points at on screen ("click on it"): click ' +
    'that one with pc_ui_elements + pc_click. Its `url` is the exact video (give it to phone_youtube for "on my phone too").',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      browser: { type: 'string', enum: ['default', 'chrome', 'edge', 'firefox', 'brave'] },
      incognito: { type: 'boolean' },
      tab: { type: 'string', enum: ['new', 'current'], description: '"current" plays it in the browser window the user sees' }
    },
    required: ['query']
  },
  risk: 'low',
  effect: 'write',
  untrustedOutput: true, // the video title is written by whoever uploaded it
  describe: (args) => `Play the top YouTube result for "${str(args.query).slice(0, 80)}"`,
  async run(args) {
    const query = str(args.query)
    if (!query) return { ok: false, error: 'What should I play?' }
    const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    const video = await topVideo(query) // null: offline or blocked, so the search page below
    if (!video) {
      const r = resultOf(await openUrl.run({ url: search, browser: args.browser, incognito: args.incognito, tab: args.tab }))
      return r.ok ? { ok: true, opened: search, note: "Couldn't read the results, so I opened the search page; the user has to pick a video." } : r
    }
    const url = `https://www.youtube.com/watch?v=${video.id}`
    const r = resultOf(await openUrl.run({ url, browser: args.browser, incognito: args.incognito, tab: args.tab }))
    if (!r.ok) return r
    return { ok: true, playing: video.title || 'the top result', url, note: 'Opened the video; it starts by itself (a browser may need one click if it blocks autoplay).' }
  }
}
