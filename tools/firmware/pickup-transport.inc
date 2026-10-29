/* Host-only JSON-lines transport adapter for the actual production consumer.
 * Build: python3 tools/firmware/ui-smoke.py --pickup-transport-output /tmp/bitpos-pickup-consumer
 * Run: ASAN_OPTIONS=detect_leaks=0 /tmp/bitpos-pickup-consumer <public-device-UUID>
 * Coordinator opens an authenticated actual API WebSocket (credentials stay in
 * its process), forwards unmodified inbound messages to stdin, and forwards
 * stdout command lines to that same socket. Never synthesize PICKUP_READY.
 * After CONFIG/SESSION_SYNC, arm one failure with {"host":"fail_first_flush"}
 * or {"host":"fail_first_ack_enqueue"}. Drive the production idle retry lane
 * with {"host":"tick","ms":1000}; {"host":"got_it"} uses actual LVGL pointer.
 * stderr emits sanitized host observations to join with API/DB receipts. These
 * are host transfers/NVS/audio counters, not physical display/acoustic proof.
 */
/* Match production image startup so CONFIG playlists pass the real capability
 * gate. This catalog-only bridge has no SD cache or image HTTPS transport:
 * those explicit host boundaries fail, never synthesize pixels or photo ACKs.
 * The separate promotion-photo runner exercises actual image bytes/cache IO. */
