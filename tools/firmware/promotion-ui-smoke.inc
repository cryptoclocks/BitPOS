/* Actual production parser/consumer/LVGL/HTTPS-loop/hash/fixed-slot cache.
 * The provider photograph and HTTPS/SD adapters are explicit host fixtures. */
static const char *promo_target="70000000-0000-4000-8000-000000000001";
static const char *promo_campaign="71000000-0000-4000-8000-000000000001";
static const char *promo_event="72000000-0000-4000-8000-000000000001";
static unsigned promotion_tests;
static const char *playlist_table="73000000-0000-4000-8000-000000000001";
static time_t playlist_epoch;
static void promo_reset(void) {
    stop_scene();promotion_image_cancel();ready();table.auth=1;table.seq=0;
    memset(&promotion,0,sizeof(promotion));memset(&promotion_render_retry,0,sizeof(promotion_render_retry));
    memset(&promotion_playlist,0,sizeof(promotion_playlist));promotion_playlist.selected=-1;
    strcpy(table.table_id,playlist_table);playlist_epoch=time(NULL);
    promotion_image_requested=false;host_sends=0;host_http_status=200;host_http_length=PROMOTION_BYTES;
    host_http_size=PROMOTION_BYTES;host_http_chunked=host_http_duplicate=host_http_timeout=host_http_cancel=host_http_corrupt=false;
    host_http_tick=0;host_http_mime="application/octet-stream";host_sd=host_sd_sync=host_sd_rename=true;
    host_transfer=true;host_fail_flushes=host_fail_render_acks=0;atomic_store(&resync,false);
    atomic_store(&media_mounted,true);if(jobs)xQueueReset(jobs);
}
static cJSON *promo_wire(unsigned seq,const char *target,bool photo,bool cancel,int seconds) {
    cJSON *j=cJSON_CreateObject(),*p=cJSON_AddObjectToObject(j,"payload");char value[32],url[384];
    cJSON_AddNumberToObject(j,"schemaVersion",2);cJSON_AddStringToObject(j,"type","PROMOTION");
    cJSON_AddStringToObject(j,"deviceId",fixture_device);cJSON_AddStringToObject(j,"eventId",promo_event);
    snprintf(value,sizeof(value),"%u",seq);cJSON_AddStringToObject(j,"deviceSeq",value);
    snprintf(value,sizeof(value),"%" PRIu64,table.connection);cJSON_AddStringToObject(j,"connectionGeneration",value);
    snprintf(value,sizeof(value),"%" PRIu64,table.screen);cJSON_AddStringToObject(j,"screenGeneration",value);
    cJSON_AddStringToObject(j,"assignmentGeneration","1");cJSON_AddStringToObject(j,"authGeneration","1");
    cJSON_AddStringToObject(j,"occurredAt","2026-10-12T00:00:00.000Z");
    cJSON_AddStringToObject(p,"targetId",target);cJSON_AddStringToObject(p,"campaignId",promo_campaign);
    cJSON_AddStringToObject(p,"productId","40000000-0000-4000-8000-000000000001");
    cJSON_AddStringToObject(p,"headline","Your cafe moment");cJSON_AddStringToObject(p,"copy","Fresh latte. Limited time.");
    cJSON_AddNumberToObject(p,"discountPercent",20);cJSON_AddItemToObject(p,"basePrice",fixture_money(500,"USD"));
    cJSON_AddItemToObject(p,"unitPrice",fixture_money(400,"USD"));cJSON_AddStringToObject(p,"state",cancel?"CANCELED":"READY");
    time_t future=time(NULL)+seconds;struct tm utc;gmtime_r(&future,&utc);char date[32];strftime(date,sizeof(date),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_AddStringToObject(p,"expiresAt",date);
    snprintf(url,sizeof(url),"%s?offer=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",table.table_entry_url);cJSON_AddStringToObject(p,"menuUrl",url);
    if(photo){cJSON *i=cJSON_AddObjectToObject(p,"image");cJSON_AddStringToObject(i,"url","https://example.invalid/api/promotions/media/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/image.rgb565");cJSON_AddStringToObject(i,"sha256",host_http_sha);cJSON_AddNumberToObject(i,"bytes",PROMOTION_BYTES);cJSON_AddNumberToObject(i,"width",280);cJSON_AddNumberToObject(i,"height",200);cJSON_AddStringToObject(i,"format","rgb565le");}
    else cJSON_AddNullToObject(p,"image");
    return j;
}
static void promo_expect_rejected(cJSON *j) {
    unsigned sends=host_sends,claims=host_claims,writes=host_writes;table_durable_t saved=table.saved;
    char *wire=cJSON_PrintUnformatted(j);message_t msg={0};assert(strlen(wire)<sizeof(msg.json));strcpy(msg.json,wire);free(wire);cJSON_Delete(j);
    consume_v2(&msg);assert(atomic_exchange(&resync,false));assert(host_sends==sends&&host_claims==claims&&host_writes==writes&&!promotion.active);
    assert(!memcmp(&saved,&table.saved,sizeof(saved)));promotion_tests++;
}
static void bundle_parser_guards(void) {
    for(unsigned i=0;i<4;i++) {
        promo_reset();cJSON *j=promo_wire(1,promo_target,false,false,300),*p=cJSON_GetObjectItem(j,"payload");
        cJSON_AddBoolToObject(p,"bundle",true);cJSON_AddStringToObject(p,"discountLabel","20% OFF");
        cJSON_ReplaceItemInObject(p,"discountPercent",cJSON_CreateNumber(1));
        if(i==1)cJSON_DeleteItemFromObject(p,"discountLabel");
        if(i==2)cJSON_ReplaceItemInObject(p,"bundle",cJSON_CreateString("true"));
        if(i==3)cJSON_ReplaceItemInObject(cJSON_GetObjectItem(p,"unitPrice"),"amountMinor",cJSON_CreateString("0"));
        promotion_t parsed;assert(promotion_parse(&table,j,&parsed)==(i==0));
        if(i==0)assert(parsed.bundle&&!strcmp(parsed.discount_label,"20% OFF")&&parsed.unit.minor==400);
        cJSON_Delete(j);promotion_tests++;
    }
    puts("production_bundle_fixed_price_label_and_malformed_guards");
}
static void promo_parser_guards(void) {
    const char *fields[]={"deviceId","connectionGeneration","assignmentGeneration","authGeneration","screenGeneration","deviceSeq"};
    for(unsigned i=0;i<6;i++){
        promo_reset();if(i==5)table.seq=2;
        cJSON *j=promo_wire(1,promo_target,true,false,300);
        cJSON_ReplaceItemInObjectCaseSensitive(j,fields[i],cJSON_CreateString(i==0?fixture_order:i==5?"1":"9"));promo_expect_rejected(j);
    }
    const char *urls[]={"http://example.invalid/api/promotions/media/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/image.rgb565",
        "https://evil.invalid/api/promotions/media/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/image.rgb565",
        "https://example.invalid.evil/api/promotions/media/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/image.rgb565",
        "https://example.invalid/api/promotions/media/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/image.rgb565?redirect=x"};
    for(unsigned i=0;i<4;i++){promo_reset();cJSON *j=promo_wire(1,promo_target,true,false,300);cJSON *p=cJSON_GetObjectItem(j,"payload"),*image=cJSON_GetObjectItem(p,"image");cJSON_ReplaceItemInObject(image,"url",cJSON_CreateString(urls[i]));promo_expect_rejected(j);}
    const char *keys[]={"bytes","width","height","format","sha256"};
    for(unsigned i=0;i<5;i++){promo_reset();cJSON *j=promo_wire(1,promo_target,true,false,300);cJSON *image=cJSON_GetObjectItem(cJSON_GetObjectItem(j,"payload"),"image");cJSON_ReplaceItemInObject(image,keys[i],i<3?cJSON_CreateNumber(i==0?PROMOTION_BYTES+1:1):cJSON_CreateString(i==3?"png":"ABC"));promo_expect_rejected(j);}
    promo_reset();cJSON *j=promo_wire(1,promo_target,false,false,300);cJSON_ReplaceItemInObject(cJSON_GetObjectItem(j,"payload"),"menuUrl",cJSON_CreateString("https://example.invalid/table/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD?offer=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"));promo_expect_rejected(j);
    promo_reset();j=promo_wire(1,promo_target,false,false,300);cJSON_ReplaceItemInObject(cJSON_GetObjectItem(cJSON_GetObjectItem(j,"payload"),"unitPrice"),"amountMinor",cJSON_CreateString("399"));promo_expect_rejected(j);
    promo_reset();table.auth=0;promo_expect_rejected(promo_wire(1,promo_target,false,false,300));
    puts("production_promotion_parser_authenticated_device_assignment_auth_screen_seq_origin_menu_size_hash_price_guards_no_journal_or_sound");
}
static void promo_run_worker(void){image_job_t job;assert(xQueueReceive(jobs,&job,0)==pdTRUE);assert(!host_lock_depth);promotion_image_work(&job.promotion,job.serial);promotion_render_tick();}
static void clear_cache(void) {
    for(unsigned slot=0;slot<2;slot++){char path[1024];snprintf(path,sizeof(path),"%s/bitpos/promotions/v1/%u.rgb",host_cache_root,slot);unlink(path);}
}
static void promo_receipt(void){cJSON *value=cJSON_CreateObject();cJSON_AddBoolToObject(value,"acknowledged",true);char request[37],screen[32];strcpy(request,promotion_render_retry.request);snprintf(screen,sizeof(screen),"%" PRIu64,promotion_render_retry.screen);reply(request,value,screen);assert(promotion_render_retry.acknowledged);}
static void promo_behavior(void) {
    promo_reset();table_durable_t saved=table.saved;unsigned audio=host_audio,pickup_audio=host_pickup_audio,writes=host_writes;
    feed(promo_wire(1,promo_target,false,false,300));assert(promotion_visible()&&ui.kind==UI_PROMOTION&&ui.promotion_qr);
    assert(find_label(lv_screen_active(),"Photo unavailable")&&find_label(lv_screen_active(),"Your cafe moment")&&find_label(lv_screen_active(),"20% OFF")&&find_label(lv_screen_active(),"USD 4.00")&&find_label(lv_screen_active(),"View menu"));
    assert(!memcmp(&saved,&table.saved,sizeof(saved))&&host_writes==writes);assert(host_sends==1);promo_receipt();
    unsigned before=host_sends;feed(promo_wire(1,promo_target,false,false,300));assert(host_sends==before);image("promotion-fallback");
    feed(promo_wire(2,fixture_order,false,true,300));assert(promotion.active&&ui.kind==UI_PROMOTION&&host_sends==before);
    feed(promo_wire(3,promo_target,false,true,300));assert(!promotion.active&&ui.kind!=UI_PROMOTION&&host_sends==before+1);promo_receipt();
    assert(host_audio==audio&&host_pickup_audio==pickup_audio&&!memcmp(&saved,&table.saved,sizeof(saved)));promotion_tests+=4;
    promo_reset();feed(promo_wire(1,promo_target,false,false,-1));assert(!promotion.active&&host_sends==0);promotion_tests++;
    promo_reset();table.observed_cart=true;feed(promo_wire(1,promo_target,false,false,300));assert(host_sends==0&&ui.kind!=UI_PROMOTION);table.observed_cart=false;lv_tick_inc(1000);promotion_render_tick();assert(ui.kind==UI_PROMOTION&&host_sends==1);promotion_tests++;
    promo_reset();pickup.active=true;pickup.screen=table.screen;pickup.assignment=table.assignment;pickup.expires_ms=wall_ms()+300000;strcpy(pickup.code,"A012");assert(physical_render());feed(promo_wire(1,promo_target,false,false,300));assert(ui.kind==UI_PICKUP&&host_sends==0);pickup.active=false;lv_tick_inc(1000);promotion_render_tick();assert(ui.kind==UI_PROMOTION&&host_sends==1);promotion_tests++;
    promo_reset();feed(promo_wire(1,promo_target,false,false,300));promotion.expires_ms=wall_ms()-1;before=host_sends;promotion_render_tick();assert(!promotion.active&&ui.kind!=UI_PROMOTION&&host_sends==before);promotion_tests++;
    promo_reset();feed(promo_wire(1,promo_target,false,false,300));table.connection++;table.synchronized=false;connected=false;promotion_render_tick();assert(!promotion.active&&!promotion_render_retry.event[0]);assert(physical_render()&&ui.kind!=UI_PROMOTION);connected=true;table.synchronized=true;feed(promo_wire(2,promo_target,false,false,300));assert(ui.kind==UI_PROMOTION&&host_audio==audio&&host_pickup_audio==pickup_audio);promotion_tests++;
    for(unsigned failure=0;failure<2;failure++){
        promo_reset();if(failure)host_fail_render_acks=1;else host_fail_flushes=1;
        feed(promo_wire(1,promo_target,false,false,300));assert(host_sends==0&&promotion_render_retry.event[0]);char request[37];strcpy(request,promotion_render_retry.request);
        lv_tick_inc(1000);promotion_render_tick();assert(host_sends==1&&strstr(host_sent[0],request)&&strstr(host_sent[0],promo_event));promo_receipt();
        before=host_sends;lv_tick_inc(1000);promotion_render_tick();assert(host_sends==before);promotion_tests++;
    }
    promo_reset();feed(promo_wire(1,promo_target,false,false,300));before=host_sends;assert(!table.saved.pending.kind);click("View menu");
    assert(table.saved.pending.kind==TC_OPEN&&host_sends==before+1&&strstr(host_sent[host_sends-1],"CART_OPEN")&&strstr(host_sent[host_sends-1],"\"offerToken\":\"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\""));
    char first[TABLE_SEND_MAX+1];strcpy(first,host_sent[host_sends-1]);send_pending();assert(!strcmp(first,host_sent[host_sends-1]));promotion_tests++;
    table.open_offer[0]=table.open_offer_request[0]=0;restore_promotion_open();send_pending();assert(!strcmp(first,host_sent[host_sends-1]));promotion_tests++;
    promo_reset();assert(begin_command(TC_OPEN));assert(!strstr(host_sent[host_sends-1],"offerToken"));promotion_tests++;
    assert(host_audio==audio&&host_pickup_audio==pickup_audio);
    puts("production_480x320_promotion_render_QR_explicit_pointer_menu_target_cancel_busy_priority_expiry_reconnect_original_receipt_flush_enqueue_retry_duplicate_ACK_no_sound");
}
static void promo_images(void) {
    promo_reset();clear_cache();feed(promo_wire(1,promo_target,true,false,300));unsigned requests=host_http_requests;promo_run_worker();
    assert(host_http_requests==requests+1&&find_label(lv_screen_active(),"Your cafe moment"));
    const lv_image_dsc_t *photo=promotion_image_acquire(&promotion);/* Scene already owns descriptor; second acquisition may find none. */
    assert(!photo);assert(ui.kind==UI_PROMOTION);image("promotion-real-product-photo");
    /* Observable framebuffer proves actual RGB565 photograph pixels rendered,
     * not merely an image descriptor or a replaced renderer callback. */
    assert(!memcmp(pixels+(100*480+40)*2,host_http_body+(48*280+28)*2,2));
    promotion_t replacement=promotion;strcpy(replacement.target,"70000000-0000-4000-8000-000000000002");
    unsigned serial=promotion_image_request(&replacement);image_job_t queued;assert(xQueueReceive(jobs,&queued,0)==pdTRUE);
    promotion_image_work(&replacement,serial);
    assert(!memcmp(pixels+(100*480+40)*2,host_http_body+(48*280+28)*2,2));promotion_tests++;
    unsigned writes=host_sd_writes;promo_reset();feed(promo_wire(1,fixture_order,true,false,300));requests=host_http_requests;promo_run_worker();assert(host_http_requests==requests&&host_sd_writes==writes);promotion_tests+=2;
    /* Guard the actual driver, not only a path mock: legacy writes and TRIM denied. */
    uint8_t sector[512]={0};assert(media_disk_write(drive,sector,0,1)==RES_WRPRT);assert(media_disk_ioctl(drive,99,NULL)==RES_WRPRT);promotion_tests++;
    for(unsigned failure=0;failure<13;failure++){
        promo_reset();clear_cache();
        switch(failure){case 0:host_http_status=302;break;case 1:host_http_mime="image/png";break;
            case 2:host_http_length=PROMOTION_BYTES+1;break;case 3:host_http_size=PROMOTION_BYTES-1;break;
            case 4:host_http_size=PROMOTION_BYTES+1;break;case 5:host_http_chunked=true;break;
            case 6:host_http_duplicate=true;break;case 7:host_http_timeout=true;break;
            case 8:host_http_tick=1001;break;case 9:host_http_corrupt=true;break;
            case 10:host_sd=false;break;case 11:host_sd_sync=false;break;case 12:host_sd_rename=false;break;}
        char unique_target[37];snprintf(unique_target,sizeof(unique_target),"70000000-0000-4000-8000-%012u",failure+10);
        feed(promo_wire(1,unique_target,true,false,300));promo_run_worker();
        assert(strcmp(promotion_image_fallback(),"Photo unavailable")&&ui.kind==UI_PROMOTION&&ui.promotion_qr);
        assert(!promotion_image_acquire(&promotion)&&!atomic_load(&cache_writing));promotion_tests++;
    }
    promo_reset();clear_cache();feed(promo_wire(1,"70000000-0000-4000-8000-000000000090",true,false,300));char original_hash_byte=host_http_sha[0];host_http_sha[0]=original_hash_byte=='a'?'b':'a';promo_run_worker();assert(strstr(promotion_image_fallback(),"network"));host_http_sha[0]=original_hash_byte;promotion_tests++;
    promo_reset();clear_cache();feed(promo_wire(1,"70000000-0000-4000-8000-000000000091",true,false,300));host_http_cancel=true;promo_run_worker();assert(!promotion_image_acquire(&promotion));promotion_tests++;
    promo_reset();clear_cache();feed(promo_wire(1,promo_target,true,false,300));image_job_t job;assert(xQueueReceive(jobs,&job,0)==pdTRUE);
    order_event("ORDER",2,"AWAITING_PAYMENT",false);assert(ui.kind==UI_QR&&!promotion.active&&promotion_image_canceled(job.serial));requests=host_http_requests;promotion_image_work(&job.promotion,job.serial);assert(host_http_requests==requests);promotion_tests++;
    puts("production_async_HTTPS_header_type_length_redirect_timeout_cancelpriority_SHA_payload_bounded_atomic_fixed_slot_SD_sync_rename_cache_truthful_fallback_legacy_write_TRIM_denied");
}
/* Real consumer/LVGL/flush/worker behavior, with existing explicit host IO. */
static void playlist_date(cJSON *p,const char *key,int offset) {
    time_t t=playlist_epoch+offset;struct tm utc;gmtime_r(&t,&utc);char date[32];
    strftime(date,sizeof(date),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_AddStringToObject(p,key,date);
}
static cJSON *playlist_payload(unsigned generation,unsigned daily,bool personal,bool photo,unsigned occupancy,int start,int end) {
    cJSON *p=cJSON_CreateObject(),*items=cJSON_AddArrayToObject(p,"items");char value[32];
    snprintf(value,sizeof(value),"%u",generation);cJSON_AddStringToObject(p,"generation",value);
    if(occupancy){snprintf(value,sizeof(value),"%u",occupancy);cJSON_AddStringToObject(p,"occupancyGeneration",value);}
    else cJSON_AddNullToObject(p,"occupancyGeneration");
    if(table.table_id[0])cJSON_AddStringToObject(p,"tableId",table.table_id);else cJSON_AddNullToObject(p,"tableId");
    cJSON_AddStringToObject(p,"state","CURRENT");
    for(unsigned i=0;i<daily+(unsigned)personal;i++){
        char target[37],headline[32];snprintf(target,sizeof(target),"70000000-0000-4000-8000-%012u",i+1);
        cJSON *legacy=promo_wire(1,target,photo,false,300),*item=cJSON_DetachItemFromObjectCaseSensitive(legacy,"payload");
        cJSON_Delete(legacy);cJSON_DeleteItemFromObjectCaseSensitive(item,"state");cJSON_DeleteItemFromObjectCaseSensitive(item,"expiresAt");
        cJSON_AddNumberToObject(item,"campaignVersion",1);cJSON_AddStringToObject(item,"audience",i<daily?"daily":"personal");
        snprintf(headline,sizeof(headline),i<daily?"Daily %u":"Personal %u",i+1);
        cJSON_ReplaceItemInObjectCaseSensitive(item,"headline",cJSON_CreateString(headline));
        cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",table.table_entry_url[0]?cJSON_CreateString(table.table_entry_url):cJSON_CreateNull());
        playlist_date(item,"startsAt",start);playlist_date(item,"expiresAt",end);cJSON_AddItemToArray(items,item);
    }
    return p;
}
static cJSON *playlist_frame(const char *type,unsigned seq,unsigned screen,cJSON *p) {
    cJSON *j=promo_wire(seq,promo_target,false,false,300);char value[40];
    cJSON_ReplaceItemInObjectCaseSensitive(j,"type",cJSON_CreateString(type));
    snprintf(value,sizeof(value),"72000000-0000-4000-8000-%012u",seq);
    cJSON_ReplaceItemInObjectCaseSensitive(j,"eventId",cJSON_CreateString(value));
    snprintf(value,sizeof(value),"%u",screen);cJSON_ReplaceItemInObjectCaseSensitive(j,"screenGeneration",cJSON_CreateString(value));
    if(!strcmp(type,"PROMOTION_PLAYLIST"))cJSON_ReplaceItemInObjectCaseSensitive(j,"payload",p);
    else{
        cJSON *payload=cJSON_CreateObject(),*owner=payload;
        if(!strcmp(type,"SNAPSHOT")){owner=cJSON_AddObjectToObject(payload,"screen");cJSON_AddNullToObject(payload,"recoverableDraft");}
        cJSON_AddStringToObject(owner,"kind","idle");cJSON_AddStringToObject(owner,"screenGeneration",value);
        if(p)cJSON_AddItemToObject(payload,"promotionPlaylist",p);
        cJSON_ReplaceItemInObjectCaseSensitive(j,"payload",payload);
    }
    return j;
}
static unsigned playlist_acks(void) {
    unsigned n=0;for(unsigned i=0;i<host_sends;i++)n+=strstr(host_sent[i],"\"type\":\"ACK\"")!=NULL;return n;
}
static void playlist_sync(void) {
    if(!table.sync_request[0])return;
    cJSON *value=cJSON_CreateObject(),*screen=cJSON_AddObjectToObject(value,"screen");char generation[32],request[37];
    snprintf(generation,sizeof(generation),"%" PRIu64,table.screen);strcpy(request,table.sync_request);
    cJSON_AddStringToObject(screen,"kind","idle");cJSON_AddStringToObject(screen,"screenGeneration",generation);
    cJSON_AddNullToObject(value,"pendingOrder");cJSON_AddNullToObject(value,"pendingResult");reply(request,value,generation);
}
static void playlist_bootstrap_mode(bool counter) {
    promo_reset();table.configured=false;table.synchronized=false;
    if(counter)table.table_id[0]=table.table_entry_url[0]=0;
    cJSON *j=playlist_frame("SNAPSHOT",1,1,NULL),*p=cJSON_CreateObject();
    cJSON_ReplaceItemInObjectCaseSensitive(j,"type",cJSON_CreateString("CONFIG"));
    cJSON_AddStringToObject(p,"deviceId",fixture_device);cJSON_AddStringToObject(p,"label","Mini fixture");
    if(counter){cJSON_AddNullToObject(p,"tableLabel");cJSON_AddNullToObject(p,"tableId");}
    else{cJSON_AddStringToObject(p,"tableLabel","Host fixture table");cJSON_AddStringToObject(p,"tableId",playlist_table);}
    cJSON_AddStringToObject(p,"assignmentGeneration","1");cJSON_AddStringToObject(p,"authGeneration","1");
    cJSON_AddStringToObject(p,"paymentOrigin",table.payment_origin);
    if(counter)cJSON_AddNullToObject(p,"tableEntryUrl");else cJSON_AddStringToObject(p,"tableEntryUrl",table.table_entry_url);
    cJSON_AddNullToObject(p,"pairingGeneration");cJSON_AddBoolToObject(p,"pricingReady",true);cJSON_AddStringToObject(p,"priceVersion","fixture-price");
    cJSON_AddItemToObject(p,"promotionPlaylist",playlist_payload(1,0,false,false,0,-1,300));
    cJSON_ReplaceItemInObjectCaseSensitive(j,"payload",p);feed(j);
    assert(!playlist_acks()&&!promotion_visible());playlist_sync();lv_tick_inc(1000);promotion_render_tick();
    assert(playlist_acks()==1);promo_receipt();host_sends=0;
}
static void playlist_bootstrap(void){playlist_bootstrap_mode(false);}
static void playlist_reject(cJSON *j) {
    unsigned sends=host_sends,audio=host_audio,pickup_audio=host_pickup_audio,writes=host_writes,claims=host_claims;
    table_durable_t saved=table.saved;
    char *wire=cJSON_PrintUnformatted(j);message_t msg={0};assert(strlen(wire)<sizeof(msg.json));strcpy(msg.json,wire);free(wire);cJSON_Delete(j);
    consume_v2(&msg);assert(atomic_exchange(&resync,false)&&host_sends==sends&&host_audio==audio&&host_pickup_audio==pickup_audio);
    assert(host_writes==writes&&host_claims==claims&&!memcmp(&saved,&table.saved,sizeof(saved)));promotion_tests++;
}
static void playlist_parser_guards(void) {
    promo_reset();promotion_playlist_t parsed;
    playlist_bootstrap();cJSON *extended=playlist_payload(2,3,true,false,10,-1,300);
    assert(promotion_playlist_parse(&table,extended,table.screen,&parsed)&&parsed.count==4);
    for(unsigned n=0;n<3;n++)assert(promotion_playlist_select(&parsed,wall_ms(),0,n)==(int)n);
    assert(promotion_playlist_select(&parsed,wall_ms(),1,0)==3);cJSON_Delete(extended);promotion_tests+=5;
    for(unsigned bad=0;bad<13;bad++){
        cJSON *p=playlist_payload(2,2,true,false,10,-1,300),*items=cJSON_GetObjectItemCaseSensitive(p,"items"),*item=cJSON_GetArrayItem(items,0);
        switch(bad){
            case 0:cJSON_ReplaceItemInObjectCaseSensitive(p,"generation",cJSON_CreateString("0"));break;
            case 1:cJSON_ReplaceItemInObjectCaseSensitive(p,"state",cJSON_CreateString("READY"));break;
            case 2:cJSON_ReplaceItemInObjectCaseSensitive(p,"tableId",cJSON_CreateString(fixture_order));break;
            case 3:cJSON_ReplaceItemInObjectCaseSensitive(p,"occupancyGeneration",cJSON_CreateNull());break;
            case 4:cJSON_AddItemToArray(items,cJSON_Duplicate(item,true));break;
            case 5:cJSON_Delete(p);p=playlist_payload(2,4,false,false,10,-1,300);break;
            case 6:cJSON_ReplaceItemInObjectCaseSensitive(item,"audience",cJSON_CreateString("personal"));break;
            case 7:cJSON_ReplaceItemInObjectCaseSensitive(item,"campaignVersion",cJSON_CreateNumber(0));break;
            case 8:cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(items,1),"targetId",cJSON_CreateString(promo_target));break;
            case 9:cJSON_DeleteItemFromObjectCaseSensitive(item,"startsAt");playlist_date(item,"startsAt",301);break;
            case 10:cJSON_DeleteItemFromObjectCaseSensitive(item,"expiresAt");playlist_date(item,"expiresAt",604801);break;
            case 11:item=cJSON_GetArrayItem(items,2);cJSON_DeleteItemFromObjectCaseSensitive(item,"expiresAt");playlist_date(item,"expiresAt",601);break;
            case 12:{char url[384];snprintf(url,sizeof(url),"%s?offer=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",table.table_entry_url);cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(items,2),"menuUrl",cJSON_CreateString(url));break;}
        }
        assert(!promotion_playlist_parse(&table,p,table.screen,&parsed));cJSON_Delete(p);promotion_tests++;
    }
    const char *fields[]={"deviceId","connectionGeneration","assignmentGeneration","authGeneration","screenGeneration","deviceSeq"};
    for(unsigned i=0;i<6;i++){
        playlist_bootstrap();cJSON *j=playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,true,false,10,-1,300));
        cJSON_ReplaceItemInObjectCaseSensitive(j,fields[i],cJSON_CreateString(i==0?fixture_order:i==5?"0":"9"));playlist_reject(j);
    }
    puts("production_playlist_parser_max4_3daily_1personal_table_occupancy_version_unique_targets_starts_expiry_7day_10minute_envelope_fences");
}
static void playlist_behavior(void) {
    playlist_bootstrap();unsigned audio=host_audio,pickup_audio=host_pickup_audio,writes=host_writes;table_durable_t saved=table.saved;
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,2,true,false,10,-1,300)));
    assert(find_label(lv_screen_active(),"Daily 1")&&playlist_acks()==0);
    char request[37];strcpy(request,promotion_render_retry.request);
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();assert(find_label(lv_screen_active(),"Personal 3")&&playlist_acks()==0);
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();assert(find_label(lv_screen_active(),"Daily 2")&&playlist_acks()==1);
    assert(strstr(host_sent[host_sends-1],request)&&strstr(host_sent[host_sends-1],"72000000-0000-4000-8000-000000000002"));
    promo_receipt();unsigned sends=host_sends;
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,2,true,false,10,-1,300)));assert(host_sends==sends);
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();assert(find_label(lv_screen_active(),"Daily 1")&&host_sends==sends);
    assert(!memcmp(&saved,&table.saved,sizeof(saved))&&host_writes==writes&&host_audio==audio&&host_pickup_audio==pickup_audio);promotion_tests+=4;
    for(unsigned failure=0;failure<2;failure++){
        playlist_bootstrap();if(failure)host_fail_render_acks=1;else host_fail_flushes=1;
        feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,false,false,0,-1,300)));
        assert(playlist_acks()==0);strcpy(request,promotion_render_retry.request);
        lv_tick_inc(1000);promotion_render_tick();assert(playlist_acks()==1&&strstr(host_sent[host_sends-1],request));
        promo_receipt();lv_tick_inc(1000);promotion_render_tick();assert(playlist_acks()==1);promotion_tests++;
    }
    playlist_bootstrap();table.observed_cart=true;
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,true,true,10,-1,300)));
    assert(!promotion_visible()&&playlist_acks()==0&&uxQueueMessagesWaiting(jobs)==0);
    table.observed_cart=false;pickup.active=true;pickup.screen=table.screen;pickup.assignment=table.assignment;
    pickup.expires_ms=wall_ms()+300000;strcpy(pickup.code,"A012");assert(physical_render());
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();assert(ui.kind==UI_PICKUP&&playlist_acks()==0&&uxQueueMessagesWaiting(jobs)==0);
    pickup.active=false;lv_tick_inc(1000);promotion_render_tick();assert(ui.kind==UI_PROMOTION&&playlist_acks()==0);
    promo_run_worker();assert(ui.promotion_photo&&playlist_acks()==0);
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();assert(find_label(lv_screen_active(),"Personal 2")&&playlist_acks()==0);
    promo_run_worker();assert(ui.promotion_photo&&playlist_acks()==1);promo_receipt();promotion_tests+=3;
    playlist_bootstrap();feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,true,true,10,-1,300)));
    image_job_t stale;assert(xQueueReceive(jobs,&stale,0)==pdTRUE);
    /* CART idle cancels even when the preceding personal tombstone was lost. */
    feed(playlist_frame("CART",3,2,playlist_payload(3,1,false,false,0,-1,300)));
    assert(promotion_image_canceled(stale.serial)&&find_label(lv_screen_active(),"Daily 1")&&playlist_acks()==1);
    unsigned downloads=host_http_requests;promotion_image_work(&stale.promotion,stale.serial);
    assert(host_http_requests==downloads&&!ui.promotion_photo);
    playlist_reject(playlist_frame("PROMOTION_PLAYLIST",4,2,playlist_payload(2,1,true,false,10,-1,300)));
    assert(!promotion.personal&&find_label(lv_screen_active(),"Daily 1"));
    playlist_reject(playlist_frame("PROMOTION_PLAYLIST",4,2,playlist_payload(4,1,true,false,10,-1,300)));promotion_tests+=3;
    feed(playlist_frame("CART",5,3,playlist_payload(5,0,false,false,0,-1,300)));
    assert(ui.kind!=UI_PROMOTION&&!promotion.active&&playlist_acks()==2);promotion_tests++;
    playlist_bootstrap();cJSON *current=playlist_payload(2,1,true,false,10,-1,300);
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,cJSON_Duplicate(current,true)));
    connected=false;table.synchronized=false;invalidate_promotion(false);assert(physical_render()&&ui.kind!=UI_PROMOTION);
    table.connection++;connected=true;table.synchronized=true;
    playlist_reject(playlist_frame("PROMOTION_PLAYLIST",3,1,cJSON_Duplicate(current,true)));assert(!promotion_visible());
    feed(playlist_frame("SNAPSHOT",4,1,current));assert(!promotion_visible());playlist_sync();
    lv_tick_inc(1000);promotion_render_tick();assert(find_label(lv_screen_active(),"Daily 1"));promotion_tests+=2;
    playlist_bootstrap();feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,true,false,10,-301,-1)));
    assert(ui.kind!=UI_PROMOTION&&playlist_acks()==0&&!promotion_render_retry.event[0]);promotion_tests++;
    playlist_bootstrap();feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,false,true,0,60,300)));
    assert(ui.kind!=UI_PROMOTION&&playlist_acks()==0&&uxQueueMessagesWaiting(jobs)==0);promotion_tests++;
    playlist_bootstrap();feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,0,true,false,10,-1,300)));
    assert(find_label(lv_screen_active(),"Personal 1")&&playlist_acks()==1);click("View menu");
    assert(table.saved.pending.kind==TC_OPEN&&!table.open_offer[0]&&!table.scoped_target[0]&&
        !strstr(host_sent[host_sends-1],"offerToken"));promotion_tests++;
    playlist_bootstrap();feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,true,true,10,-1,300)));
    assert(xQueueReceive(jobs,&stale,0)==pdTRUE);order_event("ORDER",3,"AWAITING_PAYMENT",false);
    assert(ui.kind==UI_QR&&!promotion_visible()&&promotion_image_canceled(stale.serial));
    assert(host_audio==audio&&host_pickup_audio==pickup_audio);promotion_tests++;
    puts("production_playlist_daily_personal_daily_rotation_all_member_pixels_exact_event_ACK_retry_no_hidden_photo_ACK_busy_pickup_order_priority_clear_empty_stale_worker_occupancy_replay_reconnect_snapshot_future_expired_silent");
}
/* Counter contract uses the production parser/consumer and actual LVGL tree.
 * Outbound ACK-only and immutable journal guards exclude ordering/sign requests. */
