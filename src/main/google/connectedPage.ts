// The page the browser shows after Google sign-in (served once by the local sign-in server, auth.ts).
// Dreamwalker's own look: graphite colours, the mascot drawn in SVG (happy when it worked, the amber
// "needs you" face when it didn't), and our own line icons for Mail, Calendar and Drive (not Google's
// logos). Everything is inline: the page loads nothing from anywhere.

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

// The mascot: the same rounded body and outline as the companion (docs/design/companion-handoff).
function mascot(happy: boolean): string {
  const line = happy ? '#7FD3E6' : '#F2B54A'
  const eyes = happy
    ? // happy: eyes as little arches, and a smile
      `<path d="M44 58 q8 -10 16 0" /><path d="M76 58 q8 -10 16 0" /><path d="M56 80 q12 10 24 0" stroke="#7FD3E6" />`
    : // needs you: the companion's "confirm" face (brows, round eyes, a small "o")
      `<path d="M42 44 l14 4" /><path d="M94 44 l-14 4" /><circle cx="52" cy="60" r="5" fill="#E6E8EB" stroke="none" /><circle cx="84" cy="60" r="5" fill="#E6E8EB" stroke="none" /><circle cx="68" cy="82" r="4.5" />`
  return `<svg class="mascot" viewBox="0 0 136 136" width="136" height="136" aria-hidden="true">
    <rect x="8" y="8" width="120" height="120" rx="36" fill="#121519" stroke="${line}" stroke-width="3" />
    <g fill="none" stroke="${happy ? '#E6E8EB' : line}" stroke-width="5" stroke-linecap="round">${eyes}</g>
  </svg>`
}

const ICONS = {
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><path d="M9 4h6l6 10.5-3 5.5H6l-3-5.5z"/><path d="M9 4l6 10.5M3 14.5h12"/></svg>'
}

export function connectedPage(opts: { ok: boolean; agentName: string; email?: string; message?: string }): string {
  const name = esc(opts.agentName)
  const title = opts.ok ? `${name} is connected to Google` : 'Google sign-in didn’t finish'
  const lead = opts.ok
    ? `Signed in as <strong>${esc(opts.email ?? 'your Google account')}</strong>. You can close this tab and go back to Dreamwalker.`
    : esc(opts.message ?? 'Something went wrong.') + (/again/i.test(opts.message ?? '') ? '' : ' Go back to Dreamwalker and say “connect my Google account” to try again.')
  const services = opts.ok
    ? `<ul class="services">
        <li><span class="ic">${ICONS.mail}</span><span><strong>Gmail</strong><small>read, and send after you say yes</small></span></li>
        <li><span class="ic">${ICONS.calendar}</span><span><strong>Calendar</strong><small>your meetings, new events, Meet links</small></span></li>
        <li><span class="ic">${ICONS.drive}</span><span><strong>Drive</strong><small>find files by name</small></span></li>
      </ul>
      <p class="try">Try: <span>“What meetings do I have today?”</span> <span>“Any unread mail from Rahul?”</span></p>`
    : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Dreamwalker</title>
<style>
  :root { --bg:#0E1013; --surf:#14171B; --line:#1F242A; --line2:#2A3038; --tx:#E6E8EB; --tx2:#A2A9B2; --tx3:#7C848E; --acc:#7FD3E6; --att:#F2B54A; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--tx);
    font: 15px/1.5 "Geist", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
  body { display: grid; place-items: center; min-height: 100vh; padding: 24px;
    background: radial-gradient(60rem 30rem at 50% -10%, rgba(127,211,230,.10), transparent 60%), var(--bg); }
  .card { width: min(520px, 100%); padding: 36px 32px 28px; border: 1px solid var(--line2); border-radius: 18px;
    background: var(--surf); text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,.45); animation: in .5s cubic-bezier(.2,.9,.3,1.1); }
  .mascot { animation: float 3.2s ease-in-out infinite; filter: drop-shadow(0 10px 24px ${opts.ok ? 'rgba(127,211,230,.25)' : 'rgba(242,181,74,.25)'}); }
  .brand { margin: 18px 0 4px; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--tx3); }
  h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -.01em; }
  h1 .dot { color: ${opts.ok ? 'var(--acc)' : 'var(--att)'}; }
  .lead { margin: 0 auto 22px; max-width: 400px; color: var(--tx2); }
  .lead strong { color: var(--tx); font-weight: 500; }
  .services { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 10px; text-align: left; }
  .services li { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: #101317; }
  .ic { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; color: var(--acc); background: rgba(127,211,230,.08); }
  .ic svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .services strong { display: block; font-weight: 500; }
  .services small { color: var(--tx3); font-size: 13px; }
  .try { margin: 0; color: var(--tx3); font-size: 13px; }
  .try span { display: inline-block; margin: 6px 4px 0; padding: 3px 10px; border: 1px solid var(--line2); border-radius: 999px; color: var(--tx2); }
  .foot { margin-top: 22px; font-size: 12px; color: var(--tx3); }
  @keyframes float { 50% { transform: translateY(-6px); } }
  @keyframes in { from { opacity: 0; transform: translateY(10px) scale(.98); } }
  @media (prefers-reduced-motion: reduce) { .mascot, .card { animation: none; } }
</style></head>
<body><main class="card">
  ${mascot(opts.ok)}
  <p class="brand">Dreamwalker</p>
  <h1>${title}<span class="dot">.</span></h1>
  <p class="lead">${lead}</p>
  ${services}
  ${opts.ok ? '<p class="foot">Your sign-in is stored encrypted on this computer. “Disconnect Google” removes it.</p>' : ''}
</main></body></html>`
}