static uint8_t transport_image_pixels[PROMOTION_SLOTS][PROMOTION_BYTES];
typedef struct { promotion_t promotion;unsigned serial; } transport_image_job_t;
static QueueHandle_t transport_image_jobs;
static bool transport_image_read(unsigned slot,const char *hash,uint8_t *pixels) {
    (void)slot;(void)hash;(void)pixels;return false; /* No host SD cache. */
}
static bool transport_image_write(unsigned slot,const char *hash,const uint8_t *pixels) {
    (void)slot;(void)hash;(void)pixels;return false; /* No host SD cache. */
}
static bool transport_image_download(const promotion_t *job,uint8_t *pixels,unsigned serial) {
    (void)job;(void)pixels;(void)serial;return false; /* No host image network. */
}
static bool transport_image_enqueue(const promotion_t *job,unsigned serial) {
    transport_image_job_t queued={.promotion=*job,.serial=serial};
    xQueueReset(transport_image_jobs);return xQueueSend(transport_image_jobs,&queued,0)==pdTRUE;
}
static uint64_t transport_financial_digest(void) {
    uint64_t hash=14695981039346656037ULL;
    const unsigned char *bytes=(const unsigned char *)&table.saved;
    for(size_t i=0;i<sizeof(table.saved);i++){hash^=bytes[i];hash*=1099511628211ULL;}
    for(size_t i=0;i<sizeof(host_slots);i++){hash^=((const unsigned char *)host_slots)[i];hash*=1099511628211ULL;}
    return hash;
}
#include "scoped-catalog-guards.inc"
#include "daily-catalog-guards.inc"
#include "promotion-currency-guards.inc"
static void transport_trace(void) {
    unsigned scoped_rows=0,daily_rows=0,global_rows=0;for(unsigned i=0;i<table.rows_count;i++){scoped_rows+=table.rows[i].scoped_promotion;daily_rows+=table.rows[i].daily_promotion;global_rows+=table.rows[i].promotion;}
    fprintf(stderr,"{\"origin\":\"production_catalog_host_adapter\",\"rows\":%u,\"scoped_rows\":%u,\"daily_rows\":%u,\"global_rows\":%u,\"unit_minor\":\"%" PRIu64 "\",\"discount_minor\":\"%" PRIu64 "\",\"session\":\"%s\",\"target\":\"%s\",\"review_minor\":\"%" PRIu64 "\",\"order_minor\":\"%" PRIu64 "\",\"observed_cart\":%s,\"cart_owner\":%s,\"journal_writes\":%u}\n",
        table.rows_count,scoped_rows,daily_rows,global_rows,table.rows_count?table.rows[0].unit.minor:0,table.rows_count?table.rows[0].discount:0,table.catalog_session,table.scoped_target,
        table.total.minor,current.total.minor,table.observed_cart?"true":"false",table.cart_owner?"true":"false",host_writes);
    char promotion_price[64];table_format_money(&promotion.unit,promotion_price,sizeof(promotion_price));
    fprintf(stderr,"{\"origin\":\"production_promotion_host_adapter\",\"generation\":\"%" PRIu64 "\",\"count\":%u,\"authorized\":%s,\"active\":%s,\"visible\":%s,\"campaign\":\"%s\",\"currency\":\"%s\",\"decimals\":%u,\"unit_minor\":\"%" PRIu64 "\",\"base_minor\":\"%" PRIu64 "\",\"price\":\"%s\",\"price_label_visible\":%s,\"physical_proof\":false}\n",
        promotion_playlist.value.generation,promotion_playlist.value.count,promotion_playlist.authorized?"true":"false",
        promotion.active?"true":"false",promotion_visible()?"true":"false",promotion.campaign,promotion.unit.currency,
        promotion.unit.decimals,promotion.unit.minor,promotion.base.minor,promotion_price,
        ui.kind==UI_PROMOTION&&find_label(lv_screen_active(),promotion_price)?"true":"false");
    cJSON *effect=cJSON_CreateString(pickup.effect);assert(effect);
    char *escaped_effect=cJSON_PrintUnformatted(effect);assert(escaped_effect);
    fprintf(stderr,"{\"origin\":\"production_consumer_host_adapter\",\"connection\":\"%" PRIu64 "\",\"seq\":\"%" PRIu64 "\",\"synchronized\":%s,\"pickup_active\":%s,\"retry_event\":\"%s\",\"retry_request\":\"%s\",\"original_effect\":%s,\"guest_request\":\"%s\",\"flushes\":%u,\"sends\":%u,\"ACK_enqueue_failures\":%u,\"claims\":%u,\"pickup_audio\":%u,\"payment_audio\":%u,\"financial_digest\":\"%" PRIu64 "\",\"resync\":%s,\"physical_proof\":false}\n",
        table.connection,table.seq,table.synchronized?"true":"false",pickup.active?"true":"false",
        pickup_render_retry.event,pickup_render_retry.request,escaped_effect,pickup_ack.request,
        host_flushes,host_sends,host_render_ack_failures,host_claims,host_pickup_audio,host_audio,
        transport_financial_digest(),atomic_load(&resync)?"true":"false");
    free(escaped_effect);cJSON_Delete(effect);
    fflush(stderr);
}
int main(int argc,char **argv) {
    if(argc!=2||!table_uuid(argv[1])){fputs("Expected a public device UUID (no credentials)\n",stderr);return 2;}
    lv_init();lv_display_t *display=lv_display_create(480,320);assert(display);
    lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display,pixels,NULL,sizeof(pixels),LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(display,flush);
    touches=xQueueCreate(12,sizeof(touch_t));inbox=xQueueCreate(8,sizeof(message_t));
    transport_image_jobs=xQueueCreate(1,sizeof(transport_image_job_t));assert(transport_image_jobs);
    const promotion_image_ops_t image_ops={.read=transport_image_read,.write=transport_image_write,
        .download=transport_image_download,.enqueue=transport_image_enqueue};
    assert(promotion_images_init(transport_image_pixels[0],transport_image_pixels[1],&image_ops));
    socket_client=(void *)1;state_nvs=1;pointer=lv_indev_create();
    lv_indev_set_type(pointer,LV_INDEV_TYPE_POINTER);lv_indev_set_display(pointer,display);
    lv_indev_set_read_cb(pointer,pointer_read);lv_indev_add_event_cb(pointer,any_touch,LV_EVENT_PRESSED,NULL);
    strcpy(table.device,argv[1]);connected=true;photos_ready=false;host_wire_stdio=true;
    atomic_store(&clock_synced,true);restore_journal();restore_pickup_ack();physical_render();
    transport_trace();
    char line[MESSAGE_MAX+2];int status=0;
    while(fgets(line,sizeof(line),stdin)) {
        size_t length=strlen(line);
        if(!length||line[length-1]!='\n'||length>MESSAGE_MAX){status=2;break;}
        line[--length]=0;if(length&&line[length-1]=='\r')line[--length]=0;
        if(!table_json_bounded(line,length)){status=2;break;}
        cJSON *j=cJSON_ParseWithOpts(line,NULL,true);if(!j){status=2;break;}
        cJSON *control=cJSON_GetObjectItemCaseSensitive(j,"host");
        if(control) {
            if(!cJSON_IsString(control)){cJSON_Delete(j);status=2;break;}
            if(!strcmp(control->valuestring,"fail_first_flush"))host_fail_flushes=1;
            else if(!strcmp(control->valuestring,"fail_first_ack_enqueue"))host_fail_render_acks=1;
            else if(!strcmp(control->valuestring,"tick")) {
                cJSON *ms=cJSON_GetObjectItemCaseSensitive(j,"ms");
                if(!cJSON_IsNumber(ms)||ms->valuedouble<0||ms->valuedouble>5000||ms->valuedouble!=(double)(uint32_t)ms->valuedouble){cJSON_Delete(j);status=2;break;}
                lv_tick_inc((uint32_t)ms->valuedouble);pickup_render_tick();
                promotion_render_tick();
                if(pickup_ack.request[0]&&lv_tick_get()-pickup_ack.sent_at>=5000)send_pickup_ack();
            }else if(!strcmp(control->valuestring,"got_it"))click("Got it");
            else if(!strcmp(control->valuestring,"expect_result")){
                if(!table_text(j,"requestId",table.read_request,sizeof(table.read_request))||!table_uuid(table.read_request)){cJSON_Delete(j);status=2;break;}
            }else if(!strcmp(control->valuestring,"catalog_guards")){
                transport_catalog_guards(cJSON_GetObjectItemCaseSensitive(j,"catalog"));
            }else if(!strcmp(control->valuestring,"daily_catalog_guards")){
                transport_daily_catalog_guards(cJSON_GetObjectItemCaseSensitive(j,"catalog"));
            }else if(!strcmp(control->valuestring,"promotion_currency_guards")){
                transport_promotion_currency_guards(cJSON_GetObjectItemCaseSensitive(j,"playlist"));
            }
            else {cJSON_Delete(j);status=2;break;}
        }else {
            message_t msg={0};memcpy(msg.json,line,length+1);consume_v2(&msg);
        }
        transport_image_job_t image_job;
        if(xQueueReceive(transport_image_jobs,&image_job,0)==pdTRUE&&!atomic_load(&resync)){
            assert(!host_lock_depth);promotion_image_work(&image_job.promotion,image_job.serial);
            promotion_render_tick();
        }
        cJSON_Delete(j);transport_trace();if(atomic_load(&resync)){status=3;break;}
    }
    stop_scene();lv_deinit();free(touches->bytes);free(touches);free(inbox->bytes);free(inbox);
    free(transport_image_jobs->bytes);free(transport_image_jobs);
    return status;
}
