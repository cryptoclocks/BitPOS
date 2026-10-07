/*
 * CryptoClock Pro — display_engine
 * AXS15231B (QSPI) + LVGL 9 glue: full-frame PSRAM draw buffer, chunked DMA
 * bounce buffers with inline software rotation + RGB565 byte swap, TE v-sync.
 */
#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Bring up QSPI panel, touch, LVGL core, tick timer and the LVGL task.
 * Backlight is left OFF; call ccp_board_set_brightness() once the first
 * frame is rendered to avoid showing garbage.
 */
esp_err_t display_engine_start(void);

/** Queue a callback for the LVGL task. The callback runs while the display
 *  engine's recursive LVGL lock is held, before the next lv_timer_handler().
 *  Non-blocking and safe to call from other tasks; false means not queued. */
typedef void (*display_engine_callback_t)(void *user_data);
bool display_engine_post_callback(display_engine_callback_t callback, void *user_data);

/** Recursive lock guarding every LVGL call made outside the LVGL task. */
bool display_engine_lock(uint32_t timeout_ms); /* 0 = wait forever */
void display_engine_unlock(void);

/**
 * Optional: register a short string describing what the calling code is
 * currently doing under the lock (e.g. "candle_render", "reload").
 * Read by the next display lock timeout log so we know not just WHO holds
 * the lock but WHAT they're doing with it. Safe to call repeatedly.
 * Cleared automatically on display_engine_unlock().
 */
void display_engine_lock_set_state(const char *state);

/** Inspect the current holder's state tag (or "none" if unlocked). */
const char *display_engine_lock_holder_state(void);

/** How long the current holder has held the lock, in ms (0 if unlocked). */
uint32_t display_engine_lock_holder_age_ms(void);

lv_display_t *display_engine_get_disp(void);

/** Logical resolution after rotation is applied. */
int display_engine_width(void);
int display_engine_height(void);

/** Live base rotation (0/90/180/270). Boots at CCP_DISPLAY_ROTATION; a
 *  package page whose layout JSON carries "rotation" switches orientation
 *  when shown (P009 portrait full-card). Caller must hold the LVGL lock.
 *  home_ui resets to CCP_DISPLAY_ROTATION on every page navigation. */
esp_err_t display_engine_set_rotation(int deg);
int display_engine_get_rotation(void);

/** Flush-rate estimate over the last second (sys_monitor telemetry). */
float display_engine_get_fps(void);

/** Monotonic count of full frames successfully transferred to the LCD. */
uint32_t display_engine_get_flush_count(void);

/** Runtime "rotate 180°" toggle (user menu). Flips the finished panel image
 *  and touch coordinates; applies live, no reboot. Not persisted here — the
 *  caller persists the choice (device.json) and re-applies it at boot. */
void display_engine_set_flip180(bool on);
bool display_engine_get_flip180(void);

#ifdef __cplusplus
}
#endif
