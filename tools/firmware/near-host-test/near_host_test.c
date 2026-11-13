/* NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
 *
 * Host test for the pure-C parts of the BitPOS Mini NEAR firmware (device/firmware/main/bitpos_near_ed25519.c and
 * bitpos_near_core.c). Built and run by run.sh with the Mac's cc; no ESP-IDF, no device.
 *   near_host_test          runs every check, prints PASS/FAIL lines, exits non-zero on any failure
 *   near_host_test vector   prints the fixed-seed witness vector as one JSON line (for the contract and Node) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bitpos_near_ed25519.h"
#include "bitpos_near_core.h"

static int failures, checks;
#define CHECK(name, cond) do { checks++; if (cond) printf("PASS %s\n", name); else { failures++; printf("FAIL %s\n", name); } } while (0)

static size_t unhex(uint8_t *out, size_t cap, const char *hex) {
    size_t n = strlen(hex) / 2;
    if (n > cap || !bn_hex_decode(out, n, hex)) { fprintf(stderr, "bad hex in test table\n"); exit(2); }
    return n;
}

/* RFC 8032 section 7.1, TEST 1-3 and TEST SHA(abc). */
static const struct { const char *name, *seed, *pk, *msg, *sig; } rfc8032[] = {
    {"rfc8032-test1",
     "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
     "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
     "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"},
    {"rfc8032-test2",
     "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
     "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
     "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"},
    {"rfc8032-test3",
     "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
     "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
     "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a"},
    {"rfc8032-sha-abc",
     "833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42",
     "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf",
     "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
     "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704"}};

/* The fixed witness vector: seed = bytes 00..1f, a testnet-style contract/merchant and a bill id. */
static const char VECTOR_SEED[] = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
static const char VECTOR_CONTRACT[] = "bills.bitpos-near.testnet";
static const char VECTOR_MERCHANT[] = "orbit.bitpos-near.testnet";
static const char VECTOR_BILL[] = "b_host_test_0001";

static void vector(uint8_t seed[32], uint8_t pk[32], char *message, size_t cap, uint8_t sig[64]) {
    unhex(seed, 32, VECTOR_SEED);
    bitpos_near_ed25519_public(pk, seed);
    int n = bn_ack_message(message, cap, VECTOR_CONTRACT, VECTOR_MERCHANT, VECTOR_BILL);
    if (n < 0 || bitpos_near_ed25519_sign(sig, (const uint8_t *)message, (size_t)n, seed, pk)) { fprintf(stderr, "vector failed\n"); exit(2); }
}

static void print_vector(void) {
    uint8_t seed[32], pk[32], sig[64]; char message[BN_ACK_MESSAGE_MAX], pk_hex[65], sig_hex[129], b58[64];
    vector(seed, pk, message, sizeof(message), sig);
    bn_hex_encode(pk_hex, pk, 32); bn_hex_encode(sig_hex, sig, 64); bn_base58_encode(b58, sizeof(b58), pk, 32);
    printf("{\"seed\":\"%s\",\"pk\":\"%s\",\"pk_near\":\"ed25519:%s\",\"contract\":\"%s\",\"merchant\":\"%s\",\"bill_id\":\"%s\",\"message\":\"%s\",\"sig\":\"%s\"}\n",
           VECTOR_SEED, pk_hex, b58, VECTOR_CONTRACT, VECTOR_MERCHANT, VECTOR_BILL, message, sig_hex);
}

/* Wraps a contract JSON answer the way a NEAR node does: {"jsonrpc":"2.0","result":{"result":[bytes...],...},"id":1}. */
static size_t rpc_wrap(char *out, size_t cap, const char *bill_json) {
    size_t at = (size_t)snprintf(out, cap, "{\"jsonrpc\":\"2.0\",\"result\":{\"block_hash\":\"67o9B65CuEtvi6Gdy4XcRA16QsHXreEipaJh9EmGXwSr\",\"block_height\":277556179,\"logs\":[],\"result\":[");
    for (const unsigned char *p = (const unsigned char *)bill_json; *p; p++)
        at += (size_t)snprintf(out + at, cap - at, "%s%u", p == (const unsigned char *)bill_json ? "" : ",", *p);
    at += (size_t)snprintf(out + at, cap - at, "]},\"id\":1}");
    return at;
}

