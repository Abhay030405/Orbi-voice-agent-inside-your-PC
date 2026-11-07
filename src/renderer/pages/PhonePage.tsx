// PHONE (M4): the connected Android phone's status, and what you can ask for.

import { useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import type { PhoneStatus, RemoteInfo } from '../../shared/ipc'
import { cleanError } from '../store'

// One line for the Home tile / status strip.
export function phoneLine(p: PhoneStatus): string {
  if (p.state === 'connected') {
    const battery = p.battery === null || p.battery === undefined ? '' : ` · ${p.battery}%${p.charging ? ' charging' : ''}`
    return `${p.model}${battery}`
  }
  if (p.state === 'searching') return 'Looking for your phone…'
  if (p.state === 'unauthorized') return 'Tap "Allow" on the phone'
  if (p.state === 'no-adb') return 'adb missing: npm run tools'
  return 'Not connected'
}

const EXAMPLES = [
  'What’s my phone’s battery?',
  'Open WhatsApp on my phone',
  'Read my phone notifications',
  'What’s on my phone screen?',
  'Turn on Do Not Disturb on my phone',
  'Copy the newest file in my phone’s Downloads to this PC',
  'Text Rahul “running late” (it asks before anything is sent)',
  'Call Mom (always asks first)'
]

// THE PHONE REMOTE: control this laptop from your phone, from anywhere (main/phoneBridge.ts). Scan once:
// the phone keeps the pairing code, and can install the page as an app (Add to Home Screen).
function RemoteCard() {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    void window.dreamwalker.remoteInfo().then(setInfo).catch(() => {})
    return window.dreamwalker.onRemoteStatus(setInfo)
  }, [])
  if (!info) return null
  if (!info.pairUrl) {
    return (
      <section className="setting">
        <h2 className="rail-label">Phone remote</h2>
        <p className="setting-hint">Switched off (DW_RELAY=off and DW_PORT=0).</p>
      </section>
    )
  }
  const qr = qrcode(0, 'M')
  qr.addData(info.pairUrl)
  qr.make()
  return (
    <section className="setting">
      <h2 className="rail-label">Phone remote {info.relay ? (info.online ? '· online' : '· connecting…') : ''}</h2>
      <p className="setting-hint">
        Control this laptop from your phone, from anywhere: type or say what you want (“open Docker”, “send me the deck”,
        “lock my laptop”), get files, and answer its questions there. Scan the code with the phone’s camera, open the link,
        then “Add to Home Screen”. Risky actions still ask you first, on the phone. Keep this code private: it is the key.
      </p>
      {show ? (
        <div className="remote-qr" style={{ background: '#fff', padding: 12, borderRadius: 12, width: 232 }} dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }} />
      ) : null}
      <p>
        <button className="btn" onClick={() => setShow(!show)}>
          {show ? 'Hide the code' : 'Show pairing QR code'}
        </button>
        {info.relay ? <span className="setting-hint"> {info.relay.replace(/^https?:\/\//, '')}</span> : null}
      </p>
    </section>
  )
}

export function PhonePage(props: { phone: PhoneStatus }) {
  const p = props.phone
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recheck = (): void => {
    setChecking(true)
    setError(null)
    window.dreamwalker
      .refreshPhone()
      .catch((err: unknown) => setError(cleanError(err)))
      .finally(() => setChecking(false))
  }
  const rows: Array<[string, string]> =
    p.state === 'connected'
      ? [
          ['Phone', `${p.model} · Android ${p.android}`],
          ['Battery', p.battery === null || p.battery === undefined ? '–' : `${p.battery}%${p.charging ? ', charging' : ''}`],
          ['Connected', p.via === 'wifi' ? 'over Wi-Fi (wireless debugging)' : 'by USB'],
          ['Wi-Fi', p.wifi ? 'on' : 'off'],
          ['Screen', p.screenOn === null || p.screenOn === undefined ? '–' : p.screenOn ? 'on' : 'off'],
          ['On screen', p.foreground ?? '–']
        ]
      : []

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Phone</h1>
        <p className="page-intro">
          Your Android phone, through adb (Android’s own developer bridge). Calls always ask first; texts are only prepared,
          you see them before they’re sent; notifications and the phone’s screen count as outside content (caution mode).
        </p>
      </header>

      {p.state === 'connected' ? (
        <dl className="diag">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="setting">
          <h2 className="rail-label">{phoneLine(p)}</h2>
          <p className="setting-hint">
            On the phone: Settings → Developer options → <strong>Wireless debugging</strong> on, on the same Wi-Fi as this PC
            (or plug it in with USB debugging on). The first time, tap <strong>Allow</strong> on the phone.
            {p.detail ? ` (${p.detail})` : ''}
          </p>
        </div>
      )}
      <p>
        <button className="btn" onClick={recheck} disabled={checking}>
          {checking ? 'Looking…' : 'Look again'}
        </button>
        {error && <span className="err"> {error}</span>}
      </p>

      <RemoteCard />

      <section className="setting">
        <h2 className="rail-label">Try saying</h2>
        <ul className="examples">
          {EXAMPLES.map((e) => (
            <li key={e}>“{e}”</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
