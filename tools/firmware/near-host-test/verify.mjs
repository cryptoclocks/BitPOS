// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Independent check of the firmware's C crypto with Node's built-in Ed25519 and SHA-512 (no packages):
//   node verify.mjs '<JSON line from: near_host_test vector>' '<sha512 hex of 200 x "a" from the C test>'
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
const vector = JSON.parse(process.argv[2]);
const seed = Buffer.from(vector.seed, 'hex');
// PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410).
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(key);
const pk = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const message = Buffer.from(vector.message, 'ascii');
const expected = sign(null, message, key).toString('hex');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (bytes) => { let n = BigInt('0x' + bytes.toString('hex')), out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; } for (const b of bytes) { if (b) break; out = '1' + out; } return out; };
const checks = {
  'node-public-key-matches': pk === vector.pk,
  'node-near-key-matches': 'ed25519:' + base58(Buffer.from(vector.pk, 'hex')) === vector.pk_near,
  'node-message-matches': vector.message === `bitpos-near-ack:v1:${vector.contract}:${vector.merchant}:${vector.bill_id}`,
  'node-signature-identical': expected === vector.sig,
  'node-verifies-c-signature': verify(null, message, publicKey, Buffer.from(vector.sig, 'hex')),
  'node-sha512-200a-matches': createHash('sha512').update('a'.repeat(200)).digest('hex') === process.argv[3],
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
process.exit(failed ? 1 : 0);
