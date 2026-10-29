#pragma once
#include "bitpos_table.h"
#include "lvgl.h"
#include <stdatomic.h>
#define PROMOTION_BYTES 112000
#define PROMOTION_SLOTS 2
#define PROMOTION_TOKEN 44
#define PROMOTION_PLAYLIST_ITEMS 4
#define PROMOTION_DWELL_MS 10000
/* Nonfinancial presentation only; never serialized into the ordering journal. */
typedef struct {
    char target[TABLE_UUID], campaign[TABLE_UUID], product[TABLE_UUID];
    char discount_label[32];bool bundle;
    char headline[161], copy[361], menu_url[384], offer[PROMOTION_TOKEN];
    char image_url[384], sha256[65];
    table_money_t unit, base;
    unsigned percent, campaign_version;
    int64_t starts_ms, expires_ms;
    uint64_t screen, assignment, auth, playlist_generation, occupancy;
    char table_id[TABLE_UUID];
    bool active, canceled, has_image, personal;
} promotion_t;
bool promotion_parse(const table_state_t *table,cJSON *envelope,promotion_t *out);
/* Immutable metadata is replaced atomically by the single consumer. No pixels,
 * identity, rationale, journal state or unbounded dynamic storage live here. */
typedef struct {
    uint64_t generation, occupancy, screen, assignment, auth;
    char table_id[TABLE_UUID];
    promotion_t items[PROMOTION_PLAYLIST_ITEMS];
    unsigned count;
} promotion_playlist_t;
_Static_assert(sizeof(promotion_playlist_t)<=8192,"Playlist metadata exceeds 8KiB");
/* payload is promotionPlaylist in CONFIG/SNAPSHOT/CART or the event payload.
 * These parsers do not establish reconnect authority; the consumer does. */
bool promotion_playlist_parse(const table_state_t *table,cJSON *payload,uint64_t screen,promotion_playlist_t *out);
bool promotion_playlist_event(const table_state_t *table,cJSON *envelope,promotion_playlist_t *out);
bool promotion_item_current(const promotion_t *item,int64_t now);
/* Phase 0/2 select rotating daily items, phase 1 valid personal (daily fallback).
 * Returns -1 when no item is currently eligible. */
int promotion_playlist_select(const promotion_playlist_t *playlist,int64_t now,unsigned phase,unsigned daily_index);
bool promotion_hash(const uint8_t *data,size_t length,const char *sha256);
bool promotion_image_url(const char *origin,const char *url);
/* Platform operations are explicit boundaries. All execute only on image worker.
 * read/write are restricted fixed-slot cache operations, never arbitrary paths.
 * download must validate HTTPS/headers/length and observe canceled during reads. */
typedef struct {
    bool (*read)(unsigned slot,const char *hash,uint8_t *pixels);
    bool (*write)(unsigned slot,const char *hash,const uint8_t *pixels);
    bool (*download)(const promotion_t *job,uint8_t *pixels,unsigned serial);
    bool (*enqueue)(const promotion_t *job,unsigned serial);
} promotion_image_ops_t;
bool promotion_images_init(uint8_t *slot0,uint8_t *slot1,const promotion_image_ops_t *ops);
bool promotion_images_supported(void);
unsigned promotion_image_request(const promotion_t *job);
void promotion_image_cancel(void);
bool promotion_image_canceled(unsigned serial);
void promotion_image_work(const promotion_t *job,unsigned serial);
/* Acquire/release run in consumer under LVGL lock; worker never mutates pinned pixels. */
const lv_image_dsc_t *promotion_image_acquire(const promotion_t *job);
void promotion_image_release(void);
unsigned promotion_image_revision(void);
const char *promotion_image_fallback(void);
/* ESP-IDF boundary startup, no flashing/provisioning/financial authority. */
bool bitpos_promotion_images_start(void);
