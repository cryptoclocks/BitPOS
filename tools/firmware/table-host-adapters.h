/* Host-only boundary adapters. No ESP32, SD, network, cryptographic or audible proof. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ctype.h>
#include <time.h>
#include <sys/time.h>
#include <stdatomic.h>
#include <inttypes.h>
#include "lvgl.h"
#include "bitpos_table.h"
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
static size_t heap_caps_get_free_size(unsigned caps){(void)caps;return 4*1024*1024;}
static size_t heap_caps_get_largest_free_block(unsigned caps){return heap_caps_get_free_size(caps);}
static uint8_t *source;static size_t source_size;static const char *source_name="coffee-128.gif";
static atomic_bool published,file_open;static uint32_t cursor;static uint8_t initial_background_rgb[3];
static bool headroom(size_t bytes){(void)bytes;return true;}
static bool bitpos_media_available(void){return atomic_load(&published);}
static const char *bitpos_media_gif_path(void){return bitpos_media_available()?"M:/coffee-128.gif":NULL;}
static bool bitpos_media_prepare_canvas(lv_obj_t *gif);
static void (*host_lock_hook)(void);
static void (*host_decode_hook)(void);
LV_FONT_DECLARE(bitpos_font_20);
LV_FONT_DECLARE(bitpos_clock_64);
LV_IMAGE_DECLARE(bitpos_logo);
typedef int esp_err_t;
typedef unsigned nvs_handle_t;
typedef void *esp_websocket_client_handle_t;
enum { ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1,NVS_READWRITE=2,pdTRUE=1,pdFALSE=0 };
#define pdMS_TO_TICKS(n) (n)
#define configASSERT(n) assert(n)
#define ESP_LOGI(...) ((void)0)
static unsigned host_lock_depth,host_flushes,host_audio,host_claims,host_commits,host_writes,host_sends;
static unsigned host_serial,host_ack_at,host_audio_at,host_flush_at;
static bool host_transfer=true,host_network=true,host_storage=true,host_muted,photos_ready=true;
static uint32_t host_random=1;
static uint8_t host_slots[2][4096];static size_t host_sizes[2];
static char host_paid_keys[64][16];static uint32_t host_paid_versions[64];static unsigned host_paid_count;
static char host_sent[128][7169];
static uint8_t photo_pixels[192000];
static const lv_image_dsc_t host_photo={.header={.magic=LV_IMAGE_HEADER_MAGIC,.cf=LV_COLOR_FORMAT_RGB565,.w=480,.h=200,.stride=960},.data_size=sizeof(photo_pixels),.data=photo_pixels};
static bool bitpos_media_photos_available(void){return photos_ready;}
static const lv_image_dsc_t *bitpos_media_photo(unsigned id){return photos_ready&&id<12?&host_photo:NULL;}
static bool bitpos_audio_is_muted(void){return host_muted;}
static bool host_attract_active;
static void bitpos_audio_set_attract(bool active){host_attract_active=active;}
static void bitpos_audio_set_muted(bool mute){assert(!host_lock_depth);host_muted=mute;}
static void bitpos_audio_play_success(const char *order,uint32_t version){assert(!host_lock_depth&&order[0]&&version);host_audio++;host_audio_at=++host_serial;assert(host_ack_at&&host_ack_at<host_audio_at);}
static bool display_engine_lock(unsigned timeout){(void)timeout;host_lock_depth++;if(host_lock_hook)host_lock_hook();return true;}
static void display_engine_unlock(void){assert(host_lock_depth);host_lock_depth--;}
static unsigned display_engine_get_flush_count(void){return host_flushes;}
static lv_display_t *display_engine_get_disp(void){return lv_display_get_default();}
static void ccp_board_set_brightness(unsigned brightness){assert(brightness==85);}
static int64_t esp_timer_get_time(void){return (int64_t)lv_tick_get()*1000;}
static void esp_fill_random(void *out,size_t length){uint8_t *p=out;for(size_t i=0;i<length;i++){host_random=host_random*1664525+1013904223;p[i]=(uint8_t)(host_random>>24);}}
/* Deterministic stand-in for the SDK SHA primitive ONLY in the host adapter.
 * Actual claim_paid code/NVS behavior is exercised; this is not SHA proof. */
