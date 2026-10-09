#include "bitpos_probe.h"

#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include "display_engine.h"
#include "driver/usb_serial_jtag.h"
#include "esp_app_desc.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"

#define MAX_PIXELS_BYTES 307200U
#define HEADER_BYTES 128U
#define TX_CHUNK 512U
#define TX_BUDGET_US 5000000LL

static const char command[] = "BITPOS_CAPTURE_FRAME_V1\n";
static const uint8_t magic[16] = "BITPOS_FRAME_V1";
static const uint8_t trailer[16] = "BITPOS_FRAME_END";
static atomic_bool initialized;
static atomic_bool quiet;
static atomic_uint active_logs;
static vprintf_like_t baseline_print = vprintf;
/* Accessed only while holding the existing display lock. */
static bool completed;
static uint32_t before_flush, completed_count;
static lv_draw_buf_t *completed_buffer;
static uint16_t completed_rotation;
static bool completed_flip;

/* Tag suppression does not stop a log already inside simple-VFS output.
 * This gate drains such callers without making WS/ACK callers wait for USB.
 * Parent must retain exclusive ownership of the log callback/direct stdout.
 */
static int probe_print(const char *format, va_list args)
{
    atomic_fetch_add(&active_logs, 1);
    int result = 0;
    if (!atomic_load(&quiet)) result = baseline_print(format, args);
    atomic_fetch_sub(&active_logs, 1);
    return result;
}

static void display_event(lv_event_t *event)
{
    lv_event_code_t code = lv_event_get_code(event);
    if (code == LV_EVENT_RENDER_START) completed = false;
    else if (code == LV_EVENT_FLUSH_START) {
        completed = false;
        before_flush = display_engine_get_flush_count();
    } else if (code == LV_EVENT_FLUSH_FINISH) {
        uint32_t count = display_engine_get_flush_count();
        /* Pinned flush_cb is synchronous; a failed DMA never advances count. */
        completed = count != before_flush;
        completed_count = count;
        completed_buffer = lv_display_get_buf_active(display_engine_get_disp());
        completed_rotation = (uint16_t)display_engine_get_rotation();
        completed_flip = display_engine_get_flip180();
    }
}

static void put16(uint8_t *dst, uint16_t value)
{
    dst[0] = (uint8_t)value;
    dst[1] = (uint8_t)(value >> 8);
}

static void put32(uint8_t *dst, uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i) dst[i] = (uint8_t)(value >> (8 * i));
}

static void put64(uint8_t *dst, uint64_t value)
{
    for (unsigned i = 0; i < 8; ++i) dst[i] = (uint8_t)(value >> (8 * i));
}

static bool frame_view(lv_draw_buf_t **buffer, uint16_t *width, uint16_t *height)
{
    lv_display_t *display = display_engine_get_disp();
    if (!display || lv_display_is_double_buffered(display) || !completed || !completed_count ||
        display_engine_get_flush_count() != completed_count) return false;
    lv_draw_buf_t *buf = lv_display_get_buf_active(display);
    int32_t w = lv_display_get_horizontal_resolution(display);
    int32_t h = lv_display_get_vertical_resolution(display);
    if (!buf || buf != completed_buffer || !buf->data || w <= 0 || h <= 0 ||
        w > 480 || h > 480 || (uint32_t)w * (uint32_t)h > MAX_PIXELS_BYTES / 2 ||
        buf->header.w != (uint32_t)w || buf->header.h != (uint32_t)h ||
        buf->header.cf != LV_COLOR_FORMAT_RGB565 ||
        lv_display_get_color_format(display) != LV_COLOR_FORMAT_RGB565 ||
        buf->header.stride != (uint32_t)w * 2 ||
        buf->data_size < (uint32_t)w * (uint32_t)h * 2) return false;
    *buffer = buf;
    *width = (uint16_t)w;
    *height = (uint16_t)h;
    return true;
}

