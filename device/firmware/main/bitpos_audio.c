#include "bitpos_audio.h"

#include <math.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "ccp_board.h"
#include "driver/i2s_std.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"

#define ORDER_ID_SIZE 96
#define QUEUE_DEPTH 4
#define SAMPLE_RATE 16000
#define FRAME_BYTES 4U
#define CHUNK_FRAMES 256U
#define CHUNK_BYTES (CHUNK_FRAMES * FRAME_BYTES)
#define DMA_DESCRIPTORS 4U
#define TONE_FRAMES 2560U
#define WAV_PATH "/sdcard/bitpos/motion/v1/payment-success-device.wav"
#define WAV_FILE_BYTES 20524U
#define WAV_FILE_LIMIT (128U * 1024U)
#define WAV_HEADER_LIMIT 1024U
#define WAV_DURATION_LIMIT_MS 2000U

/* asset-pack/manifest.json: original locally synthesized BitPOS cue, not MP3,
 * no third-party samples; matches native784/1046Hz,0.32s. Parent owns copying.
 */
static const char wav_sha256[] =
    "aa78633e92f389a5edc9216aa5068c0493ef1b17a661ebfcf81f0364e82af402";
static const char *TAG = "BitPOS";
static atomic_flag initialized = ATOMIC_FLAG_INIT;
static atomic_bool muted;
static atomic_uint mute_epoch;
static atomic_bool attract_active;
static atomic_uint attract_epoch;
static _Atomic(QueueHandle_t) published_queue;
static i2s_chan_handle_t speaker;
static int16_t native_cue[TONE_FRAMES * 2 * 2];
static const uint8_t silence[CHUNK_BYTES];

typedef struct {
    char order[ORDER_ID_SIZE];
    uint32_t version;
    unsigned epoch;
    bool attract;
    unsigned attract_generation;
} audio_request_t;

typedef enum { PLAY_COMPLETE, PLAY_LOAD_FAILED, PLAY_CANCELLED, PLAY_OUTPUT_FAILED } play_result_t;

typedef struct {
    uint32_t offset;
    uint32_t bytes;
} wav_data_t;

static bool permitted(const audio_request_t *request)
{
    QueueHandle_t queue=atomic_load_explicit(&published_queue,memory_order_acquire);
    return !atomic_load(&muted) && request->epoch == atomic_load(&mute_epoch) &&
      (!request->attract||(atomic_load(&attract_active)&&request->attract_generation==atomic_load(&attract_epoch)&&(!queue||!uxQueueMessagesWaiting(queue))));
}

