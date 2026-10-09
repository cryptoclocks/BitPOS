import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { requestId } from '../apps/web/src/lib/request-id';

function withCrypto(value: unknown, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  try { run(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
}

test('HTTP LAN without randomUUID retains random bytes and sets RFC4122 version and variant', () => {
  withCrypto({ getRandomValues(bytes: Uint8Array) { for (let i = 0; i < bytes.length; i++) bytes[i] = i; return bytes; } }, () => {
    assert.equal(requestId(), '00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});
test('callable native UUID is preferred without requiring the fallback RNG', () => {
  withCrypto({ randomUUID: webcrypto.randomUUID.bind(webcrypto) }, () => {
    assert.match(requestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
test('missing cryptographic RNG fails closed instead of generating weak submission IDs', () => {
  for (const crypto of [undefined, {}, { randomUUID: 'unavailable' }]) {
    withCrypto(crypto, () => assert.throws(requestId, /Secure random identifiers are unavailable/));
  }
});
