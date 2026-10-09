#include "bitpos_media.h"
#include "bitpos_menu_assets.generated.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "sdkconfig.h"
#include "ccp_board.h"
#include "display_engine.h"
#include "driver/sdmmc_host.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_memory_utils.h"
#include "esp_psram.h"
#include "esp_vfs_fat.h"
#include "diskio_impl.h"
#include "ff.h"
#include "mbedtls/sha256.h"
#include "sdmmc_cmd.h"
#include "src/libs/gif/gifdec.h"

#define MEDIA_ROOT "/sdcard/bitpos/motion/v1/"
#define FILE_LIMIT (128U * 1024U)
#define DECODER_RESERVE (128U * 1024U)
#define SYSTEM_MARGIN (8U * 1024U)
#define PSRAM_CAPS (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)

/* IDF 5.5.1 exports this helper from vfs.c; its own vfs_fat_spiflash.c
 * declares/uses it identically. No public SD readonly mount option exists.
 * Set BEFORE f_mount/open; write-refusing diskio is the independent backstop.
 */
extern esp_err_t esp_vfs_set_readonly_flag(const char *base_path);

static const char *TAG = "BitPOSMedia";
static atomic_flag initialized = ATOMIC_FLAG_INIT;
static atomic_bool published;
static atomic_bool file_open;
static sdmmc_card_t card;
static BYTE drive = FF_DRV_NOT_USED;
static char fat_drive[3];
static uint8_t *source;
static uint32_t source_size;
static const char *source_name;
static char source_path[64];
static uint8_t initial_background_rgb[3];
static uint32_t cursor;
static lv_fs_drv_t media_fs;

#define PHOTO_ROOT "/sdcard/bitpos/menu/v1/"
#define PHOTO_RESERVE (1024U * 1024U)
#define PHOTO_SLAB_BYTES (BITPOS_MENU_PHOTO_BYTES * BITPOS_MENU_ASSET_COUNT)
static atomic_bool photos_published;
static lv_image_dsc_t photos[BITPOS_MENU_ASSET_COUNT];

typedef struct {
    const char *name;
    uint32_t bytes;
    uint16_t frames;
    uint16_t duration_ms;
    const char *sha256;
} approved_gif_t;

/* Immutable allowlist from motion-lab/assets/gif/manifest.json. Noto Emoji,
 * Google, CC BY 4.0; technical FFmpeg resize128x128/12fps/64-color only.
 * Coffee is the idle preference; no512px sources or remote URL loading.
 */
static const approved_gif_t approved[] = {
    {"coffee-128.gif", 85290, 22, 1830,
     "618b8395ec723563136c721044fc87ac80622a4825873842fb1366cbfcd3336e"},
    {"sparkles-128.gif", 22300, 22, 1830,
     "2d7fe7cd99d9985340500ff1ab9398ac8a5ec24f610d1aad688f8e00c38979e9"},
    {"party-popper-128.gif", 36413, 17, 1410,
     "7003b93a6379b9be0a945c3e8f2235f459b5b8a13ff6a7465c03bddcd4f55e34"},
    {"confetti-128.gif", 38606, 26, 2160,
     "724dd842e824ba5a43fdc3497cf7a77640447be141d307d09a9b2afae499b4d6"},
};

static DSTATUS media_disk_status(BYTE pdrv)
{
    if(pdrv != drive || sdmmc_get_status(&card) != ESP_OK) return STA_NOINIT;
    return STA_PROTECT;
}

static DRESULT media_disk_read(BYTE pdrv, BYTE *buffer, DWORD sector, UINT count)
{
    if(pdrv != drive || !count || sector >= card.csd.capacity ||
       count > card.csd.capacity - sector) return RES_PARERR;
    return sdmmc_read_sectors(&card, buffer, sector, count) == ESP_OK ? RES_OK : RES_ERROR;
}

static DRESULT media_disk_write(BYTE pdrv, const BYTE *buffer, DWORD sector, UINT count)
{
    (void)pdrv; (void)buffer; (void)sector; (void)count;
    return RES_WRPRT;
}

