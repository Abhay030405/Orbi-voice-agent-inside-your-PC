// Ctrl K: jump to any section or sub-tab, keyboard first. Type to filter, ↑/↓ to move, Enter to go,
// Esc to close.

import { useEffect, useRef, useState } from 'react'
import { destinations, type Route } from '../nav'

export function CommandPalette(props: { onGo(route: Route): void; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const items = destinations().filter((d) => d.label.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => setIndex(0), [query])

  const go = (i: number): void => {
    const item = items[i]
    if (item) props.onGo(item.route)
  }

  return (
    <div className="palette-backdrop" onMouseDown={props.onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Jump to"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(items.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') go(index)
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to…"
          aria-label="Jump to"
          aria-activedescendant={items[index] ? `pal-${index}` : undefined}
        />
        <ul role="listbox">
          {items.map((item, i) => (
            <li
              key={item.label}
              id={`pal-${i}`}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'on' : ''}
              onMouseEnter={() => setIndex(i)}
              onClick={() => go(i)}
            >
              {item.label}
            </li>
          ))}
          {items.length === 0 && <li className="dim">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  )
}