static uint8_t *snapshot(uint8_t header[HEADER_BYTES], size_t *bytes)
{
    lv_draw_buf_t *buf;
    uint16_t width, height;
    if (!display_engine_lock(1000)) {
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=snapshot_lock");
        return NULL;
    }
    bool safe = frame_view(&buf, &width, &height);
    display_engine_unlock();
    if (!safe) {
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=frame_view");
        return NULL;
    }
    *bytes = (size_t)width * height * 2;
    /* One PSRAM allocation per explicit request, never a retained frame cache. */
    uint8_t *pixels = heap_caps_malloc(*bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!pixels) {
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=psram");
        return NULL;
    }
    if (!display_engine_lock(1000)) {
        heap_caps_free(pixels);
        return NULL;
    }
    uint16_t current_width, current_height;
    safe = frame_view(&buf, &current_width, &current_height) &&
        current_width == width && current_height == height;
    if (safe) {
        memcpy(pixels, buf->data, *bytes);
        memset(header, 0, HEADER_BYTES);
        memcpy(header, magic, sizeof(magic));
        put16(header + 16, HEADER_BYTES);
        put16(header + 18, width);
        put16(header + 20, height);
        put16(header + 22, 1); /* tightly packed RGB565 little endian */
        put32(header + 24, (uint32_t)*bytes);
        put32(header + 28, completed_count);
        put64(header + 32, (uint64_t)esp_timer_get_time());
        put16(header + 46, completed_rotation);
        header[48] = completed_flip ? 1 : 0;
    }
    display_engine_unlock(); /* No hashing or serial send inside LVGL lock. */
    if (!safe || esp_read_mac(header + 40, ESP_MAC_WIFI_STA) != ESP_OK ||
        mbedtls_sha256(pixels, *bytes, header + 88, 0) != 0) {
        heap_caps_free(pixels);
        return NULL;
    }
    const char *version = esp_app_get_description()->version;
    size_t version_size = strnlen(version, 32);
    if (version_size == 32) {
        heap_caps_free(pixels);
        return NULL;
    }
    memcpy(header + 56, version, version_size);
    return pixels;
}

static bool send_bytes(const uint8_t *data, size_t bytes, int64_t deadline)
{
    while (bytes) {
        int64_t remaining = deadline - esp_timer_get_time();
        if (remaining <= 0) return false;
        /* SDK write can wait once on tx_mux AND once on ring space. Divide
         * remaining time by two, round DOWN, and cap each wait at 10ms. */
        uint32_t ms = (uint32_t)(remaining / 2000);
        if (ms > 10) ms = 10;
        TickType_t ticks = pdMS_TO_TICKS(ms);
        size_t chunk = bytes > TX_CHUNK ? TX_CHUNK : bytes;
        if (usb_serial_jtag_write_bytes(data, chunk, ticks) != (int)chunk) return false;
        data += chunk;
        bytes -= chunk;
        if (esp_timer_get_time() >= deadline) return false;
    }
    return true;
}

/* false means the exclusive driver was discarded; stop the optional reader. */
static bool capture(void)
{
    uint8_t header[HEADER_BYTES];
    size_t bytes = 0;
    uint8_t *pixels = snapshot(header, &bytes);
    if (!pixels) return true; /* No-heap/unsafe view: no TX, baseline unchanged. */
    ESP_LOGI("BitPOS","BITPOS_PROBE capture=ready bytes=%u",(unsigned)bytes);
    esp_log_level_t bitpos_level = esp_log_level_get("BitPOS");
    esp_log_level_t media_level = esp_log_level_get("BitPOSMedia");
    atomic_store(&quiet, true);
    esp_log_level_set("BitPOS", ESP_LOG_NONE);
    esp_log_level_set("BitPOSMedia", ESP_LOG_NONE);
    int64_t drain_deadline = esp_timer_get_time() + 100000;
    while (atomic_load(&active_logs) && esp_timer_get_time() < drain_deadline)
        vTaskDelay(1);
    bool driver_kept = true;
    if (!atomic_load(&active_logs)) {
        int64_t deadline = esp_timer_get_time() + TX_BUDGET_US;
        bool sent = send_bytes(header, sizeof(header), deadline) &&
            send_bytes(pixels, bytes, deadline) && send_bytes(trailer, sizeof(trailer), deadline);
        int64_t remaining = deadline - esp_timer_get_time();
        sent = sent && remaining > 0 && usb_serial_jtag_wait_tx_done(
            pdMS_TO_TICKS((uint32_t)(remaining / 1000))) == ESP_OK;
        if (!sent) {
            /* Never allow a stalled ring/ISR to emit late binary into restored
             * simple-VFS logs. This task also installed the driver on this core. */
            usb_serial_jtag_driver_uninstall();
            driver_kept = false;
        }
    }
    heap_caps_free(pixels);
    esp_log_level_set("BitPOS", bitpos_level);
    esp_log_level_set("BitPOSMedia", media_level);
    atomic_store(&quiet, false);
    return driver_kept;
}

