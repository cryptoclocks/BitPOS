/* Explicit host SDK/HTTPS/FatFs adapters, not physical SD/TLS/network proof.
 * Production header validation, download loop, SHA, cache and consumer run unchanged. */
#include <sys/stat.h>
#include <errno.h>
#include <unistd.h>
#include <strings.h>
static atomic_bool media_mounted,cache_writing;
static char fat_drive[3]="0:";
static const char *host_cache_root;
static bool host_sd=true,host_sd_sync=true,host_sd_rename=true;
static unsigned host_sd_writes,host_http_requests;
static const uint8_t *host_http_body;
static size_t host_http_size=PROMOTION_BYTES,host_http_offset;
static int host_http_status=200;
static int64_t host_http_length=PROMOTION_BYTES;
static bool host_http_chunked,host_http_duplicate,host_http_timeout,host_http_cancel,host_http_corrupt;
static unsigned host_http_tick;
static char host_http_sha[65];
static const char *host_http_mime="application/octet-stream";
/* FatFs boundary backs the real fixed-slot path/write/sync/rename algorithm. */
typedef struct { FILE *stream;size_t size; } FIL;
typedef unsigned UINT,BYTE,DSTATUS,DRESULT,WORD;
typedef uint32_t DWORD;
typedef int FRESULT;
enum {FR_OK,FR_EXIST,FR_NO_FILE,FR_DISK_ERR,FA_READ=16,FA_WRITE=32,FA_CREATE_ALWAYS=64,
    STA_NOINIT=1,STA_PROTECT=4,RES_OK=0,RES_ERROR=1,RES_WRPRT=2,RES_PARERR=3,
    CTRL_SYNC=1,GET_SECTOR_COUNT=2,GET_SECTOR_SIZE=3,GET_BLOCK_SIZE=4};
static BYTE drive;
static struct {struct {uint32_t capacity,sector_size;} csd;} card={.csd={4096,512}};
static esp_err_t sdmmc_get_status(void *c){(void)c;return host_sd?ESP_OK:3;}
static esp_err_t sdmmc_read_sectors(void *c,void *buffer,DWORD sector,UINT count){(void)c;(void)sector;memset(buffer,0,count*512);return host_sd?ESP_OK:3;}
static esp_err_t sdmmc_write_sectors(void *c,const void *buffer,DWORD sector,UINT count){(void)c;(void)buffer;(void)sector;(void)count;assert(atomic_load(&cache_writing));host_sd_writes++;return host_sd?ESP_OK:3;}
static bool cache_host_path(const char *path,char out[1024]) {
    assert(!host_lock_depth&&host_cache_root&&!strncmp(path,"0:/bitpos/promotions",strlen("0:/bitpos/promotions")));
    return snprintf(out,1024,"%s%s",host_cache_root,path+2)<1024;
}
static FRESULT f_open(FIL *file,const char *path,unsigned mode) {
    char host[1024];if(!host_sd||!cache_host_path(path,host))return FR_DISK_ERR;
    if(mode&FA_WRITE)assert(atomic_load(&cache_writing)&&strstr(path,".tmp")&&(strstr(path,"/0.tmp")||strstr(path,"/1.tmp")));
    file->stream=fopen(host,mode&FA_WRITE?"wb":"rb");if(!file->stream)return FR_NO_FILE;
    fseek(file->stream,0,SEEK_END);file->size=(size_t)ftell(file->stream);rewind(file->stream);return FR_OK;
}
static size_t f_size(FIL *file){return file->size;}
static FRESULT f_read(FIL *file,void *data,UINT size,UINT *read){assert(!host_lock_depth);*read=(UINT)fread(data,1,size,file->stream);return ferror(file->stream)?FR_DISK_ERR:FR_OK;}
static FRESULT f_write(FIL *file,const void *data,UINT size,UINT *written){assert(!host_lock_depth&&atomic_load(&cache_writing));host_sd_writes++;*written=host_sd?(UINT)fwrite(data,1,size,file->stream):0;return *written==size?FR_OK:FR_DISK_ERR;}
static FRESULT f_sync(FIL *file){assert(atomic_load(&cache_writing));return host_sd_sync&&fflush(file->stream)==0&&fsync(fileno(file->stream))==0?FR_OK:FR_DISK_ERR;}
static FRESULT f_close(FIL *file){return fclose(file->stream)==0?FR_OK:FR_DISK_ERR;}
static FRESULT f_mkdir(const char *path){char host[1024];assert(atomic_load(&cache_writing));cache_host_path(path,host);if(mkdir(host,0700)==0)return FR_OK;return errno==EEXIST?FR_EXIST:FR_DISK_ERR;}
static FRESULT f_unlink(const char *path){char host[1024];assert(atomic_load(&cache_writing));cache_host_path(path,host);assert(strstr(path,"/0.")||strstr(path,"/1."));if(unlink(host)==0)return FR_OK;return errno==ENOENT?FR_NO_FILE:FR_DISK_ERR;}
static FRESULT f_rename(const char *from,const char *to){char a[1024],b[1024];assert(atomic_load(&cache_writing));cache_host_path(from,a);cache_host_path(to,b);return host_sd_rename&&rename(a,b)==0?FR_OK:FR_DISK_ERR;}
/* ESP HTTP boundary: fake transport delivers fixture bytes/headers to the actual
 * event callback/loop. No sockets opened and no real TLS trust claim. */
