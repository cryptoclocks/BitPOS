#include "bitpos_promotion.h"
#include "bitpos_media.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <string.h>
#include <strings.h>

typedef struct { promotion_t promotion;unsigned serial; } image_job_t;
static QueueHandle_t jobs;
typedef struct { char hash[65];unsigned headers;bool invalid; } image_headers_t;
static esp_err_t image_header(esp_http_client_event_t *event) {
    image_headers_t *h=event->user_data;
    if(event->event_id!=HTTP_EVENT_ON_HEADER)return ESP_OK;
    unsigned bit=0;
    if(!strcasecmp(event->header_key,"Content-Type")){
        bit=1;if(strcmp(event->header_value,"application/octet-stream"))h->invalid=true;
    }else if(!strcasecmp(event->header_key,"Content-Length")){
        bit=2;if(strcmp(event->header_value,"112000"))h->invalid=true;
    }else if(!strcasecmp(event->header_key,"X-Content-SHA256")){
        bit=4;if(strlen(event->header_value)!=64)h->invalid=true;
        else memcpy(h->hash,event->header_value,65);
    }
    if(bit&&(h->headers&bit))h->invalid=true;
    h->headers|=bit;return ESP_OK;
}
static bool download(const promotion_t *job,uint8_t *pixels,unsigned serial) {
    if(promotion_image_canceled(serial))return false;
    /* Parser already pinned exact origin/path. No redirect processing or cookies,
     * credentials, proxy, alternate host or financial endpoints are supported. */
    image_headers_t headers={0};
    esp_http_client_config_t config={.url=job->image_url,.crt_bundle_attach=esp_crt_bundle_attach,
        .timeout_ms=1000,.disable_auto_redirect=true,.max_redirection_count=0,
        .event_handler=image_header,.user_data=&headers,.buffer_size=2048};
    esp_http_client_handle_t client=esp_http_client_init(&config);
    if(!client)return false;
    int64_t started=esp_timer_get_time();bool ok=false;
    if(esp_http_client_open(client,0)!=ESP_OK||promotion_image_canceled(serial))goto done;
    if(esp_http_client_fetch_headers(client)!=PROMOTION_BYTES||esp_http_client_get_status_code(client)!=200||
       esp_http_client_is_chunked_response(client)||headers.invalid||headers.headers!=7||strcmp(headers.hash,job->sha256))goto done;
    unsigned used=0;
    while(used<PROMOTION_BYTES) {
        if(promotion_image_canceled(serial)||esp_timer_get_time()-started>8000000)goto done;
        unsigned room=PROMOTION_BYTES-used;if(room>2048)room=2048;
        int got=esp_http_client_read(client,(char *)pixels+used,(int)room);
        if(got<=0||got>(int)room)goto done;
        used+=(unsigned)got;
    }
    if(!promotion_image_canceled(serial)&&esp_timer_get_time()-started<=8000000&&
       esp_http_client_is_complete_data_received(client))ok=true;
done:
    esp_http_client_close(client);esp_http_client_cleanup(client);return ok;
}
static bool enqueue(const promotion_t *promotion,unsigned serial) {
    image_job_t job={.promotion=*promotion,.serial=serial};
    return jobs&&xQueueOverwrite(jobs,&job)==pdTRUE;
}
static void image_worker(void *arg) {
    (void)arg;image_job_t job;
    for(;;)if(xQueueReceive(jobs,&job,portMAX_DELAY)==pdTRUE)promotion_image_work(&job.promotion,job.serial);
}
bool bitpos_promotion_images_start(void) {
    if(promotion_images_supported())return true;
    uint8_t *pixels=heap_caps_malloc(PROMOTION_SLOTS*PROMOTION_BYTES,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(!pixels)return false;
    jobs=xQueueCreate(1,sizeof(image_job_t));
    if(!jobs){heap_caps_free(pixels);return false;}
    if(xTaskCreate(image_worker,"promotion_image",8192,NULL,2,NULL)!=pdPASS){vQueueDelete(jobs);jobs=NULL;heap_caps_free(pixels);return false;}
    const promotion_image_ops_t ops={.read=bitpos_media_promotion_read,.write=bitpos_media_promotion_write,.download=download,.enqueue=enqueue};
    return promotion_images_init(pixels,pixels+PROMOTION_BYTES,&ops);
}