static DRESULT media_disk_ioctl(BYTE pdrv, BYTE command, void *buffer)
{
    if(pdrv != drive) return RES_PARERR;
    switch(command) {
    case CTRL_SYNC: return RES_OK; /* No pending writes can exist. */
    case GET_SECTOR_COUNT: *(DWORD *)buffer = card.csd.capacity; return RES_OK;
    case GET_SECTOR_SIZE: *(WORD *)buffer = card.csd.sector_size; return RES_OK;
    case GET_BLOCK_SIZE: *(DWORD *)buffer = 1; return RES_OK;
    default: return RES_WRPRT; /* Includes TRIM/erase. */
    }
}

static bool mount_readonly(void)
{
    /* Never adopt somebody else's /sdcard mount or SDMMC host. */
    sdmmc_host_state_t state;
    if(sdmmc_host_get_state(&state) != ESP_OK || state.host_initialized) return false;
    if(ff_diskio_get_drive(&drive) != ESP_OK || drive > 9) return false;
    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
    host.slot = SDMMC_HOST_SLOT_1;
    host.flags = SDMMC_HOST_FLAG_1BIT | SDMMC_HOST_FLAG_DEINIT_ARG;
    host.max_freq_khz = SDMMC_FREQ_DEFAULT;
    host.command_timeout_ms = 1000;
    sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
    slot.width = 1;
    slot.clk = CCP_PIN_SD_CLK;
    slot.cmd = CCP_PIN_SD_CMD;
    slot.d0 = CCP_PIN_SD_D0;
    slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
    if(sdmmc_host_init() != ESP_OK) return false;
    if(sdmmc_host_init_slot(host.slot, &slot) != ESP_OK ||
       sdmmc_card_init(&host, &card) != ESP_OK) goto fail_host;

    static const ff_diskio_impl_t readonly_disk = {
        .init = media_disk_status, .status = media_disk_status, .read = media_disk_read,
        .write = media_disk_write, .ioctl = media_disk_ioctl,
    };
    ff_diskio_register(drive, &readonly_disk);
    fat_drive[0] = '0' + drive;
    fat_drive[1] = ':';
    FATFS *fs = NULL;
    const esp_vfs_fat_conf_t config = {
        .base_path = "/sdcard", .fat_drive = fat_drive, .max_files = 2,
    };
    if(esp_vfs_fat_register_cfg(&config, &fs) != ESP_OK) goto fail_disk;
    if(esp_vfs_set_readonly_flag("/sdcard") != ESP_OK ||
       f_mount(fs, fat_drive, 1) != FR_OK) {
        f_mount(NULL, fat_drive, 0);
        esp_vfs_fat_unregister_path("/sdcard");
        goto fail_disk;
    }
    return true;
fail_disk:
    ff_diskio_unregister(drive);
fail_host:
    sdmmc_host_deinit();
    drive = FF_DRV_NOT_USED;
    return false;
}

static bool headroom(size_t cache_bytes)
{
    if(!esp_psram_is_initialized() || esp_psram_get_size() < DECODER_RESERVE + cache_bytes) return false;
    const size_t free_bytes = heap_caps_get_free_size(PSRAM_CAPS);
    const size_t largest = heap_caps_get_largest_free_block(PSRAM_CAPS);
    const size_t reserve=atomic_load_explicit(&photos_published,memory_order_acquire)?PHOTO_RESERVE:0;
    return free_bytes >= reserve + DECODER_RESERVE + SYSTEM_MARGIN + cache_bytes &&
           largest >= DECODER_RESERVE && largest >= cache_bytes;
}