typedef void *esp_http_client_handle_t;
typedef struct {int event_id;void *user_data;char *header_key,*header_value;} esp_http_client_event_t;
enum { HTTP_EVENT_ON_HEADER=1,pdPASS=1,portMAX_DELAY=0xffffffff };
typedef struct {
    const char *url;void *crt_bundle_attach;int timeout_ms,max_redirection_count,buffer_size;
    bool disable_auto_redirect;esp_err_t (*event_handler)(esp_http_client_event_t *);void *user_data;
} esp_http_client_config_t;
static esp_http_client_config_t host_http_config;
static void *esp_crt_bundle_attach=(void *)1;
static esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *config) {
    assert(!host_lock_depth&&!strncmp(config->url,"https://example.invalid/api/promotions/media/",strlen("https://example.invalid/api/promotions/media/")));
    assert(config->crt_bundle_attach&&config->disable_auto_redirect&&config->max_redirection_count==0&&config->timeout_ms==1000);
    host_http_config=*config;host_http_offset=0;host_http_requests++;return (void *)1;
}
static esp_err_t esp_http_client_open(esp_http_client_handle_t client,int length){assert(client&&length==0);return host_http_timeout?3:ESP_OK;}
static void emit_header(char *name,char *value){esp_http_client_event_t event={.event_id=HTTP_EVENT_ON_HEADER,.user_data=host_http_config.user_data,.header_key=name,.header_value=value};host_http_config.event_handler(&event);}
static int64_t esp_http_client_fetch_headers(esp_http_client_handle_t client){(void)client;char length[32];snprintf(length,sizeof(length),"%lld",(long long)host_http_length);emit_header("Content-Type",(char *)host_http_mime);emit_header("Content-Length",length);emit_header("X-Content-SHA256",host_http_sha);if(host_http_duplicate)emit_header("X-Content-SHA256",host_http_sha);return host_http_length;}
static int esp_http_client_get_status_code(esp_http_client_handle_t client){(void)client;return host_http_status;}
static bool esp_http_client_is_chunked_response(esp_http_client_handle_t client){(void)client;return host_http_chunked;}
static int esp_http_client_read(esp_http_client_handle_t client,char *buffer,int length){(void)client;assert(!host_lock_depth&&length<=2048);if(host_http_cancel){promotion_image_cancel();return -1;}if(host_http_tick)lv_tick_inc(host_http_tick);size_t n=host_http_size-host_http_offset;if(n>(size_t)length)n=(size_t)length;memcpy(buffer,host_http_body+host_http_offset,n);if(host_http_corrupt&&n)buffer[0]^=1;host_http_offset+=n;return (int)n;}
static bool esp_http_client_is_complete_data_received(esp_http_client_handle_t client){(void)client;return host_http_offset==host_http_size;}
static void esp_http_client_close(esp_http_client_handle_t client){(void)client;}
static void esp_http_client_cleanup(esp_http_client_handle_t client){(void)client;}
static int xQueueOverwrite(QueueHandle_t queue,const void *value){xQueueReset(queue);return xQueueSend(queue,value,0);}
static void vQueueDelete(QueueHandle_t queue){free(queue->bytes);free(queue);}
static int xTaskCreate(void (*task)(void *),const char *name,unsigned stack,void *arg,unsigned priority,void *handle){(void)task;(void)name;(void)stack;(void)arg;(void)priority;(void)handle;return pdPASS;}
static void *heap_caps_malloc(size_t size,unsigned caps){(void)caps;return malloc(size);}
static void heap_caps_free(void *data){free(data);}
