#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Independent optional startup, nonfatal. Dependencies: esp_driver_i2s,
 * board_bsp, mbedtls, freertos and libm. Pins42/2/41,16kHz16-bit stereo MSB
 * preserve the native NS4168 configuration. Worker stack8192, queue4 copies,
 * native PAID cue20480B fixed storage; no MP3 decoder. Optional quiet attract
 * melody uses the existing worker's fixed chunk buffer and is preemptible.
 * Optional original approved WAV: /sdcard/bitpos/motion/v1/payment-success-device.wav.
 * Parent provisions it; media_init must finish its readonly mount first.
 */
void bitpos_audio_init(void);
void bitpos_audio_set_muted(bool muted);
bool bitpos_audio_is_muted(void);
/* Soft looping attract melody on the existing audio task. Cancels immediately
 * when QR/cart/payment takes priority; never uses the PAID cue or its claims. */
void bitpos_audio_set_attract(bool active);

/* Caller has already durably committed the once-only PAID NVS claim AND sent
 * the meaningful physical render ACK. Nonblocking queue copy; IDs are bounded
 * to95 public ASCII letters/digits/'-'/'_'. Missing worker, muted, full queue
 * or invalid ID silently drops. No retry/reconnect/snapshot replay here.
 */
void bitpos_audio_play_success(const char *order_id, uint32_t order_version);

#ifdef __cplusplus
}
#endif