static uint16_t le16(const uint8_t *p)
{
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static bool skip_blocks(const uint8_t *data, size_t size, size_t *offset)
{
    while(*offset < size) {
        uint8_t length = data[(*offset)++];
        if(length > size - *offset) return false;
        *offset += length;
        if(!length) return true;
    }
    return false;
}

/* Bounded structural scan, not a second LZW decoder. SHA256 pins the complete
 * compressed content to cache1 sanitizer-tested bytes. Every image/GCE must
 * stay within128px and rounded12fps (7..10 centiseconds =10..14.29fps).
 */
static bool gif_bounds(const uint8_t *data, size_t size, const approved_gif_t *entry)
{
    if(size < 13 || memcmp(data, "GIF89a", 6)) return false;
    unsigned width = le16(data + 6), height = le16(data + 8);
    if(!width || !height || width > 128 || height > 128 || !(data[10] & 0x80)) return false;
    size_t offset = 13 + 3U * (1U << ((data[10] & 7) + 1));
    if(offset > size) return false;
    unsigned frames = 0, duration = 0;
    bool have_delay = false;
    while(offset < size) {
        uint8_t block = data[offset++];
        if(block == 0x3b) return offset == size && frames == entry->frames &&
                                      duration == entry->duration_ms;
        if(block == 0x21) {
            if(offset == size) return false;
            uint8_t label = data[offset++];
            if(label == 0xf9) {
                if(size - offset < 6 || data[offset] != 4 || data[offset + 5] != 0) return false;
                unsigned delay = le16(data + offset + 2);
                if(delay < 7 || delay > 10) return false;
                duration += delay * 10;
                have_delay = true;
                offset += 6;
            } else if(!skip_blocks(data, size, &offset)) return false;
        } else if(block == 0x2c) {
            if(size - offset < 9 || !have_delay) return false;
            unsigned x = le16(data + offset), y = le16(data + offset + 2);
            unsigned w = le16(data + offset + 4), h = le16(data + offset + 6);
            if(!w || !h || w > width || h > height || x > width - w || y > height - h) return false;
            uint8_t packed = data[offset + 8];
            offset += 9;
            if(packed & 0x80) offset += 3U * (1U << ((packed & 7) + 1));
            if(offset >= size || data[offset] < 2 || data[offset] > 8) return false;
            offset++;
            if(!skip_blocks(data, size, &offset) || ++frames > entry->frames) return false;
            have_delay = false;
        } else return false;
    }
    return false;
}

/* Pinned gifdec starts its canvas with opaque logical-screen background.
 * Transparent first-frame pixels are skipped, leaving that reserved palette
 * color visible. Derive a lossless initial key from GIF semantics, not a
 * hardcoded green: background must equal the first transparent palette entry,
 * and no opaque entry may share that RGB. Compressed source stays immutable. */
static bool first_transparent_background(const uint8_t *data,size_t size,uint8_t rgb[3])
{
    if(size<13||memcmp(data,"GIF89a",6)||!(data[10]&0x80))return false;
    unsigned colors=1U<<((data[10]&7)+1),background=data[11];
    size_t offset=13+3U*colors;
    if(background>=colors||offset>size)return false;
    const uint8_t *global=data+13;
    bool transparent=false;unsigned transparent_index=0;
    while(offset<size) {
        uint8_t block=data[offset++];
        if(block==0x21) {
            if(offset==size)return false;
            uint8_t extension=data[offset++];
            if(extension==0xf9) {
                if(size-offset<6||data[offset]!=4||data[offset+5])return false;
                transparent=(data[offset+1]&1)!=0;
                transparent_index=data[offset+4];offset+=6;
            } else if(!skip_blocks(data,size,&offset))return false;
        } else if(block==0x2c) {
            if(size-offset<9||!transparent)return false;
            uint8_t packed=data[offset+8];offset+=9;
            const uint8_t *palette=global;
            if(packed&0x80) {
                colors=1U<<((packed&7)+1);
                if(3U*colors>size-offset)return false;
                palette=data+offset;
            }
            const uint8_t *key=global+3U*background;
            if(transparent_index>=colors||memcmp(key,palette+3U*transparent_index,3))return false;
            for(unsigned i=0;i<colors;i++)
                if(i!=transparent_index&&!memcmp(key,palette+3U*i,3))return false;
            memcpy(rgb,key,3);return true;
        } else return false;
    }
    return false;
}

static unsigned clear_initial_background(uint8_t *canvas,size_t bytes,const uint8_t rgb[3])
{
    unsigned cleared=0;
    for(size_t i=0;i+4<=bytes;i+=4)
        if(canvas[i+3]==255&&canvas[i]==rgb[2]&&canvas[i+1]==rgb[1]&&canvas[i+2]==rgb[0]) {
            canvas[i+3]=0;++cleared;
        }
    return cleared;
}

static bool digest_matches(const uint8_t *data, size_t size, const char *expected)
{
    uint8_t digest[32];
    if(mbedtls_sha256(data, size, digest, 0)) return false;
    static const char hex[] = "0123456789abcdef";
    for(size_t i = 0; i < sizeof(digest); i++) {
        if(expected[2*i] != hex[digest[i] >> 4] || expected[2*i+1] != hex[digest[i] & 15]) return false;
    }
    return true;
}

static bool preload(const approved_gif_t *entry)
{
    char path[96];
    snprintf(path, sizeof(path), MEDIA_ROOT "%s", entry->name);
    struct stat info;
    if(stat(path, &info) || !S_ISREG(info.st_mode) || info.st_size != entry->bytes ||
       entry->bytes > FILE_LIMIT || !headroom(entry->bytes)) return false;
    FILE *file = fopen(path, "rb");
    if(!file) return false;
    setvbuf(file, NULL, _IONBF, 0);
    uint8_t *buffer = heap_caps_malloc(entry->bytes, PSRAM_CAPS);
    bool valid = buffer != NULL;
    /* Small startup reads let payment/network tasks continue; never under UI lock. */
    for(size_t offset = 0; valid && offset < entry->bytes;) {
        size_t count = entry->bytes - offset;
        if(count > 4096) count = 4096;
        valid = fread(buffer + offset, 1, count, file) == count;
        offset += count;
    }
    valid = valid && fgetc(file) == EOF && !ferror(file);
    if(fclose(file)) valid = false;
    valid = valid && digest_matches(buffer, entry->bytes, entry->sha256) &&
            gif_bounds(buffer, entry->bytes, entry) &&
            first_transparent_background(buffer,entry->bytes,initial_background_rgb) && headroom(0);
    if(!valid) {
        heap_caps_free(buffer);
        return false;
    }
    source = buffer;
    source_size = entry->bytes;
    source_name = entry->name;
    snprintf(source_path, sizeof(source_path), "M:/%s", entry->name);
    return true;
}

static void *fs_open(lv_fs_drv_t *drv, const char *path, lv_fs_mode_t mode)
{
    (void)drv;
    if(mode != LV_FS_MODE_RD || !atomic_load_explicit(&published, memory_order_acquire) ||
       !headroom(0)) return NULL;
    if(*path == '/') path++;
    if(strcmp(path, source_name)) return NULL;
    bool expected = false;
    if(!atomic_compare_exchange_strong(&file_open, &expected, true)) return NULL;
    cursor = 0;
    return &cursor;
}

static lv_fs_res_t fs_close(lv_fs_drv_t *drv, void *file)
{
    (void)drv;
    if(file != &cursor) return LV_FS_RES_INV_PARAM;
    atomic_store(&file_open, false);
    return LV_FS_RES_OK;
}

static lv_fs_res_t fs_read(lv_fs_drv_t *drv, void *file, void *buffer, uint32_t count, uint32_t *read)
{
    (void)drv;
    *read = 0;
    if(file != &cursor || count > source_size - cursor) {
        /* Pinned gifdec ignores errors: initialize the requested output on failure
         * as well as returning an error. Valid pinned bytes never need this path. */
        memset(buffer, 0, count);
        return LV_FS_RES_FS_ERR;
    }
    memcpy(buffer, source + cursor, count);
    cursor += count;
    *read = count;
    return LV_FS_RES_OK;
}

static lv_fs_res_t fs_seek(lv_fs_drv_t *drv, void *file, uint32_t offset, lv_fs_whence_t whence)
{
    (void)drv;
    if(file != &cursor) return LV_FS_RES_INV_PARAM;
    /* gifdec passes negative relative offsets through uint32_t. */
    int64_t position;
    if(whence == LV_FS_SEEK_SET) position = offset;
    else if(whence == LV_FS_SEEK_CUR) position = (int64_t)cursor + (int32_t)offset;
    else if(whence == LV_FS_SEEK_END) position = (int64_t)source_size + (int32_t)offset;
    else return LV_FS_RES_INV_PARAM;
    if(position < 0 || position > source_size) return LV_FS_RES_INV_PARAM;
    cursor = (uint32_t)position;
    return LV_FS_RES_OK;
}

static lv_fs_res_t fs_tell(lv_fs_drv_t *drv, void *file, uint32_t *position)
{
    (void)drv;
    if(file != &cursor) return LV_FS_RES_INV_PARAM;
    *position = cursor;
    return LV_FS_RES_OK;
}

static bool preload_photos(void)
{
    static char photo_read_buffer[4096]; /* Startup-only bounded FatFs stdio buffer. */
    if(!esp_psram_is_initialized() ||
       heap_caps_get_free_size(PSRAM_CAPS)<PHOTO_SLAB_BYTES+PHOTO_RESERVE ||
       heap_caps_get_largest_free_block(PSRAM_CAPS)<PHOTO_SLAB_BYTES)return false;
    uint8_t *slab=heap_caps_malloc(PHOTO_SLAB_BYTES,PSRAM_CAPS);
    if(!slab)return false;
    bool valid=esp_ptr_external_ram(slab)&&heap_caps_get_free_size(PSRAM_CAPS)>=PHOTO_RESERVE;
    for(unsigned id=0;valid&&id<BITPOS_MENU_ASSET_COUNT;id++) {
        char path[96];snprintf(path,sizeof(path),PHOTO_ROOT "%s",bitpos_menu_assets[id].file);
        struct stat info;
        if(stat(path,&info)||!S_ISREG(info.st_mode)||info.st_size!=BITPOS_MENU_PHOTO_BYTES){valid=false;break;}
        FILE *file=fopen(path,"rb");if(!file){valid=false;break;}
        setvbuf(file,photo_read_buffer,_IOFBF,sizeof(photo_read_buffer));
        mbedtls_sha256_context hash;mbedtls_sha256_init(&hash);
        valid=mbedtls_sha256_starts(&hash,0)==0;
        for(size_t offset=0;valid&&offset<BITPOS_MENU_PHOTO_BYTES;) {
            size_t bytes=BITPOS_MENU_PHOTO_BYTES-offset;if(bytes>4096)bytes=4096;
            uint8_t *chunk=slab+id*BITPOS_MENU_PHOTO_BYTES+offset;
            valid=fread(chunk,1,bytes,file)==bytes&&mbedtls_sha256_update(&hash,chunk,bytes)==0;
            offset+=bytes;
            vTaskDelay(1); /* Bounded startup IO/hash yields to payment tasks. */
        }
        uint8_t digest[32];char hex[65];
        valid=valid&&fgetc(file)==EOF&&!ferror(file)&&mbedtls_sha256_finish(&hash,digest)==0;
        mbedtls_sha256_free(&hash);
        if(fclose(file))valid=false;
        if(valid) {
            for(unsigned i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);
            valid=!strcmp(hex,bitpos_menu_assets[id].sha256);
        }
    }
    valid=valid&&heap_caps_get_free_size(PSRAM_CAPS)>=PHOTO_RESERVE;
    if(!valid){heap_caps_free(slab);return false;}
    for(unsigned id=0;id<BITPOS_MENU_ASSET_COUNT;id++) {
        photos[id]=(lv_image_dsc_t){
            .header={.magic=LV_IMAGE_HEADER_MAGIC,.cf=LV_COLOR_FORMAT_RGB565,
                     .w=BITPOS_MENU_PHOTO_WIDTH,.h=BITPOS_MENU_PHOTO_HEIGHT,.stride=BITPOS_MENU_PHOTO_WIDTH*2},
            .data_size=BITPOS_MENU_PHOTO_BYTES,.data=slab+id*BITPOS_MENU_PHOTO_BYTES
        };
    }
    atomic_store_explicit(&photos_published,true,memory_order_release);
    ESP_LOGI(TAG,"BITPOS_PHOTOS cached bytes=%u reserve=%u psram_free=%lu",
             PHOTO_SLAB_BYTES,PHOTO_RESERVE,(unsigned long)heap_caps_get_free_size(PSRAM_CAPS));
    return true;
}

bool bitpos_media_photos_available(void)
{
    return atomic_load_explicit(&photos_published,memory_order_acquire);
}

const lv_image_dsc_t *bitpos_media_photo(unsigned asset_id)
{
    return bitpos_media_photos_available()&&asset_id<BITPOS_MENU_ASSET_COUNT?&photos[asset_id]:NULL;
}

void bitpos_media_init(void)
{
    if(atomic_flag_test_and_set(&initialized)) return;
    if(!mount_readonly()) {
        ESP_LOGI(TAG, "BITPOS_MEDIA native reason=sd_unavailable");
        return;
    }
    if(!preload_photos())ESP_LOGI(TAG,"BITPOS_PHOTOS home reason=validation_or_reserve");
#if LV_USE_GIF && LV_GIF_CACHE_DECODE_DATA && LV_USE_STDLIB_MALLOC == LV_STDLIB_CLIB
    for(size_t i = 0; i < sizeof(approved)/sizeof(approved[0]); i++) {
        if(preload(&approved[i])) break;
    }
    if(!source) {
        ESP_LOGI(TAG, "BITPOS_MEDIA native reason=validation_or_memory");
        return;
    }
    if(!display_engine_lock(100)) goto fail_cache;
    /* Check the actual LVGL allocator, not just PSRAM configuration. */
    /* Pinned cache1 allocation: struct + ARGB/index pixels +16KiB LZW cache. */
    const size_t decoder_bytes = sizeof(gd_GIF) + 5U * 128U * 128U + 16384U;
    void *probe = lv_malloc(decoder_bytes);
    bool external = probe && esp_ptr_external_ram(probe);
    lv_free(probe);
    if(!external || !headroom(0) || lv_fs_get_drv('M')) {
        display_engine_unlock();
        goto fail_cache;
    }
    lv_fs_drv_init(&media_fs);
    media_fs.letter = 'M';
    media_fs.cache_size = 0; /* Complete immutable source already cached. */
    media_fs.open_cb = fs_open;
    media_fs.close_cb = fs_close;
    media_fs.read_cb = fs_read;
    media_fs.seek_cb = fs_seek;
    media_fs.tell_cb = fs_tell;
    lv_fs_drv_register(&media_fs);
    atomic_store_explicit(&published, true, memory_order_release);
    display_engine_unlock();
    ESP_LOGI(TAG, "BITPOS_MEDIA cached bytes=%lu psram_free=%lu psram_largest=%lu decoder_reserve=%u",
             (unsigned long)source_size, (unsigned long)heap_caps_get_free_size(PSRAM_CAPS),
             (unsigned long)heap_caps_get_largest_free_block(PSRAM_CAPS), DECODER_RESERVE);
    return;
fail_cache:
    heap_caps_free(source);
    source = NULL;
    ESP_LOGI(TAG, "BITPOS_MEDIA native reason=allocator_or_drive");
#else
    ESP_LOGI(TAG, "BITPOS_MEDIA native reason=decoder_config");
#endif
}

bool bitpos_media_available(void)
{
    return atomic_load_explicit(&published, memory_order_acquire) && headroom(0);
}

const char *bitpos_media_gif_path(void)
{
    return bitpos_media_available() ? source_path : NULL;
}

bool bitpos_media_prepare_canvas(lv_obj_t *gif)
{
    if(!atomic_load_explicit(&published,memory_order_acquire))return false;
    const lv_image_dsc_t *image=lv_image_get_src(gif);
    if(!image||image->header.magic!=LV_IMAGE_HEADER_MAGIC||
       !(image->header.flags&LV_IMAGE_FLAGS_MODIFIABLE)||
       image->header.cf!=LV_COLOR_FORMAT_ARGB8888||
       image->header.w!=le16(source+6)||image->header.h!=le16(source+8)||
       image->header.stride!=image->header.w*4||
       image->data_size!=image->header.stride*image->header.h||!image->data)return false;
    /* Public modifiable image source, under the LVGL lock before first paint;
     * no private widget fields, SDK patch, extra allocation or per-frame work. */
    unsigned cleared=clear_initial_background((uint8_t *)image->data,image->data_size,initial_background_rgb);
    lv_image_cache_drop(image);lv_obj_invalidate(gif);
    ESP_LOGI(TAG,"BITPOS_MEDIA transparent_canvas pixels=%u",cleared);
    return true;
}
