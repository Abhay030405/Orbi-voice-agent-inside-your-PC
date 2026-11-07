import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cleanNumber,
  findApp,
  findContacts,
  inputText,
  parseBattery,
  parseContacts,
  parseDevices,
  parseForeground,
  parseLaunchable,
  parseMdns,
  parseNotifications,
  parseScreenOn,
  shQuote
} from './parse.ts'

// Shapes captured from a real phone (Motorola Signature, Android 16); private values replaced.
describe('reading adb output', () => {
  it('devices and wireless discovery', () => {
    const out = 'List of devices attached\nadb-ZD22-idu3Bq._adb-tls-connect._tcp device product:vantage_g model:motorola_signature device:vantage transport_id:1\n\n'
    assert.deepEqual(parseDevices(out), [{ serial: 'adb-ZD22-idu3Bq._adb-tls-connect._tcp', state: 'device', model: 'motorola signature' }])
    assert.deepEqual(parseDevices('List of devices attached\nemulator-5554\tunauthorized\n'), [{ serial: 'emulator-5554', state: 'unauthorized', model: '' }])
    assert.deepEqual(parseMdns('List of discovered mdns services\nadb-ZD22-x\t_adb-tls-connect._tcp\t192.168.29.51:37211\n'), ['192.168.29.51:37211'])
  })

  it('battery, foreground app, screen', () => {
    assert.deepEqual(parseBattery('  AC powered: false\n  USB powered: false\n  status: 3\n  level: 77\n'), { level: 77, charging: false })
    assert.deepEqual(parseBattery('  AC powered: true\n  status: 2\n  level: 40\n'), { level: 40, charging: true })
    assert.equal(parseForeground('  ResumedActivity: ActivityRecord{34280616 u0 com.android.settings/.Settings t303}'), 'com.android.settings')
    assert.equal(parseScreenOn('  mWakefulness=Dozing'), false)
    assert.equal(parseScreenOn('  mWakefulness=Awake'), true)
  })

  it('notifications: real values win over the public "null" version; system ones are dropped', () => {
    const out = [
      '    NotificationRecord(0x0ade2712: pkg=android user=UserHandle{-1} id=62 tag=x importance=4)',
      '                android.title=String (USB debugging connected)',
      '    NotificationRecord(0x0868fc55: pkg=com.google.android.youtube user=UserHandle{0} id=0)',
      '                android.title=null',
      '                android.text=null',
      '                android.title=String (New video)',
      '                android.text=String (A channel posted)',
      '    NotificationRecord(0x0e90ff99: pkg=com.whatsapp user=UserHandle{0} id=1)',
      '                android.title=SpannableString (Rahul)',
      '                android.text=String (see you at 5)',
      '                android.bigText=String (see you at 5 (near the gate))'
    ].join('\n')
    assert.deepEqual(parseNotifications(out), [
      { app: 'com.google.android.youtube', title: 'New video', text: 'A channel posted' },
      { app: 'com.whatsapp', title: 'Rahul', text: 'see you at 5 (near the gate)' }
    ])
  })

  it('contacts: parse, match a spoken name, de-duplicate', () => {
    const all = parseContacts('Row: 0 display_name=Rahul Sharma, data1=+91 98765 43210\nRow: 1 display_name=Rahul Sharma, data1=+919876543210\nRow: 2 display_name=Riya, data1=98100 00000\n')
    assert.equal(all.length, 3)
    assert.deepEqual(findContacts(all, 'rahul').map((c) => c.name), ['Rahul Sharma'])
    assert.deepEqual(findContacts(all, 'Riya').map((c) => c.number), ['98100 00000'])
    assert.equal(findContacts(all, 'nobody').length, 0)
    // fuzzy fallback: speech-to-text slipped a letter, still finds the right contact
    assert.deepEqual(findContacts(all, 'rahil').map((c) => c.name), ['Rahul Sharma'])
    assert.deepEqual(findContacts(all, 'riua').map((c) => c.name), ['Riya'])
    assert.equal(findContacts(all, 'zzzz').length, 0) // nothing close = no match
  })

  it('numbers: only real-looking ones', () => {
    assert.equal(cleanNumber('+91 98765-43210'), '+919876543210')
    assert.equal(cleanNumber('12'), null)
    assert.equal(cleanNumber('*#06#'), null) // no USSD / service codes
  })

  it('apps: known names first, then words in the package name', () => {
    const pkgs = ['com.whatsapp', 'com.spotify.music', 'com.application.zomato', 'com.application.zomato.extension', 'com.android.settings']
    assert.deepEqual(findApp(pkgs, 'WhatsApp'), ['com.whatsapp'])
    assert.deepEqual(findApp(pkgs, 'spotify'), ['com.spotify.music']) // known name: exactly that app
    assert.deepEqual(findApp(pkgs, 'zomato'), ['com.application.zomato', 'com.application.zomato.extension']) // by words, shortest first
    assert.deepEqual(findApp(pkgs, 'snapchat'), [])
    assert.deepEqual(parseLaunchable('com.whatsapp/.Main\ncom.android.settings/.Settings\n'), ['com.whatsapp', 'com.android.settings'])
  })
})

describe('safety: text that goes to the phone', () => {
  it('quotes values so the phone shell can never run them', () => {
    assert.equal(shQuote('hi'), "'hi'")
    assert.equal(shQuote("it's; rm -rf /sdcard"), "'it'\\''s; rm -rf /sdcard'")
  })

  it('types only plain text, spaces as %s', () => {
    assert.equal(inputText('hello world'), 'hello%sworld')
    assert.throws(() => inputText('नमस्ते'), /plain English/)
  })
})
