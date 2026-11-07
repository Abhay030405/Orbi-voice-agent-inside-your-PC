// Sections whose features aren't built yet. They say so plainly, with what's coming and when: an empty
// page that pretends would be worse than an honest one.

export function ComingSoon(props: { title: string; what: string; when: string; needs?: string }) {
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>{props.title}</h1>
        <p className="page-intro">{props.what}</p>
      </header>
      <p className="coming">
        <span className="badge">{props.when}</span>
        {props.needs && <span className="dim"> · {props.needs}</span>}
      </p>
    </div>
  )
}

export const RoutinesPage = () => (
  <ComingSoon
    title="Routines"
    what="Teach a multi-step routine by voice (“when I say study mode: close games, open my notes, do not disturb”), name it, and run it later. Saved across restarts and editable."
    when="Coming in M6"
  />
)
export const WatcherPage = () => (
  <ComingSoon
    title="Watcher"
    what="Let it keep an eye on your screen and tell you when something happens (a download finishes, an error appears). Secrets on screen are blurred on this computer before anything is sent."
    when="Coming in M5"
  />
)

// Privacy & Safety: what stays here and what leaves, in plain words. All true today.
export function PrivacyPage(props: { refusedThisWeek: number }) {
  const rows: Array<[string, string]> = [
    ['Wake word', 'Checked on this computer. No audio leaves before “Hey …”.'],
    ['Your voice after the wake word', 'Sent to Google Gemini to understand and answer you.'],
    ['Screenshots, documents, web searches', 'Only when you ask (or approve): then sent to Gemini.'],
    ['Conversation history', 'Saved on this computer (%APPDATA%\\dreamwalker\\sessions). Google keeps its own copy of a conversation for about 2 hours so it can resume.'],
    ['Action history (Ledger)', 'On this computer only, across restarts.'],
    ['Risky actions', 'Always asked in a Windows dialog no web page can click, or by your spoken yes/no.'],
    ['After it reads outside content', 'Caution mode: every change asks you first, whatever the permissions say.']
  ]
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Privacy & Safety</h1>
        <p className="page-intro">
          What stays on this computer and what leaves it. {props.refusedThisWeek} action{props.refusedThisWeek === 1 ? ' was' : 's were'} refused
          or denied in the last 7 days.
        </p>
      </header>
      <dl className="diag">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="privacy-dd">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
