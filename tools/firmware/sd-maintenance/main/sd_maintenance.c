/* BitPOS temporary SD-only maintenance app; no display, NVS or networking.
 * Pin provenance: device/firmware/components/board_bsp/include/ccp_board.h.
 * Binary protocol and recovery constraints: ../README.md.
 */
#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "driver/sdmmc_host.h"
#include "driver/usb_serial_jtag.h"
#include "esp_heap_caps.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"
#include "sdmmc_cmd.h"
#include "../../../../device/firmware/main/bitpos_menu_assets.generated.h"

#define MOTION_ROOT "/sdcard/bitpos/motion/v1"
#define MENU_ROOT "/sdcard/bitpos/menu/v1"
#define COUNT (5 + BITPOS_MENU_ASSET_COUNT)
#define HEADER 64
#define PROTOCOL 2
#define MAX_FILE BITPOS_MENU_PHOTO_BYTES
#define RECEIVE_US 30000000LL

enum { HELLO = 0, SD_STATUS = 1, WRITE = 2 };
enum { SD_OK = 0, READY = 1, NOOP = 2, CONFLICT = 3, IO_ERROR = 4,
       INVALID = 5, TIMED_OUT = 6, NO_MEMORY = 7 };
enum { MISSING = 0, MATCH = 1, UNKNOWN = 2, UNREADABLE = 3 };
typedef struct { const char *name; uint32_t size; const char *hash; } asset_t;
static const asset_t motion_assets[5] = {
    {"coffee-128.gif", 85290, "618b8395ec723563136c721044fc87ac80622a4825873842fb1366cbfcd3336e"},
    {"sparkles-128.gif", 22300, "2d7fe7cd99d9985340500ff1ab9398ac8a5ec24f610d1aad688f8e00c38979e9"},
    {"party-popper-128.gif", 36413, "7003b93a6379b9be0a945c3e8f2235f459b5b8a13ff6a7465c03bddcd4f55e34"},
    {"confetti-128.gif", 38606, "724dd842e824ba5a43fdc3497cf7a77640447be141d307d09a9b2afae499b4d6"},
    {"payment-success-device.wav", 20524, "aa78633e92f389a5edc9216aa5068c0493ef1b17a661ebfcf81f0364e82af402"},
};
static asset_t assets[COUNT];
static void init_assets(void)
{
    memcpy(assets,motion_assets,sizeof(motion_assets));
    for(unsigned i=0;i<BITPOS_MENU_ASSET_COUNT;i++)
        assets[5+i]=(asset_t){bitpos_menu_assets[i].file,BITPOS_MENU_PHOTO_BYTES,bitpos_menu_assets[i].sha256};
}
static const char *asset_root(unsigned id) {return id<5?MOTION_ROOT:MENU_ROOT;}
static uint8_t nonce[16], report[8 + COUNT]; /* MAC6, mounted1, count1, states17 */
static bool mounted;
static uint32_t get32(const uint8_t *p)
{
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}
static void put32(uint8_t *p, uint32_t v)
{
    for (unsigned i = 0; i < 4; ++i) p[i] = v >> (8 * i);
}
static void expected_hash(unsigned id, uint8_t hash[32])
{
    for (unsigned i = 0; i < 32; ++i) {
        const char *s = assets[id].hash + 2 * i;
        unsigned a = s[0] <= '9' ? s[0] - '0' : s[0] - 'a' + 10;
        unsigned b = s[1] <= '9' ? s[1] - '0' : s[1] - 'a' + 10;
        hash[i] = (a << 4) | b;
    }
}
static void asset_path(unsigned id, char path[96])
{
    snprintf(path, 96, "%s/%s", asset_root(id), assets[id].name);
}
static uint8_t file_state(unsigned id, const char *path)
{
    struct stat st;
    if (stat(path, &st) != 0) return errno == ENOENT ? MISSING : UNREADABLE;
    if (!S_ISREG(st.st_mode) || st.st_size != assets[id].size) return UNKNOWN;
    int fd = open(path, O_RDONLY);
    if (fd < 0) return UNREADABLE;
    uint8_t buffer[1024], actual[32], expected[32];
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    bool valid = mbedtls_sha256_starts(&ctx, 0) == 0;
    uint32_t remaining = assets[id].size;
    int64_t until = esp_timer_get_time() + 3000000;
    while (valid && remaining && esp_timer_get_time() < until) {
        size_t want = remaining < sizeof(buffer) ? remaining : sizeof(buffer);
        ssize_t n = read(fd, buffer, want);
        if (n <= 0 || mbedtls_sha256_update(&ctx, buffer, n) != 0) valid = false;
        else remaining -= n;
    }
    if (valid) valid = remaining == 0 && read(fd, buffer, 1) == 0 && mbedtls_sha256_finish(&ctx, actual) == 0;
    mbedtls_sha256_free(&ctx);
    if (close(fd) != 0) valid = false;
    if (!valid) return UNREADABLE;
    expected_hash(id, expected);
    return memcmp(actual, expected, 32) == 0 ? MATCH : UNKNOWN;
}
static void refresh_report(void)
{
    report[6] = mounted;
    report[7] = COUNT;
    for (unsigned id = 0; id < COUNT; ++id) {
        char path[96];
        asset_path(id, path);
        report[8 + id] = mounted ? file_state(id, path) : UNREADABLE;
    }
}
static bool send_bytes(const void *data, size_t size)
{
    const uint8_t *p = data;
    int64_t until = esp_timer_get_time() + 1000000;
    while (size && esp_timer_get_time() < until) {
        int n = usb_serial_jtag_write_bytes(p, size, pdMS_TO_TICKS(50));
        if (n > 0) { p += n; size -= n; }
    }
    return size == 0;
}
static bool reply(uint8_t op, uint8_t result, uint8_t id, uint32_t request, bool with_report)
{
    uint8_t h[HEADER] = {'B', 'P', 'S', 'D', PROTOCOL, op | 0x80, result, id};
    put32(h + 8, request);
    memcpy(h + 12, nonce, 16);
    put32(h + 28, with_report ? sizeof(report) : 0);
    return send_bytes(h, sizeof(h)) && (!with_report || send_bytes(report, sizeof(report)));
}
static bool receive(void *buffer, uint32_t size, int64_t until)
{
    uint8_t *p = buffer;
    while (size && esp_timer_get_time() < until) {
        int n = usb_serial_jtag_read_bytes(p, size, pdMS_TO_TICKS(50));
        if (n > 0) { p += n; size -= n; }
    }
    return size == 0;
}
static void abandon_session(void)
{
    /* Discard at most 1 second of queued bytes; old frames cannot use new nonce. */
    uint8_t discard[256];
    int64_t until = esp_timer_get_time() + 1000000;
    while (esp_timer_get_time() < until &&
           usb_serial_jtag_read_bytes(discard, sizeof(discard), pdMS_TO_TICKS(50)) > 0) {}
    esp_fill_random(nonce, sizeof(nonce));
}
static bool directories(void)
{
    static const char *paths[] = {"/sdcard/bitpos", "/sdcard/bitpos/motion", MOTION_ROOT,
                                 "/sdcard/bitpos/menu", MENU_ROOT};
    for (unsigned i = 0; i < sizeof(paths)/sizeof(paths[0]); ++i) {
        struct stat st;
        if (stat(paths[i], &st) == 0) {
            if (!S_ISDIR(st.st_mode)) return false;
        } else if (errno != ENOENT || mkdir(paths[i], 0755) != 0) return false;
    }
    return true;
}
static uint8_t recover_temp(unsigned id, const char *path, const uint8_t *data)
{
    /* Reserved staging basename, never a wildcard scan. Only remove a byte-for-byte
     * prefix of this authenticated public asset. Unrelated contents are refused. */
    struct stat st;
    if (stat(path, &st) != 0) return errno == ENOENT ? SD_OK : IO_ERROR;
    if (!S_ISREG(st.st_mode) || st.st_size < 0 || st.st_size > assets[id].size) return CONFLICT;
    int fd = open(path, O_RDONLY);
    if (fd < 0) return IO_ERROR;
    uint8_t chunk[1024];
    size_t offset = 0;
    uint8_t result = SD_OK;
    int64_t until = esp_timer_get_time() + 3000000;
    while (offset < (size_t)st.st_size && esp_timer_get_time() < until) {
        size_t want = st.st_size - offset;
        if (want > sizeof(chunk)) want = sizeof(chunk);
        ssize_t n = read(fd, chunk, want);
        if (n <= 0) { result = IO_ERROR; break; }
        if (memcmp(chunk, data + offset, n) != 0) { result = CONFLICT; break; }
        offset += n;
    }
    if (result == SD_OK && (offset != (size_t)st.st_size || read(fd, chunk, 1) != 0)) result = IO_ERROR;
    if (close(fd) != 0) result = IO_ERROR;
    if (result == SD_OK && unlink(path) != 0) result = IO_ERROR;
    return result;
}
static uint8_t publish(unsigned id, const uint8_t *data)
{
    char dest[96], temp[96];
    asset_path(id, dest);
    snprintf(temp, sizeof(temp), "%s/.bitpos-sd-v2-%u.tmp", asset_root(id), id);
    uint8_t state = file_state(id, dest);
    if (state == MATCH) return NOOP;
    if (state != MISSING) return state == UNKNOWN ? CONFLICT : IO_ERROR;
    if (!directories()) return IO_ERROR;
    uint8_t result = recover_temp(id, temp, data);
    if (result != SD_OK) return result;
    int fd = open(temp, O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd < 0) return IO_ERROR;
    size_t offset = 0;
    int64_t until = esp_timer_get_time() + 20000000;
    while (offset < assets[id].size && esp_timer_get_time() < until) {
        size_t want = assets[id].size - offset;
        if (want > 4096) want = 4096;
        ssize_t n = write(fd, data + offset, want);
        if (n <= 0) { result = IO_ERROR; break; }
        offset += n;
    }
    if (offset != assets[id].size) result = IO_ERROR;
    if (result == SD_OK && fsync(fd) != 0) result = IO_ERROR;
    if (close(fd) != 0) result = IO_ERROR;
    if (result == SD_OK && file_state(id, temp) != MATCH) result = IO_ERROR;
    /* FatFs f_rename rejects an existing destination; it does not replace it. */
    if (result == SD_OK) {
        state = file_state(id, dest);
        if (state != MISSING) result = state == MATCH ? NOOP : CONFLICT;
        else if (rename(temp, dest) != 0) result = IO_ERROR;
        else if (file_state(id, dest) != MATCH) result = IO_ERROR;
    }
    /* On error leave only the reserved temp, so the next authenticated write can
     * inspect/converge it. Never delete an unknown destination or unknown temp. */
    if (result == NOOP) (void)recover_temp(id, temp, data);
    return result;
}
static void handle_write(const uint8_t h[HEADER])
{
    unsigned id = h[7];
    uint32_t request = get32(h + 8), size = get32(h + 28);
    uint8_t expected[32];
    if (id >= COUNT) { reply(WRITE, INVALID, h[7], request, false); abandon_session(); return; }
    expected_hash(id, expected);
    if (size != assets[id].size || size > MAX_FILE || memcmp(h + 32, expected, 32) != 0) {
        reply(WRITE, INVALID, id, request, false); abandon_session(); return;
    }
    if (!mounted) { reply(WRITE, IO_ERROR, id, request, false); return; }
    char path[96];
    asset_path(id, path);
    uint8_t state = file_state(id, path);
    if (state != MISSING) {
        reply(WRITE, state == MATCH ? NOOP : state == UNKNOWN ? CONFLICT : IO_ERROR, id, request, false);
        return;
    }
    uint8_t *data = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!data) { reply(WRITE, NO_MEMORY, id, request, false); return; }
    if (!reply(WRITE, READY, id, request, false)) { heap_caps_free(data); abandon_session(); return; }
    if (!receive(data, size, esp_timer_get_time() + RECEIVE_US)) {
        heap_caps_free(data);
        reply(WRITE, TIMED_OUT, id, request, false);
        abandon_session();
        return;
    }
    uint8_t actual[32];
    uint8_t result = INVALID;
    if (mbedtls_sha256(data, size, actual, 0) == 0 && memcmp(actual, expected, 32) == 0)
        result = publish(id, data);
    heap_caps_free(data);
    report[8 + id] = result == SD_OK || result == NOOP ? MATCH : file_state(id, path);
    reply(WRITE, result, id, request, false);
}
void app_main(void)
{
    init_assets();
    usb_serial_jtag_driver_config_t serial = {.tx_buffer_size = 1024, .rx_buffer_size = 4096};
    if (usb_serial_jtag_driver_install(&serial) != ESP_OK) return;
    if (esp_read_mac(report, ESP_MAC_WIFI_STA) != ESP_OK) return;
    const uint8_t approved_mac[] = {0x14, 0xc1, 0x9f, 0x4e, 0x62, 0x48};
    if (memcmp(report, approved_mac, sizeof(approved_mac)) == 0) {
        sdmmc_host_t host = SDMMC_HOST_DEFAULT();
        host.slot = SDMMC_HOST_SLOT_1;
        host.flags = SDMMC_HOST_FLAG_1BIT | SDMMC_HOST_FLAG_DEINIT_ARG;
        host.max_freq_khz = SDMMC_FREQ_DEFAULT;
        host.command_timeout_ms = 1000;
        sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
        slot.width = 1;
        slot.clk = 12; slot.cmd = 11; slot.d0 = 13;
        slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
        esp_vfs_fat_mount_config_t mount = VFS_FAT_MOUNT_DEFAULT_CONFIG();
        mount.format_if_mount_failed = false;
        mount.max_files = 2;
        mount.disk_status_check_enable = true;
        sdmmc_card_t *card = NULL;
        mounted = esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &mount, &card) == ESP_OK;
    }
    esp_fill_random(nonce, sizeof(nonce));
    refresh_report();
    int64_t hello_at = 0;
    uint8_t h[HEADER];
    for (;;) {
        if (esp_timer_get_time() >= hello_at) {
            reply(HELLO, SD_OK, 255, 0, true);
            hello_at = esp_timer_get_time() + 1000000;
        }
        if (usb_serial_jtag_read_bytes(h, 1, pdMS_TO_TICKS(50)) != 1) continue;
        if (h[0] != 'B') continue;
        if (!receive(h + 1, HEADER - 1, esp_timer_get_time() + 2000000)) {
            abandon_session(); continue;
        }
        if (memcmp(h, "BPSD", 4) != 0 || h[4] != PROTOCOL || h[6] != 0 ||
            memcmp(h + 12, nonce, sizeof(nonce)) != 0) { abandon_session(); continue; }
        if (h[5] == SD_STATUS && h[7] == 255 && get32(h + 28) == 0 &&
            memcmp(h + 32, (uint8_t[32]){0}, 32) == 0) {
            refresh_report(); reply(SD_STATUS, SD_OK, 255, get32(h + 8), true);
        } else if (h[5] == WRITE) handle_write(h);
        else { reply(h[5], INVALID, h[7], get32(h + 8), false); abandon_session(); }
        hello_at = esp_timer_get_time() + 1000000;
    }
}