int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "vector")) { print_vector(); return 0; }

    /* SHA-512 (FIPS 180-4 "abc") */
    {
        uint8_t digest[64]; char hex[129];
        bitpos_near_sha512(digest, (const uint8_t *)"abc", 3); bn_hex_encode(hex, digest, 64);
        CHECK("sha512-abc", !strcmp(hex, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"));
        bitpos_near_sha512(digest, (const uint8_t *)"", 0); bn_hex_encode(hex, digest, 64);
        CHECK("sha512-empty", !strcmp(hex, "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"));
        /* 200 bytes: crosses a block boundary */
        uint8_t long_msg[200]; memset(long_msg, 'a', sizeof(long_msg));
        bitpos_near_sha512(digest, long_msg, sizeof(long_msg)); bn_hex_encode(hex, digest, 64);
        printf("INFO sha512-200a %s\n", hex); /* compared with Node by verify.mjs */
    }

    /* Ed25519: RFC 8032 vectors */
    for (size_t i = 0; i < sizeof(rfc8032) / sizeof(rfc8032[0]); i++) {
        uint8_t seed[32], pk[32], want_pk[32], msg[BITPOS_NEAR_MSG_MAX], sig[64], want_sig[64]; char name[64];
        unhex(seed, 32, rfc8032[i].seed); unhex(want_pk, 32, rfc8032[i].pk); unhex(want_sig, 64, rfc8032[i].sig);
        size_t n = unhex(msg, sizeof(msg), rfc8032[i].msg);
        bitpos_near_ed25519_public(pk, seed);
        snprintf(name, sizeof(name), "%s-public", rfc8032[i].name); CHECK(name, !memcmp(pk, want_pk, 32));
        int rc = bitpos_near_ed25519_sign(sig, msg, n, seed, pk);
        snprintf(name, sizeof(name), "%s-sign", rfc8032[i].name); CHECK(name, rc == 0 && !memcmp(sig, want_sig, 64));
        snprintf(name, sizeof(name), "%s-verify", rfc8032[i].name); CHECK(name, bitpos_near_ed25519_verify(want_sig, msg, n, want_pk) == 0);
        sig[5] ^= 1;
        snprintf(name, sizeof(name), "%s-reject-bad-sig", rfc8032[i].name); CHECK(name, bitpos_near_ed25519_verify(sig, msg, n, want_pk) != 0);
        msg[0] ^= 1;
        snprintf(name, sizeof(name), "%s-reject-bad-msg", rfc8032[i].name); CHECK(name, bitpos_near_ed25519_verify(want_sig, msg, n ? n : 1, want_pk) != 0);
    }
    {
        uint8_t seed[32] = {1}, pk[32], sig[64], big[BITPOS_NEAR_MSG_MAX + 1] = {0};
        bitpos_near_ed25519_public(pk, seed);
        CHECK("ed25519-sign-max-length", bitpos_near_ed25519_sign(sig, big, BITPOS_NEAR_MSG_MAX, seed, pk) == 0 && bitpos_near_ed25519_verify(sig, big, BITPOS_NEAR_MSG_MAX, pk) == 0);
        CHECK("ed25519-sign-refuses-oversize", bitpos_near_ed25519_sign(sig, big, BITPOS_NEAR_MSG_MAX + 1, seed, pk) == -1);
    }

    /* Encoders */
    {
        char out[128]; uint8_t raw[8];
        CHECK("hex-roundtrip", bn_hex_decode(raw, 4, "DEADbeef") && raw[0] == 0xde && raw[3] == 0xef);
        CHECK("hex-rejects-short", !bn_hex_decode(raw, 4, "deadbe"));
        CHECK("hex-rejects-long", !bn_hex_decode(raw, 4, "deadbeef00"));
        CHECK("hex-rejects-nonhex", !bn_hex_decode(raw, 4, "deadbeeg"));
        CHECK("base64-empty", bn_base64_encode(out, sizeof(out), (const uint8_t *)"", 0) == 0 && !out[0]);
        CHECK("base64-f", bn_base64_encode(out, sizeof(out), (const uint8_t *)"f", 1) == 4 && !strcmp(out, "Zg=="));
        CHECK("base64-fo", bn_base64_encode(out, sizeof(out), (const uint8_t *)"fo", 2) == 4 && !strcmp(out, "Zm8="));
        CHECK("base64-foobar", bn_base64_encode(out, sizeof(out), (const uint8_t *)"foobar", 6) == 8 && !strcmp(out, "Zm9vYmFy"));
        CHECK("base64-refuses-small-buffer", bn_base64_encode(out, 8, (const uint8_t *)"foobar", 6) == -1);
        CHECK("base58-hello", bn_base58_encode(out, sizeof(out), (const uint8_t *)"Hello World!", 12) > 0 && !strcmp(out, "2NEpo7TZRRrLZSi2U"));
        const uint8_t zeros[4] = {0, 0, 1, 2};
        CHECK("base58-leading-zeros", bn_base58_encode(out, sizeof(out), zeros, 4) > 0 && !strncmp(out, "11", 2) && out[2] != '1');
        CHECK("base58-refuses-small-buffer", bn_base58_encode(out, 5, (const uint8_t *)"Hello World!", 12) == -1);
    }

    /* Ids and the witness message */
    {
        char m[BN_ACK_MESSAGE_MAX];
        CHECK("account-ok", bn_valid_account("bills.bitpos-near.testnet") && bn_valid_account("3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"));
        CHECK("account-rejects", !bn_valid_account("a") && !bn_valid_account("Bills.testnet") && !bn_valid_account(".testnet") && !bn_valid_account("a..b") && !bn_valid_account("a.b.") && !bn_valid_account("a:b") && !bn_valid_account("a b"));
        CHECK("bill-id-ok", bn_valid_bill_id("b_host_test_0001") && bn_valid_bill_id("0d9f8a7c-1b2c-4d3e-8f90-a1b2c3d4e5f6"));
        CHECK("bill-id-rejects", !bn_valid_bill_id("") && !bn_valid_bill_id("a:b") && !bn_valid_bill_id("a\"b") && !bn_valid_bill_id("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        int n = bn_ack_message(m, sizeof(m), "bills.bitpos-near.testnet", "orbit.bitpos-near.testnet", "b_host_test_0001");
        CHECK("ack-message", n == (int)strlen(m) && !strcmp(m, "bitpos-near-ack:v1:bills.bitpos-near.testnet:orbit.bitpos-near.testnet:b_host_test_0001"));
        CHECK("ack-message-rejects-colon", bn_ack_message(m, sizeof(m), "bills.testnet", "orbit.testnet", "x:y") == -1);
        CHECK("ack-message-rejects-small-buffer", bn_ack_message(m, 20, "bills.testnet", "orbit.testnet", "x") == -1);
        char req[BN_RPC_REQUEST_MAX];
        n = bn_rpc_request(req, sizeof(req), "bills.bitpos-near.testnet", "orbit.bitpos-near.testnet", "b_host_test_0001");
        CHECK("rpc-request", n > 0 && strstr(req, "\"method\":\"query\"") && strstr(req, "\"finality\":\"final\"") && strstr(req, "\"method_name\":\"get_bill\"") && strstr(req, "\"account_id\":\"bills.bitpos-near.testnet\"") &&
              strstr(req, "\"args_base64\":\"eyJtZXJjaGFudCI6Im9yYml0LmJpdHBvcy1uZWFyLnRlc3RuZXQiLCJiaWxsX2lkIjoiYl9ob3N0X3Rlc3RfMDAwMSJ9\""));
        printf("INFO rpc-request %s\n", req);
    }

    /* get_bill answers */
    {
        static char body[BN_RPC_RESPONSE_MAX + 4096], scratch[BN_BILL_JSON_MAX]; bn_bill_t bill;
        const char *pk = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";
        const char *escrow = "{\"merchant\":\"orbit.bitpos-near.testnet\",\"bill_id\":\"b_host_test_0001\",\"token\":\"tusd.bitpos-near.testnet\",\"total\":\"4500000\","
                             "\"payouts\":[{\"account\":\"orbit.bitpos-near.testnet\",\"amount\":\"3600000\"},{\"account\":\"mai.orbit.bitpos-near.testnet\",\"amount\":\"900000\"}],"
                             "\"expires_at_ms\":\"1794000000000\",\"witness_pk\":\"03A107BFF3CE10BE1D70DD18E74BC09967E4D6309BA50D5F1DDC8664125531B8\",\"witness_timeout_ms\":\"120000\","
                             "\"state\":\"Escrow\",\"payer\":\"alice.bitpos-near.testnet\",\"paid_at_ms\":\"1793999990000\",\"note\":\"caf\\u00e9 \\\"x\\\"\"}";
        size_t n = rpc_wrap(body, sizeof(body), escrow);
        bn_parse_t rc = bn_parse_rpc_bill(body, n, scratch, &bill);
        CHECK("parse-escrow", rc == BN_PARSE_OK && bill.state == BN_STATE_ESCROW && !strcmp(bill.total, "4500000") && bill.has_payer && !strcmp(bill.payer, "alice.bitpos-near.testnet") &&
              bill.has_witness && !strcmp(bill.witness_pk, pk) && !strcmp(bill.token, "tusd.bitpos-near.testnet"));
        CHECK("decide-witness", bn_decide(&bill, "orbit.bitpos-near.testnet", "b_host_test_0001", pk) == BN_SHOW_PAID_WITNESS);
        CHECK("decide-other-device-key", bn_decide(&bill, "orbit.bitpos-near.testnet", "b_host_test_0001", "ffa107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8") == BN_SHOW_CHECKING);
        CHECK("decide-other-bill", bn_decide(&bill, "orbit.bitpos-near.testnet", "b_host_test_0002", pk) == BN_SHOW_CHECKING);
        CHECK("decide-other-merchant", bn_decide(&bill, "evil.bitpos-near.testnet", "b_host_test_0001", pk) == BN_SHOW_CHECKING);

        const struct { const char *state; bn_show_t show; } states[] = {{"Open", BN_SHOW_QR}, {"Settling", BN_SHOW_PAID}, {"Settled", BN_SHOW_PAID}, {"PayoutFailed", BN_SHOW_CHECKING},
                                                                       {"Refunding", BN_SHOW_REFUNDED}, {"Refunded", BN_SHOW_REFUNDED}, {"Void", BN_SHOW_IDLE}};
        for (size_t i = 0; i < sizeof(states) / sizeof(states[0]); i++) {
            char json[512], name[48];
            snprintf(json, sizeof(json), "{\"merchant\":\"orbit.bitpos-near.testnet\",\"bill_id\":\"b_host_test_0001\",\"token\":\"tusd.bitpos-near.testnet\",\"total\":\"4500000\",\"state\":\"%s\",\"payer\":null,\"witness_pk\":null}", states[i].state);
            n = rpc_wrap(body, sizeof(body), json); rc = bn_parse_rpc_bill(body, n, scratch, &bill);
            snprintf(name, sizeof(name), "parse-decide-%s", states[i].state);
            CHECK(name, rc == BN_PARSE_OK && !bill.has_payer && !bill.has_witness && bn_decide(&bill, "orbit.bitpos-near.testnet", "b_host_test_0001", pk) == states[i].show);
        }
        const char *no_witness_escrow = "{\"merchant\":\"orbit.bitpos-near.testnet\",\"bill_id\":\"b_host_test_0001\",\"token\":\"tusd.bitpos-near.testnet\",\"total\":\"1\",\"state\":\"Escrow\",\"payer\":\"alice.testnet\"}";
        rc = bn_parse_bill_json(no_witness_escrow, strlen(no_witness_escrow), &bill);
        CHECK("escrow-without-witness-is-not-paid", rc == BN_PARSE_OK && !bill.has_witness && bn_decide(&bill, "orbit.bitpos-near.testnet", "b_host_test_0001", pk) == BN_SHOW_CHECKING);

        n = rpc_wrap(body, sizeof(body), "null");
        CHECK("parse-null-bill", bn_parse_rpc_bill(body, n, scratch, &bill) == BN_PARSE_NO_BILL);

        const char *rpc_error = "{\"jsonrpc\":\"2.0\",\"error\":{\"name\":\"HANDLER_ERROR\",\"cause\":{\"name\":\"UNKNOWN_ACCOUNT\"},\"code\":-32000,\"message\":\"Server error\"},\"id\":1}";
        CHECK("parse-rpc-error", bn_parse_rpc_bill(rpc_error, strlen(rpc_error), scratch, &bill) == BN_PARSE_RPC_ERROR);
        const char *contract_error = "{\"jsonrpc\":\"2.0\",\"result\":{\"block_height\":1,\"error\":\"wasm execution failed with error: MethodNotFound\",\"logs\":[]},\"id\":1}";
        CHECK("parse-contract-error", bn_parse_rpc_bill(contract_error, strlen(contract_error), scratch, &bill) == BN_PARSE_RPC_ERROR);
        CHECK("parse-no-result", bn_parse_rpc_bill("{\"jsonrpc\":\"2.0\",\"id\":1}", 24, scratch, &bill) == BN_PARSE_RPC_ERROR);

        const char *bad[] = {
            "", "[]", "nonsense", "{", "{\"result\":{\"result\":[123,34", "{\"result\":{\"result\":[256]}}", "{\"result\":{\"result\":[1,,2]}}",
            "{\"result\":{\"result\":[-1]}}", "{\"result\":{\"result\":[1.5]}}", "{\"result\":{\"result\":\"e30=\"}}", "{\"result\":{\"result\":[123,125]}} trailing",
            "{\"result\":{\"result\":[1234]}}"};
        int rejected = 0;
        for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) { rc = bn_parse_rpc_bill(bad[i], strlen(bad[i]), scratch, &bill); if (rc != BN_PARSE_OK && rc != BN_PARSE_NO_BILL) rejected++; else printf("INFO accepted malformed #%zu\n", i); }
        CHECK("parse-rejects-malformed", rejected == (int)(sizeof(bad) / sizeof(bad[0])));

        const char *bad_bills[] = {
            "{}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Paid\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1x\",\"state\":\"Open\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":1,\"state\":\"Open\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b:1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Open\"}",
            "{\"merchant\":\"Orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Open\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Escrow\",\"witness_pk\":\"abcd\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Escrow\",\"witness_pk\":7}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Esc\\u0072ow\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"99999999999999999999999999999999999999999\",\"state\":\"Open\"}",
            "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Open\"} {}"};
        rejected = 0;
        for (size_t i = 0; i < sizeof(bad_bills) / sizeof(bad_bills[0]); i++) { rc = bn_parse_bill_json(bad_bills[i], strlen(bad_bills[i]), &bill); if (rc != BN_PARSE_OK) rejected++; else printf("INFO accepted bad bill #%zu\n", i); }
        CHECK("parse-rejects-bad-bills", rejected == (int)(sizeof(bad_bills) / sizeof(bad_bills[0])));

        /* Oversize: a decoded bill one byte over the limit, and a response over the limit. */
        static char huge[BN_BILL_JSON_MAX + 64];
        int at = snprintf(huge, sizeof(huge), "{\"merchant\":\"orbit.testnet\",\"bill_id\":\"b1\",\"token\":\"tusd.testnet\",\"total\":\"1\",\"state\":\"Open\",\"pad\":\"");
        memset(huge + at, 'x', BN_BILL_JSON_MAX + 1 - (size_t)at - 2); memcpy(huge + BN_BILL_JSON_MAX + 1 - 2, "\"}", 3);
        n = rpc_wrap(body, sizeof(body), huge);
        CHECK("parse-rejects-oversize-bill", strlen(huge) == BN_BILL_JSON_MAX + 1 && n <= BN_RPC_RESPONSE_MAX && bn_parse_rpc_bill(body, n, scratch, &bill) == BN_PARSE_TOO_LARGE);
        huge[BN_BILL_JSON_MAX - 2] = '"'; huge[BN_BILL_JSON_MAX - 1] = '}'; huge[BN_BILL_JSON_MAX] = 0;
        n = rpc_wrap(body, sizeof(body), huge);
        CHECK("parse-accepts-bill-at-limit", bn_parse_rpc_bill(body, n, scratch, &bill) == BN_PARSE_OK && bill.state == BN_STATE_OPEN);
        memset(body, ' ', BN_RPC_RESPONSE_MAX + 1);
        CHECK("parse-rejects-oversize-response", bn_parse_rpc_bill(body, BN_RPC_RESPONSE_MAX + 1, scratch, &bill) == BN_PARSE_TOO_LARGE);
        /* Deep nesting must stop at the depth limit instead of recursing without bound. */
        static char deep[4096]; memset(deep, '[', 2000); memset(deep + 2000, ']', 2000); deep[4000] = 0;
        char wrapped[4200]; snprintf(wrapped, sizeof(wrapped), "{\"x\":%s,\"result\":{\"result\":[110,117,108,108]}}", deep);
        CHECK("parse-rejects-deep-nesting", bn_parse_rpc_bill(wrapped, strlen(wrapped), scratch, &bill) == BN_PARSE_MALFORMED);
        /* Embedded NUL bytes are not JSON. */
        const char nul[] = "{\"result\":{\"result\":[110,117,108,108]},\"n\":\0 1}";
        CHECK("parse-rejects-nul", bn_parse_rpc_bill(nul, sizeof(nul) - 1, scratch, &bill) == BN_PARSE_MALFORMED);
    }

    /* The fixed witness vector signs and verifies. */
    {
        uint8_t seed[32], pk[32], sig[64]; char message[BN_ACK_MESSAGE_MAX];
        vector(seed, pk, message, sizeof(message), sig);
        CHECK("witness-vector-verifies", bitpos_near_ed25519_verify(sig, (const uint8_t *)message, strlen(message), pk) == 0);
    }

    printf("%s: %d checks, %d failed\n", failures ? "FAILED" : "OK", checks, failures);
    return failures ? 1 : 0;
}