static void probe_task(void *arg)
{
    (void)arg;
    /* SDK install has a missing TX-allocation check; see header caveat.
     * Optional startup must not compete with another driver installer. */
    if (usb_serial_jtag_is_driver_installed() ||
        heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) < 32768 ||
        heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) < 8192) {
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=driver_preflight");
        goto finish;
    }
    usb_serial_jtag_driver_config_t config = { .tx_buffer_size = 2048, .rx_buffer_size = 256 };
    if (usb_serial_jtag_driver_install(&config) != ESP_OK) {
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=driver_install");
        goto finish;
    }
    ESP_LOGI("BitPOS","BITPOS_PROBE reader=ready");
    size_t matched = 0;
    bool rejected_line = false;
    for (;;) {
        uint8_t input[64];
        int length = usb_serial_jtag_read_bytes(input, sizeof(input), pdMS_TO_TICKS(100));
        for (int i = 0; i < length; ++i) {
            uint8_t ch = input[i];
            if (!rejected_line && ch == (uint8_t)command[matched]) ++matched;
            else rejected_line = true;
            if (ch == '\n') {
                bool explicit_capture = !rejected_line && matched == sizeof(command) - 1;
                matched = 0;
                rejected_line = false;
                if (explicit_capture && !capture()) goto finish;
            }
        }
    }
finish:
    vTaskDelete(NULL);
}

void bitpos_probe_init(void)
{
    /* Register before consumer/media/network startup, excluding all LVGL
     * allocations with its display lock. Pinned lv_event_add asserts on OOM;
     * CLIB has no lv_mem_monitor implementation, so probe its actual allocator. */
    if (atomic_exchange(&initialized, true)) return;
    /* The engine starts its renderer before returning: initial LCD DMA takes
     * about100ms, so25ms can permanently miss startup observer registration. */
    if (!display_engine_lock(2000)) {
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=init_lock");
        return;
    }
    lv_display_t *display = display_engine_get_disp();
    uint32_t observers = display ? lv_display_get_event_count(display) : 0;
    bool allocator_ready = false;
#if LV_USE_STDLIB_MALLOC == LV_STDLIB_CLIB
    void *reserve = lv_malloc(4096);
    allocator_ready = reserve != NULL;
    lv_free(reserve);
#else
    lv_mem_monitor_t memory = {0};
    lv_mem_monitor(&memory);
    allocator_ready = memory.free_size >= 8192 && memory.free_biggest_size >= 4096;
#endif
    if (!display || observers > 64 || !allocator_ready) {
        display_engine_unlock();
        ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=allocator");
        return;
    }
    lv_display_add_event_cb(display, display_event, LV_EVENT_ALL, NULL);
    baseline_print = esp_log_set_vprintf(probe_print);
    BaseType_t started=xTaskCreatePinnedToCore(probe_task,"bitpos_probe",4096,NULL,1,NULL,xPortGetCoreID());
    if (started != pdPASS) {
        esp_log_set_vprintf(baseline_print);
        lv_display_remove_event_cb_with_user_data(display, display_event, NULL);
    }
    display_engine_unlock();
    if(started==pdPASS)ESP_LOGI("BitPOS","BITPOS_PROBE observer=ready");
    else ESP_LOGI("BitPOS","BITPOS_PROBE unavailable=task_creation");
}
