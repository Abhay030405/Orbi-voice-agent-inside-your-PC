// What a confirmation is asking about, in full. Descriptions can have several lines ("Run this command
// in PowerShell:" + the command itself). The first line is the sentence; the rest is the exact detail,
// shown in mono. Never cut it: the detail (the command, the path) is what you're saying yes to.

export function ActionText(props: { action: string; className?: string }) {
  const [first, ...rest] = props.action.split('\n')
  const detail = rest.map((l) => l.trim()).filter(Boolean).join('\n')
  return (
    <div className={props.className}>
      <div>{first.trim()}</div>
      {detail && <pre className="action-detail">{detail}</pre>}
    </div>
  )
}

// The same, as one line for screen readers.
export const actionWords = (action: string): string => action.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
