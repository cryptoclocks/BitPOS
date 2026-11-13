/* NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Pure-C parts of the BitPOS Mini NEAR product (no ESP-IDF includes): encoders, the witness message, the NEAR
 * JSON-RPC request for get_bill and a bounded parser for its answer. tools/firmware/near-host-test builds and
 * tests exactly these files on a Mac. Every function writes at most `cap` bytes and reports failure instead of
 * truncating. */

#define BN_ACCOUNT_MAX 65   /* NEAR account id: 2..64 chars + NUL */
#define BN_BILL_ID_MAX 65   /* bill id: 1..64 chars of [A-Za-z0-9_-] + NUL */
#define BN_TOTAL_MAX 40     /* u128 as decimal digits + NUL */
#define BN_PK_HEX_MAX 65    /* 64 hex chars + NUL */
#define BN_ACK_MESSAGE_MAX 224
#define BN_RPC_REQUEST_MAX 640
#define BN_BILL_JSON_MAX 4096   /* decoded get_bill JSON (the contract returns at most 10 payouts) */
#define BN_RPC_RESPONSE_MAX 24576 /* whole JSON-RPC answer: every result byte is at most "255," */

/* Lower-case hex of n bytes; out needs 2n+1. */
void bn_hex_encode(char *out, const uint8_t *in, size_t n);
/* Exactly 2n hex chars (either case) followed by NUL; false otherwise. */
bool bn_hex_decode(uint8_t *out, size_t n, const char *hex);
/* Bitcoin-alphabet base58 (what NEAR prints after "ed25519:"). Returns length, or -1 if cap is too small. */
int bn_base58_encode(char *out, size_t cap, const uint8_t *in, size_t n);
/* Standard base64 with padding. Returns length, or -1 if cap is too small. */
int bn_base64_encode(char *out, size_t cap, const uint8_t *in, size_t n);

/* NEAR account id rules: 2..64 chars, [a-z0-9] separated by single '.', '-' or '_'. */
bool bn_valid_account(const char *s);
/* Bill ids this device accepts: 1..64 chars of [A-Za-z0-9_-]. No ':' so the witness message stays unambiguous. */
bool bn_valid_bill_id(const char *s);

/* "bitpos-near-ack:v1:<contract>:<merchant>:<bill_id>" (ASCII, no NUL counted). Returns its length, or -1 when an
 * argument is invalid or cap is too small. */
int bn_ack_message(char *out, size_t cap, const char *contract, const char *merchant, const char *bill_id);

/* JSON-RPC body: query call_function get_bill at final finality. Returns length, or -1. */
int bn_rpc_request(char *out, size_t cap, const char *contract, const char *merchant, const char *bill_id);

typedef enum {
    BN_STATE_UNKNOWN = 0, BN_STATE_OPEN, BN_STATE_ESCROW, BN_STATE_SETTLING, BN_STATE_SETTLED,
    BN_STATE_PAYOUT_FAILED, BN_STATE_REFUNDING, BN_STATE_REFUNDED, BN_STATE_VOID
} bn_state_t;

typedef struct {
    char merchant[BN_ACCOUNT_MAX];
    char bill_id[BN_BILL_ID_MAX];
    char token[BN_ACCOUNT_MAX];
    char total[BN_TOTAL_MAX];
    bn_state_t state;
    bool has_payer;
    char payer[BN_ACCOUNT_MAX];
    bool has_witness;
    char witness_pk[BN_PK_HEX_MAX]; /* lower-case hex */
} bn_bill_t;

typedef enum {
    BN_PARSE_OK = 0,
    BN_PARSE_TOO_LARGE,   /* response or decoded bill larger than the fixed limits */
    BN_PARSE_MALFORMED,   /* not the JSON shape we expect */
    BN_PARSE_RPC_ERROR,   /* the node answered with "error" (or without a result) */
    BN_PARSE_NO_BILL,     /* the contract returned null: no such bill */
    BN_PARSE_BAD_FIELD    /* a required field is missing, the wrong type or out of range */
} bn_parse_t;

/* Parses a whole JSON-RPC answer. `scratch` must hold BN_BILL_JSON_MAX bytes (the decoded contract result). */
bn_parse_t bn_parse_rpc_bill(const char *body, size_t len, char *scratch, bn_bill_t *out);
/* Parses the contract's own JSON (what get_bill returns), e.g. for tests. */
bn_parse_t bn_parse_bill_json(const char *json, size_t len, bn_bill_t *out);

typedef enum {
    BN_SHOW_CHECKING = 0, /* cannot say paid: keep "checking the chain" */
    BN_SHOW_QR,           /* Open: still waiting for the payment */
    BN_SHOW_PAID_WITNESS, /* Escrow and this device is the bill's witness: show paid, then sign */
    BN_SHOW_PAID,         /* Settling / Settled: show paid, nothing to sign */
    BN_SHOW_REFUNDED,     /* Refunding / Refunded */
    BN_SHOW_IDLE          /* Void */
} bn_show_t;

/* What the screen may show for a bill read from the chain. The bill must be the one that was asked for
 * (merchant and id equal), otherwise BN_SHOW_CHECKING. own_pk_hex is this device's public key (64 hex). */
bn_show_t bn_decide(const bn_bill_t *bill, const char *merchant, const char *bill_id, const char *own_pk_hex);

#ifdef __cplusplus
}
#endif
