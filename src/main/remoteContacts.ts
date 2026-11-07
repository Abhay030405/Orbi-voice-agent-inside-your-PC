// Contacts the user picked on their phone (PWA Contact Picker) and shared with the laptop. They live
// here in memory and are merged into the phone-call matcher, so Orbi can call people by name even when
// they aren't on the connected adb phone. Numbers stay on this computer and the user's own phone —
// they are NEVER sent to the model (same rule as the adb contacts: only the matched name is).
import type { Contact } from './phone/parse'

let picked: Contact[] = []

export function setRemoteContacts(list: Contact[]): void {
  picked = list
}

export function remoteContacts(): Contact[] {
  return picked
}
