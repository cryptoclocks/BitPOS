#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"

#define TABLE_LINES 50
#define TABLE_PAGE_ROWS 4
#define TABLE_SEND_MAX 7168
#define TABLE_UUID 37
#define TABLE_VERSION 65

typedef struct { char currency[5]; uint8_t decimals; uint64_t minor; } table_money_t;
typedef struct { char product[TABLE_UUID]; uint8_t qty; } table_item_t;
typedef struct {
    char product[TABLE_UUID], name[96], category[96];
    table_money_t unit; uint8_t qty; int8_t asset; bool available;
    uint64_t discount; uint8_t percent; bool promotion;
} table_row_t;
typedef enum { TC_NONE, TC_OPEN, TC_SET, TC_REVIEW, TC_SUBMIT, TC_RELEASE, TC_DISMISS, TC_CANCEL } table_command_t;
typedef struct {
    table_command_t kind;
    char request[TABLE_UUID], session[TABLE_UUID], quote[TABLE_UUID], key[TABLE_UUID];
    char price[TABLE_VERSION];
    char recover[TABLE_UUID];
    uint64_t screen, assignment, cart;
    char order[TABLE_UUID]; uint32_t order_version;
} table_pending_t;
typedef struct {
    char session[TABLE_UUID], price[TABLE_VERSION], locked_order[TABLE_UUID];
    uint64_t cart, screen, assignment;
    table_item_t acknowledged[TABLE_LINES], desired[TABLE_LINES];
    uint8_t count, desired_count;
    bool paused_desired;
    table_pending_t pending;
} table_durable_t;
typedef struct { char product[TABLE_UUID],name[96];table_money_t unit; } table_cart_label_t;
typedef struct {
    table_durable_t saved;
    uint64_t connection, screen, assignment, pairing, seq;
    bool configured, synchronized, online, storage_ok, resolving, cart_owner, order_owner;
    bool menu_advance, observed_cart;
    bool quote_ready, quote_loading, can_dismiss, needs_resume;
    char device[TABLE_UUID], label[96], serving[96], menu[TABLE_VERSION], price[TABLE_VERSION];
    char quote[TABLE_UUID], quote_price[TABLE_VERSION], quote_until[32];
    char payment_origin[192], table_entry_url[256];
    int64_t menu_generated_ms,menu_until_ms;
    int64_t quote_until_ms;
    uint64_t quote_cart; table_money_t total, settlement;
    unsigned menu_page, menu_pages, menu_count, rows_count, review_count, review_pages, loaded_pages;
    table_row_t rows[TABLE_PAGE_ROWS], review[TABLE_LINES];
    char notice[96], read_request[TABLE_UUID], sync_request[TABLE_UUID];
    char ack_request[TABLE_UUID],heartbeat_request[TABLE_UUID];
    uint32_t read_started, pending_started, heartbeat_at;
    unsigned view, scroll, detail; /* 0 home, 1 menu, 2 cart, 3 review, 4 photo */
    char category[96];
    table_cart_label_t cart_labels[TABLE_LINES];
    unsigned cart_label_count;
    unsigned category_cycle;
} table_state_t;
_Static_assert(sizeof(table_state_t)<=32768,"Ordering state exceeds fixed 32KiB budget");

bool table_integer(cJSON *object,const char *key,uint64_t *out);
bool table_text(cJSON *object,const char *key,char *out,size_t cap);
bool table_uuid(const char *value);
bool table_money(cJSON *json,table_money_t *out,bool legacy);
void table_format_money(const table_money_t *money,char *out,size_t cap);
bool table_timestamp(cJSON *json,const char *key,int64_t *out);
bool table_settlement(cJSON *json,table_money_t *out);
bool table_items(cJSON *json,table_item_t *items,uint8_t *count);
bool table_rows(cJSON *json,table_row_t *rows,unsigned *count,bool review);
bool table_config(table_state_t *state,cJSON *payload);
bool table_catalog(table_state_t *state,cJSON *payload);
bool table_quote(table_state_t *state,cJSON *payload);
bool table_quote_page(table_state_t *state,cJSON *payload);
bool table_cart(table_state_t *state,cJSON *screen);
bool table_envelope(table_state_t *state,cJSON *json,const char *device,bool *event);
size_t table_command_json(const table_state_t *state,char *out,size_t capacity);
/* Compact dual-slot journal codec: CRC32, format and monotonically increasing record sequence. */
#define TABLE_JOURNAL_MAX 4096
size_t table_journal_encode(const table_durable_t *saved,uint64_t sequence,uint8_t *out,size_t cap);
bool table_journal_decode(const uint8_t *data,size_t length,table_durable_t *saved,uint64_t *sequence);
typedef struct { unsigned used,offset,frame_length,frames,chunks;bool active,frame_fin;uint8_t opcode; } table_fragment_t;
/* -1 requires transport resync, 0 waits/ignores control, 1 complete text. */
int table_fragment(table_fragment_t *state,char buffer[8192],uint8_t opcode,bool fin,int frame_length,int offset,const char *data,int length);
bool table_json_bounded(const char *data,size_t length);
bool table_display_text(const char *text);
bool table_version(const char *text);