static unsigned promo_widgets(lv_obj_t *root,const lv_obj_class_t *type) {
    unsigned count=lv_obj_check_type(root,type);
    for(unsigned i=0;i<lv_obj_get_child_count(root);i++)count+=promo_widgets(lv_obj_get_child(root,i),type);
    return count;
}
static void counter_card(const char *headline,const char *price,bool photo) {
    assert(ui.kind==UI_PROMOTION&&!ui.promotion_qr&&ui.promotion_photo==photo);
    assert(!strcmp(promotion.headline,headline));
    assert(find_label(lv_screen_active(),promotion_menu_name())&&find_label(lv_screen_active(),price)&&
        find_label(lv_screen_active(),"Order at the counter"));
    assert(!find_label(lv_screen_active(),"View menu")&&!find_label(lv_screen_active(),"Menu QR unavailable"));
    assert(!promo_widgets(lv_screen_active(),&lv_qrcode_class));
}
static void counter_ack_only(const table_durable_t *saved,unsigned writes,unsigned claims,unsigned audio,unsigned pickup_audio) {
    assert(host_writes==writes&&host_claims==claims&&host_audio==audio&&host_pickup_audio==pickup_audio);
    assert(!memcmp(saved,&table.saved,sizeof(*saved))&&!table.open_offer[0]&&!table.scoped_target[0]);
    for(unsigned i=0;i<host_sends;i++){
        cJSON *j=cJSON_Parse(host_sent[i]);assert(j);
        assert(!strcmp(cJSON_GetObjectItemCaseSensitive(j,"type")->valuestring,"ACK")&&
            cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j,"rendered"))&&
            cJSON_IsNull(cJSON_GetObjectItemCaseSensitive(j,"orderId")));
        cJSON_Delete(j);
    }
}
static void counter_parser_guards(void) {
    playlist_bootstrap_mode(true);promotion_playlist_t parsed;
    cJSON *p=playlist_payload(2,1,false,false,0,-1,300);
    assert(promotion_playlist_parse(&table,p,table.screen,&parsed)&&parsed.count==1&&
        !parsed.table_id[0]&&!parsed.occupancy&&!parsed.items[0].menu_url[0]&&!parsed.items[0].personal);
    cJSON_Delete(p);promotion_tests++;
    for(unsigned bad=0;bad<11;bad++){
        playlist_bootstrap_mode(true);p=playlist_payload(2,1,false,false,0,-1,300);
        cJSON *item=cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(p,"items"),0);
        switch(bad){
            case 0:cJSON_DeleteItemFromObjectCaseSensitive(item,"menuUrl");break;
            case 1:cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateString(""));break;
            case 2:cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateString("https://evil.invalid/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));break;
            case 3:cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateString("https://example.invalid/"));break;
            case 4:cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateString(table.payment_origin));break;
            case 5:cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateString("https://example.invalid/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));break;
            case 6:cJSON_ReplaceItemInObjectCaseSensitive(item,"audience",cJSON_CreateString("personal"));break;
            case 7:cJSON_ReplaceItemInObjectCaseSensitive(item,"audience",cJSON_CreateString("personal"));
                cJSON_ReplaceItemInObjectCaseSensitive(p,"occupancyGeneration",cJSON_CreateString("10"));break;
            case 8:cJSON_ReplaceItemInObjectCaseSensitive(p,"tableId",cJSON_CreateString(playlist_table));break;
            case 9:cJSON_ReplaceItemInObjectCaseSensitive(p,"occupancyGeneration",cJSON_CreateString("10"));break;
            case 10:strcpy(table.table_entry_url,"https://example.invalid/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");break;
        }
        assert(!promotion_playlist_parse(&table,p,table.screen,&parsed));
        playlist_reject(playlist_frame("PROMOTION_PLAYLIST",2,1,p));
    }
    for(unsigned personal=0;personal<2;personal++){
        playlist_bootstrap();p=playlist_payload(2,!personal,personal,false,personal?10:0,-1,300);
        assert(promotion_playlist_parse(&table,p,table.screen,&parsed)&&
            !strcmp(parsed.items[0].menu_url,table.table_entry_url)&&parsed.items[0].personal==(bool)personal);
        cJSON_Delete(p);promotion_tests++;
        for(unsigned bad=0;bad<4;bad++){
            playlist_bootstrap();p=playlist_payload(2,!personal,personal,false,personal?10:0,-1,300);
            cJSON *item=cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(p,"items"),0);
            if(bad==0)cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateNull());
            else if(bad==1)cJSON_DeleteItemFromObjectCaseSensitive(item,"menuUrl");
            else cJSON_ReplaceItemInObjectCaseSensitive(item,"menuUrl",cJSON_CreateString(bad==2?
                "https://example.invalid/table/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD":table.payment_origin));
            assert(!promotion_playlist_parse(&table,p,table.screen,&parsed));
            playlist_reject(playlist_frame("PROMOTION_PLAYLIST",2,1,p));
        }
    }
    playlist_bootstrap();table.table_entry_url[0]=0;
    p=playlist_payload(2,1,false,false,0,-1,300);
    assert(!promotion_playlist_parse(&table,p,table.screen,&parsed));
    playlist_reject(playlist_frame("PROMOTION_PLAYLIST",2,1,p));
    for(unsigned nullable=0;nullable<2;nullable++){
        promo_reset();table.table_id[0]=table.table_entry_url[0]=0;
        cJSON *j=promo_wire(1,promo_target,false,false,300);
        cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetObjectItemCaseSensitive(j,"payload"),"menuUrl",nullable?
            cJSON_CreateNull():cJSON_CreateString("https://example.invalid/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?offer=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"));
        promo_expect_rejected(j);
    }
    puts("production_counter_daily_explicit_null_only_missing_empty_external_root_table_URL_personal_occupancy_rejected_table_daily_personal_exact_nonnull_QR_legacy_offer_unchanged");
}
static void counter_behavior(void) {
    playlist_bootstrap_mode(true);clear_cache();
    unsigned writes=host_writes,claims=host_claims,audio=host_audio,pickup_audio=host_pickup_audio;
    table_durable_t saved=table.saved;
    cJSON *p=playlist_payload(2,2,false,true,0,-1,300);
    cJSON *second=cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(p,"items"),1);
    cJSON_ReplaceItemInObjectCaseSensitive(second,"discountPercent",cJSON_CreateNumber(40));
    cJSON_ReplaceItemInObjectCaseSensitive(second,"unitPrice",fixture_money(300,"USD"));
    cJSON *duplicate=cJSON_Duplicate(p,true);
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,p));
    counter_card("Daily 1","USD 4.00",false);assert(!playlist_acks());
    promo_run_worker();counter_card("Daily 1","USD 4.00",true);assert(!playlist_acks());
    assert(!memcmp(pixels+(100*480+40)*2,host_http_body+(48*280+28)*2,2));
    image("promotion-counter-real-product-photo");
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();
    counter_card("Daily 1","USD 4.00",true);assert(!playlist_acks());
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();
    counter_card("Daily 2","USD 3.00",false);assert(!playlist_acks());
    promo_run_worker();counter_card("Daily 2","USD 3.00",true);
    assert(playlist_acks()==1&&host_flush_at<host_ack_at&&strstr(host_sent[0],"72000000-0000-4000-8000-000000000002"));
    promo_receipt();counter_ack_only(&saved,writes,claims,audio,pickup_audio);promotion_tests++;
    unsigned sends=host_sends;
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,duplicate));
    lv_tick_inc(PROMOTION_DWELL_MS);promotion_render_tick();
    counter_card("Daily 1","USD 4.00",false);assert(host_sends==sends);
    promo_run_worker();counter_card("Daily 1","USD 4.00",true);assert(host_sends==sends);
    counter_ack_only(&saved,writes,claims,audio,pickup_audio);promotion_tests++;
    pointer_click(find_label(lv_screen_active(),"Order at the counter"));
    pointer_click(find_label(lv_screen_active(),"USD 4.00"));
    assert(ui.kind==UI_PROMOTION&&host_sends==sends);
    counter_ack_only(&saved,writes,claims,audio,pickup_audio);promotion_tests++;
    for(unsigned failure=0;failure<2;failure++){
        playlist_bootstrap_mode(true);saved=table.saved;writes=host_writes;
        if(failure)host_fail_render_acks=1;else host_fail_flushes=1;
        feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,false,false,0,-1,300)));
        counter_card("Daily 1","USD 4.00",false);assert(!playlist_acks());
        char request[37];strcpy(request,promotion_render_retry.request);
        lv_tick_inc(1000);promotion_render_tick();
        assert(playlist_acks()==1&&strstr(host_sent[0],request)&&host_flush_at<host_ack_at);
        promo_receipt();lv_tick_inc(1000);promotion_render_tick();assert(playlist_acks()==1);
        counter_ack_only(&saved,writes,claims,audio,pickup_audio);promotion_tests++;
    }
    playlist_bootstrap_mode(true);saved=table.saved;writes=host_writes;
    unsigned downloads=host_http_requests,cache_writes=host_sd_writes;
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(3,1,false,true,0,-1,300)));
    promo_run_worker();counter_card("Daily 1","USD 4.00",true);assert(playlist_acks()==1);
    assert(host_http_requests==downloads&&host_sd_writes==cache_writes);
    promo_receipt();counter_ack_only(&saved,writes,claims,audio,pickup_audio);promotion_tests++;
    playlist_bootstrap_mode(true);
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,false,false,0,-1,300)));promo_receipt();
    connected=false;table.synchronized=false;invalidate_promotion(false);
    assert(physical_render()&&ui.kind!=UI_PROMOTION);
    table.connection++;connected=true;table.synchronized=true;
    playlist_reject(playlist_frame("PROMOTION_PLAYLIST",3,1,playlist_payload(2,1,false,false,0,-1,300)));
    feed(playlist_frame("SNAPSHOT",4,1,playlist_payload(2,1,false,false,0,-1,300)));
    assert(!promotion_visible());playlist_sync();lv_tick_inc(1000);promotion_render_tick();
    counter_card("Daily 1","USD 4.00",false);assert(host_audio==audio&&host_pickup_audio==pickup_audio);promotion_tests++;
    playlist_bootstrap_mode(true);
    feed(playlist_frame("PROMOTION_PLAYLIST",2,1,playlist_payload(2,1,false,true,0,-1,300)));
    image_job_t stale;assert(xQueueReceive(jobs,&stale,0)==pdTRUE);
    order_event("ORDER",3,"AWAITING_PAYMENT",false);
    assert(ui.kind==UI_QR&&!promotion_visible()&&promotion_image_canceled(stale.serial));
    assert(host_audio==audio&&host_pickup_audio==pickup_audio);promotion_tests++;
    puts("production_counter_photo_headline_canonical_daily_prices_caption_no_QR_widgets_no_menu_button_pointer_no_order_sign_journal_sound_all_member_flushed_ACK_retry_dedup_cache_reconnect_order_priority");
}
static void precise_usd_guards(void) {
    table_money_t total,token;char shown[64];
    cJSON *j=cJSON_Parse("{\"currency\":\"USD\",\"decimals\":4,\"amountMinor\":\"850\"}");
    assert(table_money(j,&total,false));table_format_money(&total,shown,sizeof(shown));assert(!strcmp(shown,"USD 0.085"));cJSON_Delete(j);
    total=(table_money_t){"USD",2,9};table_format_money(&total,shown,sizeof(shown));assert(!strcmp(shown,"USD 0.09"));
    total=(table_money_t){"USD",4,850};token=(table_money_t){"USDG",6,85000};
    cJSON *settlement=cJSON_CreateObject();assert(table_settlement_matches(settlement,&total,&token));token.minor=8500000;assert(!table_settlement_matches(settlement,&total,&token));cJSON_Delete(settlement);
    puts("USD4_exact_0085_legacy_cents_and_settlement_scale_guards");
}
int main(int argc,char **argv) {
    precise_usd_guards();
    assert(argc==5);output=argv[1];host_cache_root=argv[1];char directory[1024];snprintf(directory,sizeof(directory),"%s/bitpos",host_cache_root);assert(mkdir(directory,0700)==0);
    uint8_t *photo=malloc(PROMOTION_BYTES);FILE *file=fopen(argv[3],"rb");assert(file&&photo&&fread(photo,1,PROMOTION_BYTES,file)==PROMOTION_BYTES&&fgetc(file)==EOF);fclose(file);host_http_body=photo;assert(strlen(argv[4])==64);strcpy(host_http_sha,argv[4]);assert(promotion_hash(photo,PROMOTION_BYTES,argv[4]));photo[0]^=1;assert(!promotion_hash(photo,PROMOTION_BYTES,argv[4]));photo[0]^=1;
    lv_init();lv_display_t *display=lv_display_create(480,320);lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);lv_display_set_buffers(display,pixels,NULL,sizeof(pixels),LV_DISPLAY_RENDER_MODE_FULL);lv_display_set_flush_cb(display,flush);
    touches=xQueueCreate(12,sizeof(touch_t));inbox=xQueueCreate(8,sizeof(message_t));socket_client=(void *)1;state_nvs=1;pointer=lv_indev_create();lv_indev_set_type(pointer,LV_INDEV_TYPE_POINTER);lv_indev_set_display(pointer,display);lv_indev_set_read_cb(pointer,pointer_read);lv_indev_add_event_cb(pointer,any_touch,LV_EVENT_PRESSED,NULL);restore_journal();ready();table.auth=1;
    send_capabilities();assert(!strstr(host_sent[0],"promotion_v1")&&!strstr(host_sent[0],"promotion_playlist_v1"));assert(bitpos_promotion_images_start());send_capabilities();assert(strstr(host_sent[1],"promotion_v1")&&strstr(host_sent[1],"promotion_playlist_v1"));table.auth=0;send_capabilities();assert(!strstr(host_sent[2],"promotion_v1")&&!strstr(host_sent[2],"promotion_playlist_v1"));promotion_tests+=3;
    bundle_parser_guards();promo_parser_guards();promo_behavior();promo_images();strcpy(host_http_sha,argv[4]);
    playlist_parser_guards();playlist_behavior();counter_parser_guards();counter_behavior();
    /* Hash/header corruption never emits financial effects. */
    assert(host_audio==0&&host_pickup_audio==0&&host_claims==0);printf("promotion_contract_cases=%u physical_TLS_SD_touch_acoustic_proof=false real_mbedTLS_SHA=true\n",promotion_tests);
    stop_scene();lv_deinit();free(photo);vQueueDelete(touches);vQueueDelete(inbox);vQueueDelete(jobs);(void)consumer;return 0;
}