static uint16_t le16(const uint8_t *p)
{
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Bounded RIFF chunk walk. Even optional metadata must fit a1KiB header.
 * PCM only:16kHz/16-bit/stereo, consistent byte rate/block alignment.
 */
static bool wav_header(FILE *file, uint32_t file_size, wav_data_t *data)
{
    uint8_t header[24];
    if(fread(header, 1, 12, file) != 12 || memcmp(header, "RIFF", 4) ||
       memcmp(header + 8, "WAVE", 4) || le32(header + 4) != file_size - 8) return false;
    uint32_t offset = 12;
    bool have_format = false;
    for(unsigned chunks = 0; chunks < 32 && offset <= WAV_HEADER_LIMIT - 8; chunks++) {
        if(file_size - offset < 8 || fread(header, 1, 8, file) != 8) return false;
        uint32_t length = le32(header + 4);
        offset += 8;
        if(length > file_size - offset) return false;
        if(!memcmp(header, "data", 4)) {
            if(!have_format || !length || length % FRAME_BYTES ||
               length > SAMPLE_RATE * FRAME_BYTES * WAV_DURATION_LIMIT_MS / 1000 ||
               offset + length != file_size) return false;
            data->offset = offset;
            data->bytes = length;
            return true;
        }
        if(length > WAV_HEADER_LIMIT - offset) return false;
        if(!memcmp(header, "fmt ", 4)) {
            if(have_format || length != 16 || fread(header, 1, 16, file) != 16) return false;
            if(le16(header) != 1 || le16(header + 2) != 2 || le32(header + 4) != SAMPLE_RATE ||
               le32(header + 8) != SAMPLE_RATE * FRAME_BYTES || le16(header + 12) != FRAME_BYTES ||
               le16(header + 14) != 16) return false;
            have_format = true;
        }
        uint32_t padded = length + (length & 1);
        if(padded > file_size - offset || padded > WAV_HEADER_LIMIT - offset) return false;
        offset += padded;
        if(fseek(file, offset, SEEK_SET)) return false;
    }
    return false;
}

/* Entire file authenticated before any PCM is submitted. Hash pass and playback
 * stream use a fixed chunk buffer; no whole-file/per-frame heap allocations.
 */
static bool wav_digest(FILE *file, uint8_t *buffer, const audio_request_t *request)
{
    mbedtls_sha256_context context;
    mbedtls_sha256_init(&context);
    bool valid = fseek(file, 0, SEEK_SET) == 0 && mbedtls_sha256_starts(&context, 0) == 0;
    for(size_t offset = 0; valid && offset < WAV_FILE_BYTES;) {
        size_t count = WAV_FILE_BYTES - offset;
        if(count > CHUNK_BYTES) count = CHUNK_BYTES;
        valid = permitted(request) && fread(buffer, 1, count, file) == count &&
                mbedtls_sha256_update(&context, buffer, count) == 0;
        offset += count;
    }
    uint8_t digest[32];
    valid = valid && fgetc(file) == EOF && !ferror(file) &&
            mbedtls_sha256_finish(&context, digest) == 0;
    mbedtls_sha256_free(&context);
    static const char hex[] = "0123456789abcdef";
    for(size_t i = 0; valid && i < sizeof(digest); i++) {
        valid = wav_sha256[2*i] == hex[digest[i] >> 4] &&
                wav_sha256[2*i+1] == hex[digest[i] & 15];
    }
    return valid;
}

static play_result_t write_pcm(const void *buffer, size_t size, const audio_request_t *request,
                               size_t *bytes)
{
    if(!permitted(request)) return PLAY_CANCELLED;
    size_t written = 0;
    esp_err_t result = i2s_channel_write(speaker, buffer, size, &written, 100);
    *bytes += written;
    if(result != ESP_OK || written != size) return PLAY_OUTPUT_FAILED;
    return permitted(request) ? PLAY_COMPLETE : PLAY_CANCELLED;
}

static play_result_t play_wav(const audio_request_t *request, uint8_t *buffer, size_t *bytes)
{
    struct stat info;
    if(stat(WAV_PATH, &info) || !S_ISREG(info.st_mode) || info.st_size != WAV_FILE_BYTES ||
       info.st_size > WAV_FILE_LIMIT) return PLAY_LOAD_FAILED;
    FILE *file = fopen(WAV_PATH, "rb");
    if(!file) return PLAY_LOAD_FAILED;
    setvbuf(file, NULL, _IONBF, 0);
    wav_data_t data;
    play_result_t result = PLAY_LOAD_FAILED;
    if(!wav_header(file, (uint32_t)info.st_size, &data) || !wav_digest(file, buffer, request) ||
       fseek(file, data.offset, SEEK_SET)) goto close;
    result = PLAY_COMPLETE;
    for(uint32_t offset = 0; offset < data.bytes;) {
        size_t count = data.bytes - offset;
        if(count > CHUNK_BYTES) count = CHUNK_BYTES;
        if(!permitted(request)) { result = PLAY_CANCELLED; break; }
        if(fread(buffer, 1, count, file) != count) { result = PLAY_LOAD_FAILED; break; }
        result = write_pcm(buffer, count, request, bytes);
        if(result != PLAY_COMPLETE) break;
        offset += count;
    }
close:
    /* A close failure after complete PCM submission must not replay a cue. */
    if(fclose(file) && result == PLAY_COMPLETE) result = PLAY_OUTPUT_FAILED;
    return permitted(request) ? result : PLAY_CANCELLED;
}

static play_result_t play_native(const audio_request_t *request, size_t *bytes)
{
    const uint8_t *pcm = (const uint8_t *)native_cue;
    for(size_t offset = 0; offset < sizeof(native_cue); offset += CHUNK_BYTES) {
        play_result_t result = write_pcm(pcm + offset, CHUNK_BYTES, request, bytes);
        if(result != PLAY_COMPLETE) return result;
    }
    return PLAY_COMPLETE;
}
static play_result_t play_attract(const audio_request_t *request,uint8_t *buffer,size_t *bytes)
{
    /* Quiet original cafe melody, synthesized in the optional audio worker
     * using its fixed chunk buffer. No SD dependency, heap or payment cue. */
    static const float notes[]={523.25f,659.25f,783.99f,659.25f,587.33f,523.25f};
    enum{NOTE_FRAMES=2048};
    for(unsigned note=0;note<sizeof(notes)/sizeof(notes[0]);note++)for(unsigned start=0;start<NOTE_FRAMES;start+=CHUNK_FRAMES){
        if(!permitted(request))return PLAY_CANCELLED;
        int16_t *pcm=(int16_t *)buffer;
        for(unsigned frame=0;frame<CHUNK_FRAMES;frame++){
            unsigned sample=start+frame;
            float envelope=(1.0f-(float)sample/NOTE_FRAMES)*(sample<128?(float)sample/128:1);
            int16_t value=(int16_t)(650*envelope*sinf(2*3.141592653589793f*notes[note]*sample/SAMPLE_RATE));
            pcm[frame*2]=pcm[frame*2+1]=value;
        }
        play_result_t result=write_pcm(buffer,CHUNK_BYTES,request,bytes);if(result!=PLAY_COMPLETE)return result;
    }
    return PLAY_COMPLETE;
}

static bool start_output(void)
{
    /* Clear every descriptor while READY, including after an aborted/muted cue.
     * auto_clear_after_cb also prevents underrun from replaying old samples.
     */
    for(unsigned i = 0; i < DMA_DESCRIPTORS; i++) {
        size_t loaded = 0;
        if(i2s_channel_preload_data(speaker, silence, sizeof(silence), &loaded) != ESP_OK ||
           loaded != sizeof(silence)) return false;
    }
    return i2s_channel_enable(speaker) == ESP_OK;
}

static bool drain_output(const audio_request_t *request)
{
    /* i2s_channel_write copies to DMA; it is not an audible-output proof. Push
     * more than one complete ring of silence through the actual paced writes,
     * so all previous PCM descriptors have been consumed before completion.
     * Payload byte marker excludes this silent tail. No delay on UI/WS tasks.
     */
    size_t ignored = 0;
    for(unsigned i = 0; i <= DMA_DESCRIPTORS; i++) {
        if(write_pcm(silence, sizeof(silence), request, &ignored) != PLAY_COMPLETE) return false;
    }
    return true;
}

static void audio_worker(void *argument)
{
    QueueHandle_t queue = argument;
    audio_request_t request;
    uint8_t buffer[CHUNK_BYTES] __attribute__((aligned(4)));
    TickType_t next_attract=0;
    for(;;) {
        if(xQueueReceive(queue, &request, pdMS_TO_TICKS(250)) != pdTRUE){
            if(!atomic_load(&attract_active)||xTaskGetTickCount()<next_attract)continue;
            request=(audio_request_t){.epoch=atomic_load(&mute_epoch),.attract=true,.attract_generation=atomic_load(&attract_epoch)};
            next_attract=xTaskGetTickCount()+pdMS_TO_TICKS(16000);
        }
        if(!permitted(&request))continue;
        if(!start_output()) continue;
        size_t bytes = 0;
        const char *cue = request.attract?"attract":"wav";
        play_result_t result = request.attract?play_attract(&request,buffer,&bytes):play_wav(&request, buffer, &bytes);
        if(result == PLAY_LOAD_FAILED && bytes == 0 && permitted(&request)) {
            cue = "native";
            result = play_native(&request, &bytes);
        }
        bool complete = result == PLAY_COMPLETE && drain_output(&request);
        esp_err_t stopped = i2s_channel_disable(speaker);
        if(complete && stopped == ESP_OK && permitted(&request)) {
            if(request.attract){ESP_LOGI(TAG,"BITPOS_ATTRACT_SOUND bytes=%lu",(unsigned long)bytes);continue;}
            ESP_LOGI(TAG, "BITPOS_SOUND order=%s version=%lu bytes=%lu cue=%s",
                     request.order, (unsigned long)request.version, (unsigned long)bytes, cue);
        }
    }
}

void bitpos_audio_init(void)
{
    if(atomic_flag_test_and_set(&initialized)) return;
    /* Match the verified native784/1046Hz two-tone envelope, computed once
     * rather than doing floating-point synthesis or allocation during playback.
     */
    for(unsigned tone = 0; tone < 2; tone++) {
        for(unsigned sample = 0; sample < TONE_FRAMES; sample++) {
            int16_t value = (int16_t)(3000 * sin(2 * 3.141592653589793 *
                (tone ? 1046 : 784) * sample / SAMPLE_RATE) * (1.0 - sample / (double)TONE_FRAMES));
            size_t offset = (tone * TONE_FRAMES + sample) * 2;
            native_cue[offset] = native_cue[offset + 1] = value;
        }
    }
    i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
    channel.dma_desc_num = DMA_DESCRIPTORS;
    channel.dma_frame_num = CHUNK_FRAMES;
    channel.auto_clear_after_cb = true;
    if(i2s_new_channel(&channel, &speaker, NULL) != ESP_OK) return;
    i2s_std_config_t config = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        /* NS4168 datasheet10.1 requires one BCLK delay after LRCLK.
         * Match the original board audio engine's Philips I2S convention;
         * MSB/left-justified framing shifts the transmitted PCM bits. */
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED, .bclk = CCP_PIN_I2S_BCLK, .ws = CCP_PIN_I2S_LRCK,
            .dout = CCP_PIN_I2S_DOUT, .din = I2S_GPIO_UNUSED,
        },
    };
    if(i2s_channel_init_std_mode(speaker, &config) != ESP_OK) goto fail_speaker;
    QueueHandle_t queue = xQueueCreate(QUEUE_DEPTH, sizeof(audio_request_t));
    if(!queue) goto fail_speaker;
    if(xTaskCreate(audio_worker, "bitpos_audio", 8192, queue, 2, NULL) != pdPASS) {
        vQueueDelete(queue);
        goto fail_speaker;
    }
    atomic_store_explicit(&published_queue, queue, memory_order_release);
    return;
