/* NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. */
#ifndef BITPOS_NEAR_HOST
#include "sdkconfig.h"
#endif
#if defined(BITPOS_NEAR_HOST) || CONFIG_BITPOS_PRODUCT_NEAR
#include <stdio.h>
#include <string.h>
#include "bitpos_near_core.h"

void bn_hex_encode(char *out, const uint8_t *in, size_t n) {
    static const char digits[] = "0123456789abcdef";
    for (size_t i = 0; i < n; i++) { out[2 * i] = digits[in[i] >> 4]; out[2 * i + 1] = digits[in[i] & 15]; }
    out[2 * n] = 0;
}
static int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
bool bn_hex_decode(uint8_t *out, size_t n, const char *hex) {
    for (size_t i = 0; i < n; i++) {
        int hi = hex_value(hex[2 * i]); if (hi < 0) return false;
        int lo = hex_value(hex[2 * i + 1]); if (lo < 0) return false;
        out[i] = (uint8_t)(hi << 4 | lo);
    }
    return hex[2 * n] == 0;
}

int bn_base58_encode(char *out, size_t cap, const uint8_t *in, size_t n) {
    static const char alphabet[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    uint8_t digits[96]; size_t count = 0, zeros = 0;
    if (n > 64) return -1; /* 64 bytes need at most 88 digits */
    while (zeros < n && in[zeros] == 0) zeros++;
    for (size_t i = zeros; i < n; i++) {
        unsigned carry = in[i];
        for (size_t j = 0; j < count; j++) { carry += (unsigned)digits[j] << 8; digits[j] = (uint8_t)(carry % 58); carry /= 58; }
        while (carry) { if (count >= sizeof(digits)) return -1; digits[count++] = (uint8_t)(carry % 58); carry /= 58; }
    }
    if (zeros + count + 1 > cap) return -1;
    size_t at = 0;
    for (size_t i = 0; i < zeros; i++) out[at++] = '1';
    for (size_t i = count; i > 0; i--) out[at++] = alphabet[digits[i - 1]];
    out[at] = 0;
    return (int)at;
}

int bn_base64_encode(char *out, size_t cap, const uint8_t *in, size_t n) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t need = (n + 2) / 3 * 4;
    if (need + 1 > cap) return -1;
    size_t at = 0;
    for (size_t i = 0; i < n; i += 3) {
        unsigned v = (unsigned)in[i] << 16 | (i + 1 < n ? (unsigned)in[i + 1] << 8 : 0) | (i + 2 < n ? in[i + 2] : 0);
        out[at++] = alphabet[v >> 18 & 63];
        out[at++] = alphabet[v >> 12 & 63];
        out[at++] = i + 1 < n ? alphabet[v >> 6 & 63] : '=';
        out[at++] = i + 2 < n ? alphabet[v & 63] : '=';
    }
    out[at] = 0;
    return (int)at;
}

bool bn_valid_account(const char *s) {
    size_t n = strlen(s);
    if (n < 2 || n > 64) return false;
    bool separator = true; /* true at the start: an id may not begin with a separator */
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { separator = false; continue; }
        if ((c == '.' || c == '-' || c == '_') && !separator) { separator = true; continue; }
        return false;
    }
    return !separator;
}
bool bn_valid_bill_id(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > 64) return false;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
    }
    return true;
}

int bn_ack_message(char *out, size_t cap, const char *contract, const char *merchant, const char *bill_id) {
    if (!bn_valid_account(contract) || !bn_valid_account(merchant) || !bn_valid_bill_id(bill_id)) return -1;
    int n = snprintf(out, cap, "bitpos-near-ack:v1:%s:%s:%s", contract, merchant, bill_id);
    return n > 0 && (size_t)n < cap ? n : -1;
}

int bn_rpc_request(char *out, size_t cap, const char *contract, const char *merchant, const char *bill_id) {
    if (!bn_valid_account(contract) || !bn_valid_account(merchant) || !bn_valid_bill_id(bill_id)) return -1;
    char args[200], b64[280];
    int a = snprintf(args, sizeof(args), "{\"merchant\":\"%s\",\"bill_id\":\"%s\"}", merchant, bill_id);
    if (a <= 0 || (size_t)a >= sizeof(args) || bn_base64_encode(b64, sizeof(b64), (const uint8_t *)args, (size_t)a) < 0) return -1;
    int n = snprintf(out, cap,
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\","
        "\"finality\":\"final\",\"account_id\":\"%s\",\"method_name\":\"get_bill\",\"args_base64\":\"%s\"}}", contract, b64);
    return n > 0 && (size_t)n < cap ? n : -1;
}

/* ---- A small, bounded JSON reader -------------------------------------------------------------------------
 * Only what the two answers need: walk the keys of an object, skip any value (depth-limited), read a short
 * ASCII string or an array of byte values. Nothing is allocated and nothing is read past `end`. */
#define DEPTH_MAX 12
typedef struct { const char *p, *end; } cursor_t;

