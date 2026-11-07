import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RetryGuard, idempotencyKey, stableStringify } from './idempotency.ts'

describe('idempotency keys (exactly-once, A1)', () => {
  it('the same arguments in a different order give the same key', () => {
    assert.equal(
      idempotencyKey('r1', 'send_sms', { to: 'Rahul', text: 'late' }),
      idempotencyKey('r1', 'send_sms', { text: 'late', to: 'Rahul' })
    )
  })

  it('a retry in the same request matches; asking again (new request) does not', () => {
    const first = idempotencyKey('request-A', 'set_volume', { level: 30 })
    const retryAfterReconnect = idempotencyKey('request-A', 'set_volume', { level: 30 })
    const userAskedAgain = idempotencyKey('request-B', 'set_volume', { level: 30 })
    assert.equal(first, retryAfterReconnect)
    assert.notEqual(first, userAskedAgain)
  })

  it('different arguments are different actions', () => {
    assert.notEqual(idempotencyKey('r', 'set_volume', { level: 30 }), idempotencyKey('r', 'set_volume', { level: 31 }))
  })

  it('sorts nested objects too, and ignores undefined fields', () => {
    assert.equal(stableStringify({ b: { y: 1, x: 2 }, a: undefined }), '{"b":{"x":2,"y":1}}')
  })
})

describe('RetryGuard: retry only when nothing happened in between', () => {
  it('an immediate repeat is a retry, with the same key (so the ledger finds the first one)', () => {
    const g = new RetryGuard()
    const a = g.check('req|set_volume|{50}', false)
    const b = g.check('req|set_volume|{50}', false)
    assert.equal(a.retry, false)
    assert.equal(b.retry, true)
    assert.equal(a.key, b.key)
  })

  it('look → act → look: the second look is NEW (its own key), not a retry', () => {
    const g = new RetryGuard()
    const shot1 = g.check('req|phone_screenshot|{}', false)
    g.check('req|phone_tap|{1,2}', false)
    const shot2 = g.check('req|phone_screenshot|{}', false)
    assert.equal(shot2.retry, false)
    assert.notEqual(shot1.key, shot2.key)
  })

  it('a read in between also counts as something happening; reads never get a key', () => {
    const g = new RetryGuard()
    const a = g.check('req|set_volume|{50}', false)
    const r = g.check('req|get_volume|{}', true)
    const b = g.check('req|set_volume|{50}', false)
    assert.equal(r.key, undefined)
    assert.equal(b.retry, false)
    assert.notEqual(a.key, b.key)
  })

  it('a duplicate of the second occurrence matches the second, not the first', () => {
    const g = new RetryGuard()
    g.check('k', false)
    g.check('other', false)
    const second = g.check('k', false)
    const dup = g.check('k', false)
    assert.equal(dup.retry, true)
    assert.equal(dup.key, second.key)
  })
})

