// OUTBOX: every message we've sent Gemini that it hasn't CONFIRMED receiving yet.
// Guide: docs/build-log/05-reconnect.md.
//
// Gemini's "transparent" session resumption tells us, at the end of each turn, the number of the
// last message it consumed ("lastConsumedClientMessageIndex"). Measured: messages are numbered from 1
// on each connection, and the count restarts when we reconnect. So:
//   - sent()     records a message with this connection's next number
//   - confirm(n) forgets everything numbered ≤ n: the server has it
//   - if the connection drops, what's left is exactly what the server never got → replay it
// Messages we try to send while disconnected are queued here too, and delivered after reconnecting.
// Nothing lost, nothing sent twice.

export type OutboxKind = 'audio' | 'audioEnd' | 'text' | 'toolResult'

interface Entry<T> {
  seq: number // this connection's message number, or 0 = not sent yet (we were disconnected)
  kind: OutboxKind
  message: T
}

export class Outbox<T> {
  private entries: Entry<T>[] = []
  private nextSeq = 1
  private readonly maxAudio: number

  // maxAudio caps how much unconfirmed mic audio we keep (each chunk is 20 ms). Past that, the
  // oldest audio is dropped: after a very long outage, replaying minutes of audio isn't useful.
  constructor(maxAudio: number) {
    this.maxAudio = maxAudio
  }

  get size(): number {
    return this.entries.length
  }

  // We just sent this on the current connection.
  sent(kind: OutboxKind, message: T): void {
    this.add({ seq: this.nextSeq++, kind, message })
  }

  // We couldn't send this (disconnected). Keep it for when we're back.
  queued(kind: OutboxKind, message: T): void {
    this.add({ seq: 0, kind, message })
  }

  // The server confirmed it has every message up to and including #n on this connection.
  confirm(n: number): void {
    this.entries = this.entries.filter((e) => e.seq === 0 || e.seq > n)
  }

  // A new connection is ready: numbering restarts at 1. Returns what must be re-sent, in the order
  // it was originally sent, and empties the outbox (re-sending records each message again).
  //
  // `resumed` = the server restored our old session. If it didn't (a brand-new session), tool results
  // are dropped: they answer requests the new session never made, and their ids mean nothing to it.
  takeForReplay(resumed: boolean): { kind: OutboxKind; message: T }[] {
    const replay = this.entries
      .filter((e) => resumed || e.kind !== 'toolResult')
      .map(({ kind, message }) => ({ kind, message }))
    this.entries = []
    this.nextSeq = 1
    return replay
  }

  clear(): void {
    this.entries = []
    this.nextSeq = 1
  }

  private add(entry: Entry<T>): void {
    this.entries.push(entry)
    if (entry.kind !== 'audio') return
    let audio = this.entries.filter((e) => e.kind === 'audio').length
    while (audio > this.maxAudio) {
      const oldest = this.entries.findIndex((e) => e.kind === 'audio')
      this.entries.splice(oldest, 1)
      audio--
    }
  }
}