static void skip_space(cursor_t *c) { while (c->p < c->end && (*c->p == ' ' || *c->p == '\t' || *c->p == '\n' || *c->p == '\r')) c->p++; }
static bool take(cursor_t *c, char ch) { skip_space(c); if (c->p < c->end && *c->p == ch) { c->p++; return true; } return false; }
static bool peek(cursor_t *c, char ch) { skip_space(c); return c->p < c->end && *c->p == ch; }
static bool literal(cursor_t *c, const char *word) {
    size_t n = strlen(word); skip_space(c);
    if ((size_t)(c->end - c->p) < n || memcmp(c->p, word, n)) return false;
    c->p += n; return true;
}
/* Reads a JSON string. With out != NULL the content must be plain printable ASCII without escapes and fit cap;
 * with out == NULL the string is only skipped (escapes allowed). */
static bool string(cursor_t *c, char *out, size_t cap) {
    if (!take(c, '"')) return false;
    size_t n = 0;
    while (c->p < c->end) {
        unsigned char ch = (unsigned char)*c->p++;
        if (ch == '"') { if (out) out[n] = 0; return true; }
        if (ch < 0x20) return false;
        if (ch == '\\') {
            if (out || c->p >= c->end) return false;
            char e = *c->p++;
            if (e == 'u') { if (c->end - c->p < 4) return false; for (int i = 0; i < 4; i++) if (hex_value(c->p[i]) < 0) return false; c->p += 4; }
            else if (!e || !strchr("\"\\/bfnrt", e)) return false;
            continue;
        }
        if (out) { if (ch > 0x7e || n + 1 >= cap) return false; out[n++] = (char)ch; }
    }
    return false;
}
static bool skip_value(cursor_t *c, int depth) {
    if (depth > DEPTH_MAX) return false;
    skip_space(c);
    if (c->p >= c->end) return false;
    char ch = *c->p;
    if (ch == '"') return string(c, NULL, 0);
    if (ch == '{' || ch == '[') {
        char close = ch == '{' ? '}' : ']'; c->p++;
        if (take(c, close)) return true;
        for (;;) {
            if (ch == '{') { if (!string(c, NULL, 0) || !take(c, ':')) return false; }
            if (!skip_value(c, depth + 1)) return false;
            if (take(c, ',')) continue;
            return take(c, close);
        }
    }
    if (literal(c, "true") || literal(c, "false") || literal(c, "null")) return true;
    const char *start = c->p;
    while (c->p < c->end && *c->p && (strchr("+-.eE", *c->p) || (*c->p >= '0' && *c->p <= '9'))) c->p++;
    return c->p > start;
}
/* Positions the cursor on the value of `key` inside the object that starts at the cursor. The cursor is left
 * after the ':' of that key. Returns false when the object has no such key or is malformed. */
static bool find_key(cursor_t *c, const char *key) {
    char name[24];
    if (!take(c, '{')) return false;
    if (peek(c, '}')) return false;
    for (;;) {
        cursor_t at = *c;
        bool named = string(&at, name, sizeof(name)); /* long or escaped keys are not ours: skip them */
        if (!string(c, NULL, 0) || !take(c, ':')) return false;
        if (named && !strcmp(name, key)) return true;
        if (!skip_value(c, 1)) return false;
        if (!take(c, ',')) return false;
    }
}

static bn_state_t state_of(const char *s) {
    static const struct { const char *name; bn_state_t state; } names[] = {
        {"Open", BN_STATE_OPEN}, {"Escrow", BN_STATE_ESCROW}, {"Settling", BN_STATE_SETTLING}, {"Settled", BN_STATE_SETTLED},
        {"PayoutFailed", BN_STATE_PAYOUT_FAILED}, {"Refunding", BN_STATE_REFUNDING}, {"Refunded", BN_STATE_REFUNDED}, {"Void", BN_STATE_VOID}};
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) if (!strcmp(s, names[i].name)) return names[i].state;
    return BN_STATE_UNKNOWN;
}

/* One required string field of the bill object. */
static bool field(const char *json, size_t len, const char *key, char *out, size_t cap) {
    cursor_t c = {json, json + len};
    return find_key(&c, key) && string(&c, out, cap);
}
/* A string-or-null field: *present says which. A missing key counts as null. */
static bool optional(const char *json, size_t len, const char *key, char *out, size_t cap, bool *present) {
    cursor_t c = {json, json + len};
    *present = false; out[0] = 0;
    if (!find_key(&c, key)) {
        cursor_t whole = {json, json + len};
        return skip_value(&whole, 0); /* absent is fine as long as the object itself is well formed */
    }
    if (literal(&c, "null")) return true;
    *present = true;
    return string(&c, out, cap);
}

