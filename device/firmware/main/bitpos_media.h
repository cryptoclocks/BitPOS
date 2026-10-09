#pragma once

#include <stdbool.h>
#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Call once from optional startup work, after display_engine_start(), outside the
 * UI/WS task and display lock. Missing/unsafe media is nonfatal. This module
 * never formats or provisions SD. Existing mount also serves bitpos/menu/v1.
 *
 * Integration: fatfs, sdmmc, esp_driver_sdmmc, esp_psram, board_bsp,
 * display_engine, lvgl and mbedtls (IDF5.5.1/LVGL9.2.2 pinned).
 * Enable LV_USE_GIF, LV_GIF_CACHE_DECODE_DATA, LV_USE_STDLIB_MALLOC=CLIB,
 * SPIRAM_USE_MALLOC, FATFS_LFN_STACK (startup stack >=8192), MAX_LFN=64.
 * No generic LVGL STDIO driver is needed. Reserve drive M for this module.
 * Google Noto Emoji CC BY 4.0 attribution/technical modifications must remain
 * in product About/docs/credits; reference motion-lab/assets/gif/ATTRIBUTION.md.
 */
void bitpos_media_init(void);

/* Stable immutable LVGL path, or NULL when not ready/insufficient headroom.
 * UI holds the display lock, creates at most one GIF, and deletes it (not just
 * pauses it) before payment-critical rendering. Allocation/first-frame decode
 * remain synchronous LVGL work: only open on noncritical idle.
 */
const char *bitpos_media_gif_path(void);
bool bitpos_media_available(void);

/* Startup publishes all twelve immutable RGB565 descriptors or none. Lookup
 * never opens/decodes/hashes/copies pixels, and scene teardown never frees them. */
const lv_image_dsc_t *bitpos_media_photo(unsigned asset_id);
bool bitpos_media_photos_available(void);

/* After successful lv_gif_set_src, under LVGL lock and before first paint:
 * correct the pinned decoder's opaque initial background using validated
 * unique transparent-palette semantics. No source bytes/art colors change. */
bool bitpos_media_prepare_canvas(lv_obj_t *gif);

#ifdef __cplusplus
}
#endif
