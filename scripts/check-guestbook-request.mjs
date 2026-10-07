import assert from 'node:assert/strict'
import { guestbookRequest, GuestbookRequestError, guestbookErrorMessage } from '../src/guestbook-request.ts'
const parent = new AbortController()
let requestSignal
await assert.rejects(guestbookRequest(signal => {
  requestSignal = signal
  return new Promise(() => {})
}, parent.signal, 20), error => error instanceof GuestbookRequestError && error.code === 'TIMEOUT')
assert(requestSignal.aborted, 'Timeout also cancels pending network work')
const cancelled = new AbortController()
const pending = guestbookRequest(() => new Promise(() => {}), cancelled.signal)
cancelled.abort()
await assert.rejects(pending, error => error.code === 'CANCELLED')
assert.equal(await guestbookRequest(() => Promise.resolve({ data: 'saved', error: null, status: 201 }), parent.signal, 100), 'saved')
await assert.rejects(guestbookRequest(() => Promise.resolve({ data: null, error: { code: '42501' }, status: 403 }), parent.signal), error => error.code === '42501')
assert.match(guestbookErrorMessage(new GuestbookRequestError('42501', 403), true), /권한 오류/)
assert.match(guestbookErrorMessage(new GuestbookRequestError('42501', 401), true), /권한 오류/)
assert.match(guestbookErrorMessage(new GuestbookRequestError('PGRST205', 404), false), /테이블 오류/)
assert.match(guestbookErrorMessage(new GuestbookRequestError('NETWORK', 401), true), /인증 오류/)
console.log('PASS bounded requests: hung SDK, abort, success, permission/auth/schema error classification')