bn_parse_t bn_parse_bill_json(const char *json, size_t len, bn_bill_t *out) {
    char state[16];
    memset(out, 0, sizeof(*out));
    if (len > BN_BILL_JSON_MAX) return BN_PARSE_TOO_LARGE;
    cursor_t whole = {json, json + len};
    if (literal(&whole, "null")) { skip_space(&whole); return whole.p == whole.end ? BN_PARSE_NO_BILL : BN_PARSE_MALFORMED; }
    whole.p = json;
    if (!peek(&whole, '{') || !skip_value(&whole, 0)) return BN_PARSE_MALFORMED;
    skip_space(&whole);
    if (whole.p != whole.end) return BN_PARSE_MALFORMED;
    if (!field(json, len, "merchant", out->merchant, sizeof(out->merchant)) || !bn_valid_account(out->merchant)) return BN_PARSE_BAD_FIELD;
    if (!field(json, len, "bill_id", out->bill_id, sizeof(out->bill_id)) || !bn_valid_bill_id(out->bill_id)) return BN_PARSE_BAD_FIELD;
    if (!field(json, len, "token", out->token, sizeof(out->token)) || !bn_valid_account(out->token)) return BN_PARSE_BAD_FIELD;
    if (!field(json, len, "total", out->total, sizeof(out->total)) || !out->total[0]) return BN_PARSE_BAD_FIELD;
    for (const char *d = out->total; *d; d++) if (*d < '0' || *d > '9') return BN_PARSE_BAD_FIELD;
    if (!field(json, len, "state", state, sizeof(state)) || (out->state = state_of(state)) == BN_STATE_UNKNOWN) return BN_PARSE_BAD_FIELD;
    if (!optional(json, len, "payer", out->payer, sizeof(out->payer), &out->has_payer)) return BN_PARSE_BAD_FIELD;
    if (out->has_payer && !bn_valid_account(out->payer)) return BN_PARSE_BAD_FIELD;
    if (!optional(json, len, "witness_pk", out->witness_pk, sizeof(out->witness_pk), &out->has_witness)) return BN_PARSE_BAD_FIELD;
    if (out->has_witness) {
        uint8_t raw[32];
        if (strlen(out->witness_pk) != 64 || !bn_hex_decode(raw, 32, out->witness_pk)) return BN_PARSE_BAD_FIELD;
        bn_hex_encode(out->witness_pk, raw, 32); /* normalise to lower case */
    }
    return BN_PARSE_OK;
}

bn_parse_t bn_parse_rpc_bill(const char *body, size_t len, char *scratch, bn_bill_t *out) {
    memset(out, 0, sizeof(*out));
    if (len > BN_RPC_RESPONSE_MAX) return BN_PARSE_TOO_LARGE;
    cursor_t whole = {body, body + len};
    if (!peek(&whole, '{') || !skip_value(&whole, 0)) return BN_PARSE_MALFORMED;
    skip_space(&whole);
    if (whole.p != whole.end) return BN_PARSE_MALFORMED;
    cursor_t error = {body, body + len};
    if (find_key(&error, "error")) return BN_PARSE_RPC_ERROR;
    cursor_t c = {body, body + len};
    if (!find_key(&c, "result") || !peek(&c, '{')) return BN_PARSE_RPC_ERROR;
    cursor_t inner_error = c;
    if (find_key(&inner_error, "error")) return BN_PARSE_RPC_ERROR; /* contract panic or missing method */
    if (!find_key(&c, "result") || !take(&c, '[')) return BN_PARSE_MALFORMED;
    size_t n = 0;
    if (!take(&c, ']')) {
        for (;;) {
            skip_space(&c);
            unsigned value = 0; int digits = 0;
            while (c.p < c.end && *c.p >= '0' && *c.p <= '9' && digits < 4) { value = value * 10 + (unsigned)(*c.p++ - '0'); digits++; }
            if (!digits || digits > 3 || value > 255) return BN_PARSE_MALFORMED;
            if (n >= BN_BILL_JSON_MAX) return BN_PARSE_TOO_LARGE;
            scratch[n++] = (char)value;
            if (take(&c, ',')) continue;
            if (take(&c, ']')) break;
            return BN_PARSE_MALFORMED;
        }
    }
    return bn_parse_bill_json(scratch, n, out);
}

bn_show_t bn_decide(const bn_bill_t *bill, const char *merchant, const char *bill_id, const char *own_pk_hex) {
    if (strcmp(bill->merchant, merchant) || strcmp(bill->bill_id, bill_id)) return BN_SHOW_CHECKING;
    switch (bill->state) {
    case BN_STATE_OPEN: return BN_SHOW_QR;
    case BN_STATE_ESCROW:
        return bill->has_witness && own_pk_hex && strlen(own_pk_hex) == 64 && !strcmp(bill->witness_pk, own_pk_hex) ? BN_SHOW_PAID_WITNESS : BN_SHOW_CHECKING;
    case BN_STATE_SETTLING: case BN_STATE_SETTLED: return BN_SHOW_PAID;
    case BN_STATE_REFUNDING: case BN_STATE_REFUNDED: return BN_SHOW_REFUNDED;
    case BN_STATE_VOID: return BN_SHOW_IDLE;
    default: return BN_SHOW_CHECKING; /* PayoutFailed: money is still in the contract, not yet with the shop */
    }
}
#endif
