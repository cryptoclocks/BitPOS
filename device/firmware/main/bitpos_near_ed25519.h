/* NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. */
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Ed25519 (RFC 8032, pure EdDSA) for the BitPOS Mini NEAR product: the device's witness key.
 * Pure C, no ESP-IDF includes, so tools/firmware/near-host-test can compile and check it on a Mac.
 * Messages are bounded: the only thing this device signs is one short ASCII witness line. */
#define BITPOS_NEAR_SEED_BYTES 32
#define BITPOS_NEAR_PK_BYTES 32
#define BITPOS_NEAR_SIG_BYTES 64
#define BITPOS_NEAR_MSG_MAX 256

/* Public key for a 32-byte seed (the RFC 8032 "private key"). */
void bitpos_near_ed25519_public(uint8_t pk[BITPOS_NEAR_PK_BYTES], const uint8_t seed[BITPOS_NEAR_SEED_BYTES]);
/* Detached signature. Returns 0, or -1 when len > BITPOS_NEAR_MSG_MAX. Deterministic. */
int bitpos_near_ed25519_sign(uint8_t sig[BITPOS_NEAR_SIG_BYTES], const uint8_t *msg, size_t len,
                             const uint8_t seed[BITPOS_NEAR_SEED_BYTES], const uint8_t pk[BITPOS_NEAR_PK_BYTES]);
/* Returns 0 when sig is a valid signature of msg under pk, otherwise -1. */
int bitpos_near_ed25519_verify(const uint8_t sig[BITPOS_NEAR_SIG_BYTES], const uint8_t *msg, size_t len,
                               const uint8_t pk[BITPOS_NEAR_PK_BYTES]);
/* SHA-512, exposed for the host test (FIPS 180-4 vectors). */
void bitpos_near_sha512(uint8_t out[64], const uint8_t *msg, size_t len);

#ifdef __cplusplus
}
#endif
