// Is the main window on screen? Main tells us (show/hide/minimise/restore). The page can't find out
// itself: backgroundThrottling is off so the voice keeps working from the tray, and that also makes
// document.hidden always false. Everything that animates checks this and sleeps while hidden.

import { useEffect, useState } from 'react'

let visible = true
const listeners = new Set<(visible: boolean) => void>()

window.dreamwalker.onWindowVisible((v) => {
  visible = v
  listeners.forEach((l) => l(v))
})

export const windowVisible = (): boolean => visible

export function useWindowVisible(): boolean {
  const [v, setV] = useState(visible)
  useEffect(() => {
    listeners.add(setV)
    setV(visible)
    return () => {
      listeners.delete(setV)
    }
  }, [])
  return v
}