static int mbedtls_sha256(const unsigned char *data,size_t length,unsigned char hash[32],int mode){(void)mode;memset(hash,0,32);for(size_t i=0;i<length;i++)hash[i%32]=(uint8_t)(hash[i%32]*33+data[i]);return 0;}
static esp_err_t nvs_open_from_partition(const char *partition,const char *space,int mode,nvs_handle_t *handle){assert(!host_lock_depth&&!strcmp(partition,"bitpos_nvs")&&!strcmp(space,"ordering")&&mode==NVS_READWRITE);*handle=2;return host_storage?ESP_OK:3;}
static esp_err_t nvs_get_blob(nvs_handle_t handle,const char *key,void *out,size_t *length){assert(handle==2);unsigned slot=!strcmp(key,"slot_b");if(!host_sizes[slot])return ESP_ERR_NVS_NOT_FOUND;if(*length<host_sizes[slot])return 3;*length=host_sizes[slot];memcpy(out,host_slots[slot],*length);return ESP_OK;}
static esp_err_t nvs_set_blob(nvs_handle_t handle,const char *key,const void *data,size_t length){assert(!host_lock_depth&&handle==2&&length<=4096);host_writes++;if(!host_storage)return 3;unsigned slot=!strcmp(key,"slot_b");memcpy(host_slots[slot],data,length);host_sizes[slot]=length;return ESP_OK;}
static esp_err_t nvs_commit(nvs_handle_t handle){assert(!host_lock_depth&&(handle==1||handle==2));host_commits++;return host_storage?ESP_OK:3;}
static esp_err_t nvs_get_u32(nvs_handle_t handle,const char *key,uint32_t *out){assert(!host_lock_depth&&handle==1);for(unsigned i=0;i<host_paid_count;i++)if(!strcmp(host_paid_keys[i],key)){*out=host_paid_versions[i];return ESP_OK;}return ESP_ERR_NVS_NOT_FOUND;}
static esp_err_t nvs_set_u32(nvs_handle_t handle,const char *key,uint32_t value){assert(!host_lock_depth&&handle==1&&host_paid_count<64);if(!host_storage)return 3;strcpy(host_paid_keys[host_paid_count],key);host_paid_versions[host_paid_count++]=value;host_claims++;return ESP_OK;}
static bool esp_websocket_client_is_connected(esp_websocket_client_handle_t socket){return socket&&host_network;}
static int esp_websocket_client_send_text(esp_websocket_client_handle_t socket,const char *data,int length,unsigned timeout){(void)timeout;assert(!host_lock_depth&&socket&&length>0&&length<=7168&&host_sends<128);if(!host_network)return -1;memcpy(host_sent[host_sends],data,(size_t)length);host_sent[host_sends++][length]=0;cJSON *j=cJSON_Parse(data);assert(j);const char *type=cJSON_GetObjectItem(j,"type")->valuestring;
 if(!strncmp(type,"CART_",5)||!strcmp(type,"ORDER_SUBMIT")||!strcmp(type,"ORDER_DISMISS")){assert(host_commits);table_durable_t saved;uint64_t seq;bool persisted=false;for(unsigned i=0;i<2;i++)if(host_sizes[i]&&table_journal_decode(host_slots[i],host_sizes[i],&saved,&seq)&&saved.pending.kind&&!strcmp(saved.pending.request,cJSON_GetObjectItem(j,"requestId")->valuestring))persisted=true;assert(persisted);}
 if(!strcmp(type,"ACK")){assert(host_flush_at);host_ack_at=++host_serial;assert(host_flush_at<host_ack_at);}cJSON_Delete(j);return length;}
static void esp_websocket_client_stop(esp_websocket_client_handle_t socket){(void)socket;host_network=false;}
static void esp_websocket_client_start(esp_websocket_client_handle_t socket){(void)socket;host_network=true;}
typedef struct { size_t item,capacity,count,start;uint8_t *bytes; } host_queue_t;
typedef host_queue_t *QueueHandle_t;
static QueueHandle_t xQueueCreate(size_t count,size_t item){host_queue_t *q=calloc(1,sizeof(*q));assert(q);q->item=item;q->capacity=count;q->bytes=calloc(count,item);assert(q->bytes);return q;}
static unsigned uxQueueMessagesWaiting(QueueHandle_t q){return q?(unsigned)q->count:0;}
static int xQueueSend(QueueHandle_t q,const void *value,unsigned wait){(void)wait;if(q->count==q->capacity)return pdFALSE;memcpy(q->bytes+((q->start+q->count)%q->capacity)*q->item,value,q->item);q->count++;return pdTRUE;}
static int xQueueReceive(QueueHandle_t q,void *value,unsigned wait){(void)wait;if(!q->count)return pdFALSE;memcpy(value,q->bytes+q->start*q->item,q->item);q->count--;q->start=(q->start+1)%q->capacity;return pdTRUE;}
static void xQueueReset(QueueHandle_t q){q->start=q->count=0;}