fail_speaker:
    i2s_del_channel(speaker);
    speaker = NULL;
}

void bitpos_audio_set_muted(bool value)
{
    /* Epoch invalidates even queued requests if mute is toggled off again.
     * In-flight writes stop on their next <=16ms PCM chunk (timeout100ms).
     * No queue reset/deletion races and no lock on the render task.
     */
    bool previous = atomic_exchange(&muted, value);
    if(previous != value) atomic_fetch_add(&mute_epoch, 1);
}

bool bitpos_audio_is_muted(void)
{
    return atomic_load(&muted);
}
void bitpos_audio_set_attract(bool active)
{
    bool previous=atomic_exchange(&attract_active,active);
    if(previous!=active)atomic_fetch_add(&attract_epoch,1);
}

void bitpos_audio_play_success(const char *order_id, uint32_t order_version)
{
    QueueHandle_t queue = atomic_load_explicit(&published_queue, memory_order_acquire);
    if(!queue || !order_id || atomic_load(&muted)) return;
    audio_request_t request = {.version = order_version, .epoch = atomic_load(&mute_epoch)};
    size_t length = 0;
    while(length < ORDER_ID_SIZE && order_id[length]) {
        unsigned char c = (unsigned char)order_id[length];
        if(!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
             (c >= '0' && c <= '9') || c == '-' || c == '_')) return;
        length++;
    }
    if(!length || length >= ORDER_ID_SIZE || !permitted(&request)) return;
    memcpy(request.order, order_id, length);
    /* Aggregate initialization already terminated/zeroed the copied ID. */
    xQueueSend(queue, &request, 0);
}
