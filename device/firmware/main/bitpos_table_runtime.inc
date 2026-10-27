/* Included by main.c: single consumer owns domain state; LVGL callbacks enqueue only. */
_Static_assert(sizeof(table_state_t)+TABLE_JOURNAL_MAX<=32768,"Fixed ordering state plus journal exceeds 32KiB");
/* One volatile nonfinancial receipt, pinned to the original authenticated event.
 * Reconnect supplies a new silent event; BPT2 and guest ACK persistence are separate. */
static struct {
    pickup_t notice;
    char event[TABLE_UUID], request[TABLE_UUID];
    uint64_t seq, connection;
    uint32_t attempted_at;
    bool effect_done;
} pickup_render_retry;
_Static_assert(sizeof(pickup_render_retry)<=512,"Pickup render retry must remain bounded");
enum { PICKUP_RENDER_RETRY_MS=1000 };
/* Bounded nonfinancial receipt; original request survives failed flush/enqueue.
 * A new authenticated connection invalidates it; snapshot event is silent. */
static struct {
    char target[TABLE_UUID],campaign[TABLE_UUID],event[TABLE_UUID],request[TABLE_UUID];
    uint64_t seq,connection,screen,assignment,auth,generation;
    uint32_t attempted_at;
    unsigned rendered_items;
    bool canceled,acknowledged,playlist;
} promotion_render_retry;
static bool promotion_image_requested;
static void request_id(char out[TABLE_UUID]) {
    uint8_t b[16];esp_fill_random(b,sizeof(b));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    snprintf(out,TABLE_UUID,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
static bool save_journal(void) {
    size_t size=table_journal_encode(&table.saved,journal_sequence+1,journal_buffer,sizeof(journal_buffer));
    bool ok=size&&nvs_set_blob(ordering_nvs,(journal_sequence+1)&1?"slot_a":"slot_b",journal_buffer,size)==ESP_OK&&nvs_commit(ordering_nvs)==ESP_OK;
    table.storage_ok=ok;
    if(ok)journal_sequence++;else {table.quote_ready=false;strcpy(table.notice,"Storage failure - nothing sent");}
    return ok;
}
static void restore_journal(void) {
    table.storage_ok=nvs_open_from_partition("bitpos_nvs","ordering",NVS_READWRITE,&ordering_nvs)==ESP_OK;
    if(!table.storage_ok){strcpy(table.notice,"Storage unavailable");return;}
    bool found=false,invalid=false;
    for(unsigned slot=0;slot<2;slot++) {
        size_t size=sizeof(journal_buffer);esp_err_t err=nvs_get_blob(ordering_nvs,slot?"slot_b":"slot_a",journal_buffer,&size);
        if(err==ESP_ERR_NVS_NOT_FOUND)continue;
        table_durable_t candidate;uint64_t sequence;
        if(err!=ESP_OK||!table_journal_decode(journal_buffer,size,&candidate,&sequence)){invalid=true;continue;}
        if(!found||sequence>journal_sequence){table.saved=candidate;journal_sequence=sequence;found=true;}
    }
    if(invalid&&!found){table.storage_ok=false;strcpy(table.notice,"Journal corrupt - staff recovery");}
    table.needs_resume=table.saved.count>0||table.saved.paused_desired;table.resolving=table.saved.pending.kind!=TC_NONE;
}
/* Separate command metadata, not a financial journal format change. Persist the
 * exact optional token before BPT2/send so crash/reconnect replay never changes
 * a request's canonical bytes. Server remains the only eligibility authority. */
static bool save_promotion_open(void) {
    char record[160];
    int n=snprintf(record,sizeof(record),"{\"requestId\":\"%s\",\"offerToken\":\"%s\"}",table.open_offer_request,table.open_offer);
    return n>0&&nvs_set_blob(state_nvs,"promotion_open",record,(size_t)n+1)==ESP_OK&&nvs_commit(state_nvs)==ESP_OK;
}
static void restore_promotion_open(void) {
    if(table.saved.pending.kind!=TC_OPEN)return;
    char record[160],request[TABLE_UUID],offer[44];size_t length=sizeof(record);
    esp_err_t found=nvs_get_blob(state_nvs,"promotion_open",record,&length);
    if(found==ESP_ERR_NVS_NOT_FOUND)return; /* Historical BPT2 open had no offer. */
    bool valid=found==ESP_OK&&length&&length<=sizeof(record)&&!record[length-1]&&!memchr(record,0,length-1)&&table_json_bounded(record,length-1);
    cJSON *json=valid?cJSON_ParseWithOpts(record,NULL,true):NULL;
    valid=json&&text(json,"requestId",request,sizeof(request))&&table_uuid(request)&&text(json,"offerToken",offer,sizeof(offer));
    if(valid&&offer[0]){
        valid=strlen(offer)==43;
        for(unsigned i=0;valid&&i<43;i++)valid=isalnum((unsigned char)offer[i])||offer[i]=='-'||offer[i]=='_';
    }
    if(valid&&!strcmp(request,table.saved.pending.request)){strcpy(table.open_offer_request,request);strcpy(table.open_offer,offer);}
    else if(!valid){table.storage_ok=false;strcpy(table.notice,"Promotion command metadata corrupt");}
    cJSON_Delete(json);
}
static bool send_bytes(size_t length) {
    if(!length||length>TABLE_SEND_MAX||!socket_client||!esp_websocket_client_is_connected(socket_client))return false;
    return esp_websocket_client_send_text(socket_client,outbound,length,pdMS_TO_TICKS(1000))==(int)length;
}
static size_t read_start(const char *type,char request[TABLE_UUID]) {
    request_id(request);
    int n=snprintf(outbound,sizeof(outbound),"{\"schemaVersion\":2,\"type\":\"%s\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",",type,request,table.connection);
    return n>0?(size_t)n:0;
}
static void send_capabilities(void) {
    if(!table.configured)return;
    if(!capability_request[0])request_id(capability_request);
    int n=snprintf(outbound,sizeof(outbound),"{\"schemaVersion\":2,\"type\":\"CAPABILITIES\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",\"capabilities\":[\"pickup_ready_v1\"%s]}",capability_request,table.connection,
        table.auth&&promotion_images_supported()&&!strncmp(table.payment_origin,"https://",8)?",\"promotion_v1\",\"promotion_playlist_v1\",\"promotion_playlist_v2\",\"promotion_bundle_v1\"":"");
    capability_sent_at=lv_tick_get();if(n>0)send_bytes((size_t)n);
}
static bool save_pickup_ack(bool clear) {
    int n=clear?snprintf(outbound,sizeof(outbound),"{}"):
        snprintf(outbound,sizeof(outbound),"{\"requestId\":\"%s\",\"notificationId\":\"%s\",\"screenGeneration\":\"%" PRIu64 "\",\"assignmentGeneration\":\"%" PRIu64 "\"}",pickup_ack.request,pickup_ack.notification,pickup_ack.screen,pickup_ack.assignment);
    pickup_ack.storage_ok=n>0&&nvs_set_blob(state_nvs,"pickup_ack",outbound,(size_t)n+1)==ESP_OK&&nvs_commit(state_nvs)==ESP_OK;
    if(clear&&pickup_ack.storage_ok)pickup_ack.request[0]=pickup_ack.notification[0]=0;
    return pickup_ack.storage_ok;
}
static void restore_pickup_ack(void) {
    char wire[320];size_t length=sizeof(wire);
    esp_err_t found=nvs_get_blob(state_nvs,"pickup_ack",wire,&length);
    pickup_ack.storage_ok=found==ESP_ERR_NVS_NOT_FOUND;
    if(found!=ESP_OK)return;
    if(!length||length>sizeof(wire)||wire[length-1]||memchr(wire,0,length-1)||!table_json_bounded(wire,length-1))return;
    cJSON *j=cJSON_ParseWithOpts(wire,NULL,true);
    if(j&&cJSON_IsObject(j)){
        if(!cJSON_GetArraySize(j))pickup_ack.storage_ok=true;
        else pickup_ack.storage_ok=text(j,"requestId",pickup_ack.request,sizeof(pickup_ack.request))&&table_uuid(pickup_ack.request)&&
            text(j,"notificationId",pickup_ack.notification,sizeof(pickup_ack.notification))&&table_uuid(pickup_ack.notification)&&
            table_integer(j,"screenGeneration",&pickup_ack.screen)&&pickup_ack.screen&&
            table_integer(j,"assignmentGeneration",&pickup_ack.assignment)&&pickup_ack.assignment;
    }
    if(!pickup_ack.storage_ok)pickup_ack.request[0]=0;
    cJSON_Delete(j);
}
static void send_pickup_ack(void) {
    if(!connected||!table.configured||!table.synchronized||!pickup_ack.storage_ok||!pickup_ack.request[0])return;
    if(pickup_ack.assignment!=table.assignment){save_pickup_ack(true);return;}
    if(pickup_render_retry.event[0]&&!strcmp(pickup_render_retry.notice.notification,pickup_ack.notification))return;
    int n=snprintf(outbound,sizeof(outbound),"{\"schemaVersion\":2,\"type\":\"PICKUP_ACK\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",\"notificationId\":\"%s\",\"screenGeneration\":\"%" PRIu64 "\"}",pickup_ack.request,table.connection,pickup_ack.notification,pickup_ack.screen);
    pickup_ack.sent_at=lv_tick_get();if(n>0)send_bytes((size_t)n);
}
static void begin_pickup_ack(void) {
    if(!pickup_visible()||!pickup_ack.storage_ok||pickup_ack.request[0])return;
    request_id(pickup_ack.request);strcpy(pickup_ack.notification,pickup.notification);
    pickup_ack.screen=pickup.screen;pickup_ack.assignment=pickup.assignment;
    if(save_pickup_ack(false))send_pickup_ack();
}
static bool pickup_ack_result(cJSON *result) {
    cJSON *ok=cJSON_GetObjectItemCaseSensitive(result,"ok");
    if(!cJSON_IsBool(ok))return false;
    if(cJSON_IsTrue(ok)){
        if(!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(result,"value"),"acknowledged")))return false;
        if(!strcmp(pickup.notification,pickup_ack.notification)){pickup.active=false;bitpos_audio_set_pickup(false);}
    }else{
        cJSON *retryable=cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(result,"error"),"retryable");
        if(!cJSON_IsBool(retryable))return false;
        if(cJSON_IsTrue(retryable)){pickup_ack.sent_at=lv_tick_get();return true;}
    }
    return save_pickup_ack(true);
}
static void pickup_maintenance(void) {
    if(pickup.active&&(!pickup_idle()||!atomic_load(&clock_synced)||pickup.expires_ms<=wall_ms()||
       pickup.screen!=table.screen||pickup.assignment!=table.assignment)){
        pickup.active=false;presentation.photo=false;presentation.entry=false;
        presentation.paused=false;presentation.switched=lv_tick_get();bitpos_audio_set_pickup(false);
    }
    if(pickup_render_retry.event[0]&&
       (!connected||!table.configured||pickup_render_retry.connection!=table.connection||
        !pickup_idle()||!atomic_load(&clock_synced)||pickup_render_retry.notice.expires_ms<=wall_ms()||
        pickup_render_retry.notice.screen!=table.screen||pickup_render_retry.notice.assignment!=table.assignment||
        (!pickup_render_retry.notice.canceled&&(!pickup.active||
         strcmp(pickup.notification,pickup_render_retry.notice.notification)||
         strcmp(pickup.effect,pickup_render_retry.notice.effect)))))
        memset(&pickup_render_retry,0,sizeof(pickup_render_retry));
}
/* Preserve the generation high-water mark while dropping all presentation and
 * receipts. Only current snapshots reauthorize after disconnect or a changed
 * screen. Assignment/auth changes also require a newer playlist generation. */
static void invalidate_promotion(bool clear) {
    promotion.active=false;promotion_image_cancel();promotion_image_requested=false;
    memset(&promotion_render_retry,0,sizeof(promotion_render_retry));
    promotion_playlist.authorized=false;promotion_playlist.selected=-1;
    if(clear){promotion_playlist.value.count=0;promotion_playlist.requires_newer=true;}
}
static bool same_playlist_metadata(const promotion_playlist_t *a,const promotion_playlist_t *b) {
    if(a->generation!=b->generation||a->occupancy!=b->occupancy||a->assignment!=b->assignment||
       a->auth!=b->auth||strcmp(a->table_id,b->table_id)||a->count!=b->count)return false;
    for(unsigned i=0;i<a->count;i++){
        promotion_t item=b->items[i];item.screen=a->items[i].screen;
        if(memcmp(&a->items[i],&item,sizeof(item)))return false;
    }
    return true;
}
static bool install_promotion_playlist(const promotion_playlist_t *p,bool authority) {
    const promotion_playlist_t *old=&promotion_playlist.value;
    bool same_assignment=p->assignment==old->assignment&&!strcmp(p->table_id,old->table_id);
    if(same_assignment&&p->occupancy&&
       (p->occupancy<promotion_playlist.occupancy_floor||
        (promotion_playlist.occupancy_closed&&p->occupancy==promotion_playlist.occupancy_floor)))return false;
    if(p->generation<old->generation||
       (p->generation==old->generation&&promotion_playlist.requires_newer))return false;
    if(!authority&&(!promotion_playlist.authorized||promotion_playlist.connection!=table.connection||
       strcmp(p->table_id,old->table_id)||(p->occupancy&&old->occupancy&&p->occupancy<old->occupancy)))return false;
    if(p->generation==old->generation){
        if(!same_playlist_metadata(p,old))return false;
        if(!authority||(promotion_playlist.authorized&&promotion_playlist.connection==table.connection&&p->screen==old->screen))return true;
    }
    invalidate_promotion(false);promotion_playlist.value=*p;
    if(!same_assignment){promotion_playlist.occupancy_floor=0;promotion_playlist.occupancy_closed=false;}
    if(p->occupancy){promotion_playlist.occupancy_floor=p->occupancy;promotion_playlist.occupancy_closed=false;}
    else if(promotion_playlist.occupancy_floor)promotion_playlist.occupancy_closed=true;
    promotion_playlist.authorized=true;promotion_playlist.requires_newer=false;promotion_playlist.connection=table.connection;
    promotion_playlist.phase=promotion_playlist.daily_index=0;promotion_playlist.switched=lv_tick_get();
    return true;
}
static void promotion_maintenance(void) {
    int64_t now=wall_ms();
    bool context=table.configured&&promotion_playlist.connection==table.connection&&
        promotion_playlist.value.screen==table.screen&&promotion_playlist.value.assignment==table.assignment&&
        promotion_playlist.value.auth==table.auth;
    if(promotion_playlist.authorized&&!context)invalidate_promotion(false);
    if(promotion_playlist.authorized&&atomic_load(&clock_synced)){
        bool idle=pickup_idle()&&!pickup_visible();
        if(!idle)promotion_playlist.switched=lv_tick_get(); /* Busy time is not ad dwell time. */
        else if(lv_tick_get()-promotion_playlist.switched>=PROMOTION_DWELL_MS){
            promotion_playlist.phase=(promotion_playlist.phase+1)%3;
            if(promotion_playlist.phase!=1)promotion_playlist.daily_index++;
            promotion_playlist.switched=lv_tick_get();
        }
        int selected=promotion_playlist_select(&promotion_playlist.value,now,promotion_playlist.phase,promotion_playlist.daily_index);
        if(selected!=promotion_playlist.selected){
            promotion_image_cancel();promotion_image_requested=false;promotion_playlist.selected=selected;
            if(selected<0)promotion.active=false;else promotion=promotion_playlist.value.items[selected];
        }
    }
    bool valid=connected&&table.configured&&atomic_load(&clock_synced)&&
        promotion_item_current(&promotion,now)&&promotion.screen==table.screen&&
        promotion.assignment==table.assignment&&promotion.auth==table.auth;
    if(promotion.active&&!valid){promotion.active=false;promotion_image_cancel();promotion_image_requested=false;promotion_playlist.selected=-1;}
    if(promotion_render_retry.event[0]&&
       (promotion_render_retry.connection!=table.connection||promotion_render_retry.screen!=table.screen||
        promotion_render_retry.assignment!=table.assignment||promotion_render_retry.auth!=table.auth||
        (promotion_render_retry.playlist?(!promotion_playlist.authorized||
         promotion_render_retry.generation!=promotion_playlist.value.generation):(!valid&&!promotion_render_retry.canceled))))
        memset(&promotion_render_retry,0,sizeof(promotion_render_retry));
    if(promotion_render_retry.playlist&&promotion_render_retry.event[0]){
        for(unsigned i=0;i<promotion_playlist.value.count;i++)
            if(promotion_playlist.value.items[i].expires_ms<=now&&!(promotion_render_retry.rendered_items&(1u<<i))){
                memset(&promotion_render_retry,0,sizeof(promotion_render_retry));break;
            }
    }
    /* Priority cancellation is independent of the display lock. Reads poll the
     * cancel serial each 2KiB with a 1s socket deadline; never delay payment. */
    if(promotion_image_requested&&!promotion_visible()){promotion_image_cancel();promotion_image_requested=false;}
    if(promotion_visible()&&!promotion_image_requested){
        promotion_image_request(&promotion);promotion_image_requested=true;
    }
}
static void sync_session(void) {
    if(!table.configured||!table.storage_ok)return;
    size_t used=read_start("SESSION_SYNC",table.sync_request);
    table_pending_t *p=&table.saved.pending;
    int n=snprintf(outbound+used,sizeof(outbound)-used,"\"pendingRequestId\":%s%s%s,\"pendingSubmissionKey\":%s%s%s,\"sessionId\":%s%s%s}",
        p->kind?"\"":"",p->kind?p->request:"null",p->kind?"\"":"",p->kind==TC_SUBMIT?"\"":"",p->kind==TC_SUBMIT?p->key:"null",p->kind==TC_SUBMIT?"\"":"",
        table.saved.session[0]?"\"":"",table.saved.session[0]?table.saved.session:"null",table.saved.session[0]?"\"":"");
    table.resolving=true;table.synchronized=false;table.read_started=lv_tick_get();
    if(n>0)send_bytes(used+(size_t)n);
}
static void get_catalog(unsigned index,bool reset) {
    if(!connected||table.read_request[0])return;
    size_t used=read_start("CATALOG_PAGE",table.read_request);
    int n=snprintf(outbound+used,sizeof(outbound)-used,"\"menuVersion\":%s%s%s,\"pageIndex\":%u}",reset?"":"\"",reset?"null":table.menu,reset?"":"\"",index);
    table.read_started=lv_tick_get();if(n>0&&!send_bytes(used+(size_t)n))table.read_request[0]=0;
}
static void get_quote_page(void) {
    if(!connected||table.read_request[0]||!table.quote_loading||table.loaded_pages>=table.review_pages)return;
    size_t used=read_start("QUOTE_PAGE",table.read_request);
    int n=snprintf(outbound+used,sizeof(outbound)-used,"\"quoteId\":\"%s\",\"pageIndex\":%u}",table.quote,table.loaded_pages);
    table.read_started=lv_tick_get();if(n>0&&!send_bytes(used+(size_t)n))table.read_request[0]=0;
}
static void send_pending(void) {
    if(!table.saved.pending.kind||!table.storage_ok)return;
    table.pending_started=lv_tick_get();
    if(!send_bytes(table_command_json(&table,outbound,sizeof(outbound)))){table.resolving=true;connected=false;}
}
static bool begin_command(table_command_t kind) {
    if(!connected||!table.synchronized||table.resolving||!table.storage_ok||table.saved.pending.kind)return false;
    bool claim_offer=kind==TC_OPEN&&promotion_visible()&&promotion.offer[0]&&!table.needs_resume;
    table_pending_t *p=&table.saved.pending;memset(p,0,sizeof(*p));p->kind=kind;request_id(p->request);
    strcpy(p->session,table.saved.session);p->cart=table.saved.cart;p->screen=table.screen;p->assignment=table.assignment;strcpy(p->price,table.price);
    if(kind==TC_OPEN){request_id(p->session);if(table.needs_resume)strcpy(p->recover,table.saved.session);}
    if(claim_offer){
        strcpy(table.open_offer,promotion.offer);strcpy(table.open_offer_request,p->request);
        strcpy(table.scoped_target,promotion.target);strcpy(table.scoped_campaign,promotion.campaign);
        strcpy(table.scoped_product,promotion.product);table.scoped_version=0;
    }else if(kind==TC_OPEN){table.open_offer[0]=0;strcpy(table.open_offer_request,p->request);}
    if(kind==TC_OPEN&&!save_promotion_open()){
        memset(p,0,sizeof(*p));table.open_offer[0]=table.open_offer_request[0]=0;
        strcpy(table.notice,"Storage failure - nothing sent");return false;
    }
    if(kind==TC_SUBMIT){strcpy(p->quote,table.quote);strcpy(p->price,table.quote_price);request_id(p->key);}
    if(kind==TC_DISMISS||kind==TC_CANCEL){strcpy(p->order,current.order);p->order_version=current.version;}
    table.quote_ready=false;
    if(!save_journal())return false;
    send_pending();return true;
}
static bool quote_fresh(void) {
    return atomic_load(&clock_synced)&&table.quote_until_ms>wall_ms();
}
static void copy_alias(const table_row_t *r) {
    unsigned i=0;for(;i<table.cart_label_count;i++)if(!strcmp(table.cart_labels[i].product,r->product))break;
    if(i==50)return;
    if(i==table.cart_label_count)table.cart_label_count++;
    strcpy(table.cart_labels[i].product,r->product);strcpy(table.cart_labels[i].name,r->name);table.cart_labels[i].unit=r->unit;
}
static void apply_order(const order_t *next) {
    bool same=!strcmp(current.order,next->order);
    if(same&&(next->version<current.version||(next->version==current.version&&strcmp(next->status,current.status))))return;
    preempt_order(same);
    if(!same||strcmp(next->quote,table.quote)) {
        strcpy(table.quote,next->quote);table.total=next->total;table.review_count=next->line_count;table.review_pages=next->page_count;
        table.loaded_pages=0;table.quote_loading=next->quote[0]!=0;table.scroll=0;table.quote_price[0]=0;
    }
    table.order_owner=true;table.cart_owner=false;table.observed_cart=false;table.can_dismiss=next->can_dismiss;table.quote_ready=false;table.screen=next->screen;
    if(!strcmp(next->status,"CONFIRMING")&&(!same||strcmp(current.status,"CONFIRMING")))confirming_started=lv_tick_get();
    current=*next;strcpy(table.saved.locked_order,next->order);
    page=(!strcmp(next->status,"AWAITING_WALLET")||!strcmp(next->status,"AWAITING_PAYMENT"))?2:3;
}
static bool apply_screen(cJSON *screen) {
    char kind[16];uint64_t generation;
    if(!text(screen,"kind",kind,sizeof(kind))||!table_integer(screen,"screenGeneration",&generation)||generation<table.screen)return false;
    if(!strcmp(kind,"cart")){
        bool ok=table_cart(&table,screen);
        if(ok){pickup.active=false;bitpos_audio_set_pickup(false);}
        return ok;
    }
    if(!strcmp(kind,"order")){
        order_t next={.snapshot=true,.screen=generation,.connection=table.connection};
        if(!parse_view(cJSON_GetObjectItemCaseSensitive(screen,"order"),&next))return false;
        apply_order(&next);return true;
    }
    if(strcmp(kind,"idle"))return false;
    table.screen=generation;table.cart_owner=false;table.observed_cart=false;table.order_owner=false;table.can_dismiss=false;table.quote_ready=false;
    if(table.catalog_session[0])table.menu_until_ms=0;
    table.catalog_session[0]=table.scoped_target[0]=table.scoped_campaign[0]=table.scoped_product[0]=0;table.scoped_version=0;
    memset(&current,0,sizeof(current));table.saved.locked_order[0]=0;
    table.needs_resume=false;table.view=0;page=0;presentation.paused=false;presentation.entry=false;presentation.photo=false;presentation.switched=lv_tick_get();return true;
}
static bool apply_catalog(cJSON *catalog) {
    if(!table_catalog(&table,catalog))return false;
    for(unsigned i=0;i<table.rows_count;i++)if(table.rows[i].scoped_promotion||table.rows[i].daily_promotion){
        if(!atomic_load(&clock_synced)||wall_ms()<table.menu_generated_ms||wall_ms()>=table.menu_until_ms)return false;
    }
    return true;
}
static bool apply_value(cJSON *value) {
    cJSON *v=cJSON_GetObjectItemCaseSensitive(value,"screen");if(v&&!apply_screen(v))return false;
    v=cJSON_GetObjectItemCaseSensitive(value,"order");if(v){order_t next={.snapshot=true,.connection=table.connection,.screen=table.screen};if(!parse_view(v,&next))return false;apply_order(&next);}
    v=cJSON_GetObjectItemCaseSensitive(value,"catalog");if(v&&!apply_catalog(v))return false;
    v=cJSON_GetObjectItemCaseSensitive(value,"quote");if(v&&!table_quote(&table,v))return false;
    v=cJSON_GetObjectItemCaseSensitive(value,"page");if(v&&!table_quote_page(&table,v))return false;
    if(!table.quote_loading&&table.loaded_pages==table.review_pages)for(unsigned i=0;i<table.review_count;i++)copy_alias(&table.review[i]);
    return true;
}
static bool command_result(cJSON *result,table_command_t pending,bool resolved) {
    cJSON *ok=cJSON_GetObjectItemCaseSensitive(result,"ok");if(!cJSON_IsBool(ok))return false;
    if(cJSON_IsTrue(ok)) {
        /* During sync the current screen is authoritative; old receipts cannot restore displaced ownership. */
        if(!resolved&&!apply_value(cJSON_GetObjectItemCaseSensitive(result,"value")))return false;
        if(pending==TC_SUBMIT&&(!table.cart_owner||!strcmp(table.saved.session,table.saved.pending.session))){
            table.saved.count=table.saved.desired_count=0;table.saved.paused_desired=false;table.saved.session[0]=0;table.needs_resume=false;}
        if(pending==TC_SET){
            if(resolved&&!table.cart_owner&&!strcmp(table.saved.session,table.saved.pending.session)){
                table.saved.count=table.saved.desired_count;memcpy(table.saved.acknowledged,table.saved.desired,table.saved.count*sizeof(table_item_t));}
            table.saved.paused_desired=false;table.needs_resume=!table.cart_owner&&table.saved.count>0;}
        if(pending==TC_RELEASE&&(!table.cart_owner||!strcmp(table.saved.session,table.saved.pending.session))){
            table.saved.count=table.saved.desired_count=0;table.saved.paused_desired=false;table.saved.session[0]=0;table.needs_resume=false;
            if(!table.order_owner)table.view=0;}
        table.notice[0]=0;
    }else {
        cJSON *error=cJSON_GetObjectItemCaseSensitive(result,"error");
        if(!text(error,"code",table.notice,sizeof(table.notice)))return false;
        table.quote_ready=false;table.quote_loading=false;table.view=table.order_owner?0:2;
        if(!strcmp(table.notice,"LEASE_EXPIRED")){table.cart_owner=false;table.needs_resume=table.saved.count>0;}
        if(pending==TC_OPEN||pending==TC_SET){table.saved.paused_desired=true;table.needs_resume=true;}
    }
    if(pending){memset(&table.saved.pending,0,sizeof(table.saved.pending));table.open_offer[0]=table.open_offer_request[0]=0;if(!save_journal())return false;}
    return true;
}
static void handle_touch(touch_t touch) {
    if(touch.action==T_IDLE){if(display_engine_lock(2000)){idle_advance();display_engine_unlock();}return;}
    if(touch.generation!=atomic_load(&touch_generation))return;
    if(pickup.active&&touch.action==T_VIEW)return;
    if(touch.action==T_VIEW&&!touch.index){pause_carousel();return;} /* Press must not delete the control before release. */
    pause_carousel();presentation.photo=false;presentation.switched=lv_tick_get();
    switch(touch.action) {
        case T_VIEW:
            if(!table.order_owner&&!table.saved.pending.kind){presentation.entry=true;table.view=0;}
            break;
        case T_MENU:if(display_engine_lock(2000)){if(touch.index)menu_render();else if(menu_shade){lv_obj_delete(menu_shade);menu_shade=NULL;}display_engine_unlock();}return;
        case T_DEVICE_STATUS:if(display_engine_lock(2000)){device_status_render();display_engine_unlock();}return;
        case T_SOUND:bitpos_audio_set_muted(!bitpos_audio_is_muted());break;
        case T_MOTION:reduced_motion=!reduced_motion;break;
        case T_NAV:
            if(touch.index==4&&!table.order_owner&&!table.saved.pending.kind&&table.synchronized){table.view=0;presentation.entry=false;presentation.paused=false;break;}
            if(table.order_owner){page=touch.index==2&&payable()?2:touch.index==1?1:3;}
            break;
        case T_DISMISS:if(table.order_owner&&table.can_dismiss)begin_command(TC_DISMISS);break;
        case T_CANCEL:if(table.order_owner&&current.can_cancel)begin_command(TC_CANCEL);break;
        case T_PICKUP_ACK:begin_pickup_ack();break;
        case T_PROMOTION_MENU:
            if(promotion_visible()&&begin_command(TC_OPEN)){presentation.entry=true;promotion_image_cancel();promotion_image_requested=false;}
            break;
        default:break;
    }
    physical_render();
}
static bool send_event_ack(cJSON *json,const order_t *order) {
    char event[TABLE_UUID],request[TABLE_UUID];uint64_t seq,screen;
    if(!text(json,"eventId",event,sizeof(event))||!table_integer(json,"deviceSeq",&seq)||!table_integer(json,"screenGeneration",&screen))return false;
    request_id(request);
    if(order&&!strcmp(order->status,"PAID")&&!table.can_dismiss)strcpy(table.ack_request,request);
    int n=snprintf(outbound,sizeof(outbound),"{\"schemaVersion\":2,\"type\":\"ACK\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",\"eventId\":\"%s\",\"deviceSeq\":\"%" PRIu64 "\",\"screenGeneration\":\"%" PRIu64 "\",\"orderId\":%s%s%s,\"orderVersion\":",request,table.connection,event,seq,screen,order?"\"":"",order?order->order:"null",order?"\"":"");
    if(n<=0)return false;
    size_t used=(size_t)n;
    n=order?snprintf(outbound+used,sizeof(outbound)-used,"%lu,\"rendered\":true}",(unsigned long)order->version):
        snprintf(outbound+used,sizeof(outbound)-used,"null,\"rendered\":true}");
    bool ok=n>0&&send_bytes(used+(size_t)n);
    if(ok&&order&&log_id(event)&&log_id(order->order))ESP_LOGI("BitPOS","BITPOS_RENDER_ACK event=%s order=%s version=%lu status=%s flush_ms=%lu",event,order->order,(unsigned long)order->version,order->status,(unsigned long)last_flush_ms);
    return ok;
}
static void heartbeat(void) {
    if(!table.configured)return;
    size_t used=read_start("HEARTBEAT",table.heartbeat_request);
    int n=snprintf(outbound+used,sizeof(outbound)-used,"\"sessionId\":null}");
    if(n>0)send_bytes(used+(size_t)n);
    table.heartbeat_at=lv_tick_get();
}
static bool retain_pickup_render(cJSON *json,const pickup_t *notice) {
    char event[TABLE_UUID];uint64_t seq;
    if(!text(json,"eventId",event,sizeof(event))||!table_integer(json,"deviceSeq",&seq))return false;
    if(pickup_render_retry.event[0]&&!strcmp(pickup_render_retry.event,event)&&
       pickup_render_retry.seq==seq&&pickup_render_retry.connection==table.connection)return true;
    memset(&pickup_render_retry,0,sizeof(pickup_render_retry));
    pickup_render_retry.notice=*notice;strcpy(pickup_render_retry.event,event);
    pickup_render_retry.seq=seq;pickup_render_retry.connection=table.connection;
    request_id(pickup_render_retry.request);pickup_render_retry.attempted_at=lv_tick_get();
    return true;
}
static bool finish_pickup_render(bool rendered) {
    pickup_maintenance();
    if(!pickup_render_retry.event[0]||!rendered||
       (pickup_render_retry.notice.canceled?ui.kind==UI_PICKUP:ui.kind!=UI_PICKUP))return false;
    int n=snprintf(outbound,sizeof(outbound),
        "{\"schemaVersion\":2,\"type\":\"ACK\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",\"eventId\":\"%s\",\"deviceSeq\":\"%" PRIu64 "\",\"screenGeneration\":\"%" PRIu64 "\",\"orderId\":null,\"orderVersion\":null,\"rendered\":true}",
        pickup_render_retry.request,pickup_render_retry.connection,pickup_render_retry.event,
        pickup_render_retry.seq,pickup_render_retry.notice.screen);
    if(n<=0||!send_bytes((size_t)n))return false;
    if(!pickup_render_retry.notice.canceled&&!pickup_render_retry.effect_done){
        bool claimed=claim_pickup(&pickup_render_retry.notice);
        pickup_render_retry.effect_done=true;bitpos_audio_set_pickup(true);
        if(claimed&&pickup_render_retry.notice.sound)bitpos_audio_play_pickup(pickup_render_retry.notice.effect);
    }
    return true;
}
/* Used by the real consumer idle lane and host transport adapter: no server replay. */
static void pickup_render_tick(void) {
    pickup_maintenance();
    if(!pickup_render_retry.event[0]||!table.synchronized||
       lv_tick_get()-pickup_render_retry.attempted_at<PICKUP_RENDER_RETRY_MS)return;
    pickup_render_retry.attempted_at=lv_tick_get();
    finish_pickup_render(physical_render());
}
static bool pickup_render_result(cJSON *result) {
    cJSON *ok=cJSON_GetObjectItemCaseSensitive(result,"ok");
    if(!cJSON_IsBool(ok))return false;
    if(cJSON_IsTrue(ok)){
        if(!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(result,"value"),"acknowledged")))return false;
    }else{
        cJSON *retryable=cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(result,"error"),"retryable");
        if(!cJSON_IsBool(retryable))return false;
        if(cJSON_IsTrue(retryable)){pickup_render_retry.attempted_at=lv_tick_get();return true;}
    }
    memset(&pickup_render_retry,0,sizeof(pickup_render_retry));
    send_pickup_ack();return true;
}
static bool retain_promotion_render(cJSON *json,const promotion_t *notice) {
    char event[TABLE_UUID];uint64_t seq;
    if(!text(json,"eventId",event,sizeof(event))||!table_integer(json,"deviceSeq",&seq))return false;
    if(promotion_render_retry.event[0]&&!strcmp(promotion_render_retry.event,event)&&
       promotion_render_retry.seq==seq&&promotion_render_retry.connection==table.connection)return true;
    memset(&promotion_render_retry,0,sizeof(promotion_render_retry));
    strcpy(promotion_render_retry.target,notice->target);strcpy(promotion_render_retry.campaign,notice->campaign);
    strcpy(promotion_render_retry.event,event);request_id(promotion_render_retry.request);
    promotion_render_retry.seq=seq;promotion_render_retry.connection=table.connection;
    promotion_render_retry.screen=notice->screen;promotion_render_retry.assignment=notice->assignment;
    promotion_render_retry.auth=notice->auth;promotion_render_retry.canceled=notice->canceled;
    promotion_render_retry.attempted_at=lv_tick_get();return true;
}
static bool retain_playlist_render(cJSON *json) {
    promotion_t owner={.screen=promotion_playlist.value.screen,.assignment=table.assignment,.auth=table.auth};
    if(!retain_promotion_render(json,&owner))return false;
    promotion_render_retry.playlist=true;promotion_render_retry.generation=promotion_playlist.value.generation;
    return true;
}
static bool finish_promotion_render(bool rendered) {
    promotion_maintenance();
    if(!promotion_render_retry.event[0]||promotion_render_retry.acknowledged||!rendered||!pickup_idle()||pickup_visible())return false;
    bool meaningful;
    if(promotion_render_retry.playlist){
        const promotion_playlist_t *p=&promotion_playlist.value;
        if(ui.kind==UI_PROMOTION&&
           (ui.promotion_qr||(!promotion.table_id[0]&&!promotion.personal&&!promotion.menu_url[0]))&&
           promotion_visible()&&ui.promotion_generation==p->generation){
            for(unsigned i=0;i<p->count;i++)if(!strcmp(ui.promotion_target,p->items[i].target)&&
               promotion_item_current(&p->items[i],wall_ms())&&(!p->items[i].has_image||ui.promotion_photo))
                promotion_render_retry.rendered_items|=1u<<i;
        }
        unsigned required=(1u<<p->count)-1;
        /* Every member must actually flush. Future starts wait; a member that
         * expires before rendering invalidates this receipt, never counts. */
        meaningful=p->count?(promotion_render_retry.rendered_items&&
            (promotion_render_retry.rendered_items&required)==required):
            ui.kind!=UI_PROMOTION;
    }else meaningful=promotion_render_retry.canceled?ui.kind!=UI_PROMOTION:
        ui.kind==UI_PROMOTION&&ui.promotion_qr&&promotion_visible()&&
        !strcmp(ui.promotion_target,promotion_render_retry.target)&&!strcmp(promotion.campaign,promotion_render_retry.campaign);
    if(!meaningful)return false;
    int n=snprintf(outbound,sizeof(outbound),
        "{\"schemaVersion\":2,\"type\":\"ACK\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",\"eventId\":\"%s\",\"deviceSeq\":\"%" PRIu64 "\",\"screenGeneration\":\"%" PRIu64 "\",\"orderId\":null,\"orderVersion\":null,\"rendered\":true}",
        promotion_render_retry.request,promotion_render_retry.connection,promotion_render_retry.event,
        promotion_render_retry.seq,promotion_render_retry.screen);
    return n>0&&send_bytes((size_t)n);
}
static bool promotion_render_result(cJSON *result) {
    cJSON *ok=cJSON_GetObjectItemCaseSensitive(result,"ok");
    if(!cJSON_IsBool(ok))return false;
    if(cJSON_IsTrue(ok)){
        if(!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(result,"value"),"acknowledged")))return false;
        promotion_render_retry.acknowledged=true;
    }else {
        cJSON *retry=cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(result,"error"),"retryable");
        if(!cJSON_IsBool(retry))return false;
        if(cJSON_IsTrue(retry))promotion_render_retry.attempted_at=lv_tick_get();
        else memset(&promotion_render_retry,0,sizeof(promotion_render_retry));
    }
    return true;
}
static void promotion_render_tick(void) {
    bool active=promotion.active;int selected=promotion_playlist.selected;promotion_maintenance();
    unsigned revision=promotion_image_revision();
    bool changed=revision!=promotion_revision;promotion_revision=revision;
    bool retry=promotion_render_retry.event[0]&&!promotion_render_retry.acknowledged&&
        lv_tick_get()-promotion_render_retry.attempted_at>=PICKUP_RENDER_RETRY_MS;
    if((active&&!promotion.active)||selected!=promotion_playlist.selected||(promotion_visible()&&(changed||retry))||
       (retry&&(promotion_render_retry.canceled||(promotion_render_retry.playlist&&!promotion_playlist.value.count))&&pickup_idle()&&!pickup_visible())){
        if(retry)promotion_render_retry.attempted_at=lv_tick_get();
        finish_promotion_render(physical_render());
    }
}
static void consume_v2(message_t *msg) {
    if(!table_json_bounded(msg->json,strlen(msg->json))){atomic_store(&resync,true);return;}
    cJSON *json=cJSON_ParseWithOpts(msg->json,NULL,true);bool event=false;char type[32];
    uint64_t old_screen=table.screen,old_connection=table.connection,old_assignment=table.assignment,old_auth=table.auth;
    if(!json||!text(json,"type",type,sizeof(type))||!table_envelope(&table,json,table.device,&event)){cJSON_Delete(json);atomic_store(&resync,true);return;}
    bool ok=true,order_event=false,new_paid=false,pickup_event=false,pickup_render=false,promotion_event=false,promotion_render=false,playlist_event=false,playlist_attached=false;
    order_t next={0};pickup_t notice={0};promotion_t offer={0};
    static promotion_playlist_t incoming; /* One bounded parse scratch, never a second active playlist. */
    if(event) {
        cJSON *payload=cJSON_GetObjectItemCaseSensitive(json,"payload");
        if(!strcmp(type,"CONFIG")) {
            uint64_t old_assignment=table.assignment;
            char pinned[ID_MAX];ok=(!merchant[0]||(text(payload,"merchantId",pinned,sizeof(pinned))&&!strcmp(pinned,merchant)))&&table_config(&table,payload);
            if(ok){
                capability_request[0]=0;
                if(!table.synchronized||old_assignment!=table.assignment){pickup.active=false;promotion.active=false;promotion_image_cancel();promotion_image_requested=false;bitpos_audio_set_pickup(false);}
            }
        }else if(!strcmp(type,"SNAPSHOT")) {
            ok=apply_screen(cJSON_GetObjectItemCaseSensitive(payload,"screen"));table.synchronized=false;
            if(current.order[0]){ok=ok&&parse(json,&next);order_event=ok;}
            if(ok)connected=true; /* Read-only snapshot; edits still require SESSION_SYNC. */
        }else if(!strcmp(type,"ORDER")) {
            ok=parse(json,&next);order_event=ok;
            if(ok){
                if(!strcmp(next.order,current.order)&&(next.version<current.version||
                   (next.version==current.version&&strcmp(next.status,current.status)))){cJSON_Delete(json);return;}
                new_paid=connected&&table.synchronized&&!next.snapshot&&next.sound&&next.effect[0]&&!strcmp(next.status,"PAID");
                apply_order(&next);
            }
        }else if(!strcmp(type,"CART"))ok=apply_screen(payload);
        else if(!strcmp(type,"PICKUP_READY")){
            pickup_event=true;ok=parse_pickup(json,&notice);
            if(ok&&notice.canceled){
                if(!strcmp(pickup.notification,notice.notification)){pickup.active=false;bitpos_audio_set_pickup(false);}
                pickup_render=true; /* Cancellation is rendered as the restored scene. */
            }else if(ok&&pickup_idle()&&atomic_load(&clock_synced)&&notice.expires_ms>wall_ms()&&
                     (!pickup.active||!strcmp(pickup.notification,notice.notification))){
                bitpos_audio_set_pickup(false);pickup=notice;
                presentation.photo=false;presentation.entry=false;pickup_render=true;
            }
        }
        else if(!strcmp(type,"PROMOTION_PLAYLIST")){
            playlist_event=true;ok=promotion_images_supported()&&promotion_playlist_event(&table,json,&incoming)&&
                install_promotion_playlist(&incoming,false);
        }
        else if(!strcmp(type,"PROMOTION")){
            promotion_event=true;ok=promotion_images_supported()&&promotion_parse(&table,json,&offer);
            if(ok&&promotion_playlist.value.generation){table_integer(json,"deviceSeq",&table.seq);cJSON_Delete(json);return;}
            if(ok&&offer.canceled){
                /* Tombstones never clear an unrelated target or a financial scene. */
                if(!strcmp(promotion.target,offer.target)&&!strcmp(promotion.campaign,offer.campaign)){
                    promotion.active=false;promotion_image_cancel();promotion_image_requested=false;
                    promotion_render=pickup_idle()&&!pickup_visible();
                }
            }else if(ok&&atomic_load(&clock_synced)&&offer.expires_ms>wall_ms()){
                bool same=promotion.active&&!strcmp(promotion.target,offer.target)&&!strcmp(promotion.sha256,offer.sha256);
                promotion=offer;if(!same){promotion_image_cancel();promotion_image_requested=false;}
                promotion_render=promotion_visible();
            }
        }
        else if(!strcmp(type,"CATALOG"))ok=apply_catalog(payload);
        else ok=false;
        if(ok){
            uint64_t frame_screen;table_integer(json,"screenGeneration",&frame_screen);
            if(table.assignment!=old_assignment||table.auth!=old_auth)invalidate_promotion(true);
            else if(frame_screen!=old_screen)invalidate_promotion(false);
            else if(table.connection!=old_connection)invalidate_promotion(false);
            table_integer(json,"deviceSeq",&table.seq);table.screen=frame_screen;
            if(!strcmp(type,"CONFIG")||!strcmp(type,"SNAPSHOT")||!strcmp(type,"CART")){
                cJSON *value=cJSON_GetObjectItemCaseSensitive(payload,"promotionPlaylist");
                bool authority=strcmp(type,"CART")!=0||
                    (promotion_playlist.connection==table.connection&&promotion_playlist.value.generation);
                if(value){
                    ok=promotion_images_supported()&&promotion_playlist_parse(&table,value,frame_screen,&incoming)&&
                        install_promotion_playlist(&incoming,authority);
                    playlist_attached=ok&&!order_event;
                }else if(authority&&promotion_playlist.connection!=table.connection)invalidate_promotion(false);
                if(!value&&!strcmp(type,"CART")){
                    char kind[16];
                    if(text(payload,"kind",kind,sizeof(kind))&&!strcmp(kind,"idle"))invalidate_promotion(true);
                }
            }
        }
    }else {
        char request[TABLE_UUID];uint64_t generation,assignment;
        ok=text(json,"requestId",request,sizeof(request))&&table_integer(json,"screenGeneration",&generation)&&
            table_integer(json,"assignmentGeneration",&assignment);
        cJSON *result=cJSON_GetObjectItemCaseSensitive(json,"result");
        if(ok&&assignment!=table.assignment){cJSON_Delete(json);atomic_store(&resync,true);return;}
        pickup_maintenance();
        promotion_maintenance();
        if(ok&&promotion_render_retry.request[0]&&!strcmp(request,promotion_render_retry.request)){
            ok=generation==promotion_render_retry.screen&&promotion_render_result(result);
            if(!ok)atomic_store(&resync,true);
            cJSON_Delete(json);return;
        }
        if(ok&&pickup_render_retry.request[0]&&!strcmp(request,pickup_render_retry.request)){
            ok=generation==pickup_render_retry.notice.screen&&pickup_render_result(result);
            if(ok)physical_render();else atomic_store(&resync,true);
            cJSON_Delete(json);return;
        }
        if(ok&&pickup_ack.request[0]&&!strcmp(request,pickup_ack.request)){
            ok=pickup_ack_result(result);
            if(ok){pickup_maintenance();physical_render();}
            else atomic_store(&resync,true);
            cJSON_Delete(json);return;
        }
        if(ok&&capability_request[0]&&!strcmp(request,capability_request)){
            ok=cJSON_IsBool(cJSON_GetObjectItemCaseSensitive(result,"ok"));
            if(ok)capability_request[0]=0;else atomic_store(&resync,true);
            cJSON_Delete(json);return;
        }
        if(ok&&!strcmp(request,table.sync_request)) {
            cJSON *success=cJSON_GetObjectItemCaseSensitive(result,"ok"),*value=cJSON_GetObjectItemCaseSensitive(result,"value");
            ok=cJSON_IsTrue(success)&&apply_screen(cJSON_GetObjectItemCaseSensitive(value,"screen"));
            cJSON *pending=cJSON_GetObjectItemCaseSensitive(value,"pendingResult"),*order=cJSON_GetObjectItemCaseSensitive(value,"pendingOrder");
            table_command_t prior=table.saved.pending.kind;
            if(ok&&!cJSON_IsNull(order)&&order){
                order_t resolved={.snapshot=true,.screen=table.screen,.connection=table.connection};ok=parse_view(order,&resolved);
                if(ok){
                    /* Pending outcome resolves the key, not authority to replace
                     * the independently reconstructed current screen owner. */
                    if(table.order_owner&&!strcmp(current.order,resolved.order))apply_order(&resolved);
                    if(prior==TC_SUBMIT&&(!table.cart_owner||!strcmp(table.saved.session,table.saved.pending.session))){
                        table.saved.count=table.saved.desired_count=0;table.saved.paused_desired=false;table.saved.session[0]=0;table.needs_resume=false;}
                    memset(&table.saved.pending,0,sizeof(table.saved.pending));
                }
            }
            else if(ok&&table.saved.pending.kind&&!cJSON_IsNull(pending)&&pending)ok=command_result(pending,table.saved.pending.kind,true);
            table.sync_request[0]=0;
            if(ok){
                table.synchronized=true;table.resolving=false;connected=true;table.online=true;
                /* A correlated server idle + reconciled pending outcome is the only
                 * safe cutover point for obsolete unsubmitted local cart contents. */
                if(!table.order_owner&&!table.observed_cart&&!table.saved.pending.kind){
                    memset(&table.saved,0,sizeof(table.saved));table.saved.assignment=table.assignment;table.saved.screen=table.screen;
                    table.needs_resume=false;table.view=0;
                }
                ok=save_journal();if(ok&&table.saved.pending.kind)send_pending();
            }
        }else if(ok&&table.saved.pending.kind&&!strcmp(request,table.saved.pending.request)) {
            table_command_t kind=table.saved.pending.kind;
            if(generation<table.screen){sync_session();}
            else {table.screen=generation;ok=command_result(result,kind,false);table.resolving=false;
                if(ok&&!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(result,"ok"))&&!table.order_owner)sync_session();}
        }else if(ok&&!strcmp(request,table.read_request)) {
            table.read_request[0]=0;
            if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(result,"ok")))ok=apply_value(cJSON_GetObjectItemCaseSensitive(result,"value"));
            else {cJSON *error=cJSON_GetObjectItemCaseSensitive(result,"error");ok=text(error,"code",table.notice,sizeof(table.notice));table.quote_ready=false;table.quote_loading=false;if(!strcmp(table.notice,"MENU_CHANGED")){table.menu[0]=0;get_catalog(0,true);}}
        }else if(ok&&!strcmp(request,table.ack_request)) {
            table.ack_request[0]=0;
            if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(result,"ok"))&&table.order_owner&&!table.can_dismiss)sync_session();
        }else if(ok&&!strcmp(request,table.heartbeat_request)) {
            table.heartbeat_request[0]=0;
            if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(result,"ok"))&&!table.saved.pending.kind){
                ok=apply_value(cJSON_GetObjectItemCaseSensitive(result,"value"));
                if(ok&&table.cart_owner)save_journal();
            }
        }else {cJSON_Delete(json);return;} /* Uncorrelated replies never change readiness or ownership. */
    }
    if(!ok){cJSON_Delete(json);atomic_store(&resync,true);return;}
    if(playlist_event||playlist_attached){
        promotion_maintenance();
        if(!retain_playlist_render(json)){cJSON_Delete(json);atomic_store(&resync,true);return;}
        finish_promotion_render(physical_render());
        if(!strcmp(type,"CONFIG")){send_capabilities();sync_session();}
        else if(!strcmp(type,"SNAPSHOT")&&!table.sync_request[0])sync_session();
        if(!strcmp(type,"CART")||!strcmp(type,"SNAPSHOT"))save_journal();
        cJSON_Delete(json);return;
    }
    if(promotion_event){
        bool matching=!strcmp(promotion.target,offer.target)&&!strcmp(promotion.campaign,offer.campaign);
        promotion_maintenance();
        if(matching&&(offer.canceled||promotion.active)){
            if(!retain_promotion_render(json,&offer)){cJSON_Delete(json);atomic_store(&resync,true);return;}
            if(promotion_render)finish_promotion_render(physical_render());
        }
        cJSON_Delete(json);return; /* Never ACK a payment/cart/pickup as a promotion. */
    }
    if(pickup_event&&!pickup_render){
        bool active=pickup.active;pickup_maintenance();
        if(active&&!pickup.active)physical_render();
        cJSON_Delete(json);return; /* Busy/expired notices never ACK a financial scene. */
    }
    if(event&&(!strcmp(type,"CART")||!strcmp(type,"SNAPSHOT")))save_journal();
    pickup_maintenance();
    promotion_maintenance();
    /* Only this notice's restored scene may replace a pending ready receipt. */
    bool retry_pickup=pickup_event&&(!notice.canceled||!pickup.active);
    if(retry_pickup&&!retain_pickup_render(json,&notice)){cJSON_Delete(json);atomic_store(&resync,true);return;}
    bool rendered=physical_render();record_paid_flush(rendered);
    bool meaningful=pickup_event?(pickup_render&&(notice.canceled||ui.kind==UI_PICKUP)):
        !order_event||(ui.kind!=UI_OFFLINE&&(!strcmp(next.status,"PAID")?ui.kind==UI_PAID:true));
    bool acknowledged=retry_pickup?finish_pickup_render(rendered&&meaningful):
        event&&rendered&&meaningful&&send_event_ack(json,order_event?&next:NULL);
    if(event&&!strcmp(type,"CONFIG")){send_capabilities();sync_session();}
    else if(event&&!strcmp(type,"SNAPSHOT")&&!table.sync_request[0])sync_session();
    if(order_event&&rendered&&meaningful) {
        bool claimed=(acknowledged||next.snapshot||!next.sound)&&claim_paid(&next);
        if(acknowledged&&new_paid&&claimed) {
            if(display_engine_lock(2000)) {
                if(ui.kind==UI_PAID&&!reduced_motion){ui.motion_timer=lv_timer_create(motion_tick,40,NULL);if(ui.motion_timer){ui.celebrating=true;ui.paid_started=lv_tick_get();paid_frame(0);}}
                display_engine_unlock();
            }
            if(next.sound)bitpos_audio_play_success(next.order,next.version);
        }
    }
    if(!order_event&&rendered&&!strcmp(current.status,"PAID")&&ui.kind==UI_PAID)claim_paid(&current);
    if(table.synchronized&&pickup_ack.request[0]&&lv_tick_get()-pickup_ack.sent_at>=5000)send_pickup_ack();
    cJSON_Delete(json);
}
static void consumer(void *arg) {
    (void)arg;restore_journal();restore_promotion_open();restore_pickup_ack();physical_render();
    message_t *msg=consumer_message;
    for(;;) {
        atomic_store(&consuming,false);
        if(atomic_exchange(&resync,false)) {
            atomic_store(&consuming,true);
            xQueueReset(inbox);
            connected=false;table.online=false;table.synchronized=false;table.configured=false;table.resolving=true;table.quote_ready=false;
            pickup.active=false;capability_request[0]=0;bitpos_audio_set_pickup(false);
            memset(&pickup_render_retry,0,sizeof(pickup_render_retry));
            invalidate_promotion(false);
            table.read_request[0]=table.sync_request[0]=0;strcpy(table.notice,"Resynchronizing - retained draft");physical_render();
            if(socket_client){esp_websocket_client_stop(socket_client);esp_websocket_client_start(socket_client);}
        }
        if(xQueueReceive(inbox,msg,pdMS_TO_TICKS(50))==pdTRUE) {
            atomic_store(&consuming,true);
            if(msg->kind){connected=false;table.online=false;table.synchronized=false;table.configured=false;table.quote_ready=false;
                invalidate_promotion(false);
                pickup.active=false;capability_request[0]=0;memset(&pickup_render_retry,0,sizeof(pickup_render_retry));bitpos_audio_set_pickup(false);physical_render();}
            else consume_v2(msg);
            continue; /* Payment/ACK lane drains before page/touch/background work. */
        }
        atomic_store(&consuming,true);
        touch_t touch;while(xQueueReceive(touches,&touch,0)==pdTRUE)handle_touch(touch);
        uint32_t now=lv_tick_get();
        bool was_pickup=pickup.active;pickup_maintenance();
        if(was_pickup&&!pickup.active)physical_render();
        pickup_render_tick();
        promotion_render_tick();
        if(table.configured&&capability_request[0]&&now-capability_sent_at>=5000)send_capabilities();
        if(pickup_ack.request[0]&&now-pickup_ack.sent_at>=5000)send_pickup_ack();
        if(table.quote_ready&&!quote_fresh()){table.quote_ready=false;strcpy(table.notice,"Quote expired - Review again");physical_render();}
        if(table.configured&&now-table.heartbeat_at>=30000)heartbeat();
        if(table.configured&&!table.synchronized&&!table.sync_request[0])sync_session();
        if(table.sync_request[0]&&now-table.read_started>5000)atomic_store(&resync,true);
        if(table.saved.pending.kind&&connected&&now-table.pending_started>5000){sync_session();physical_render();}
        if(table.read_request[0]&&now-table.read_started>5000){table.read_request[0]=0;strcpy(table.notice,"Page timeout - Retry");}
        get_quote_page();
        if(connected&&table.view==1&&!table.saved.pending.kind&&!table.read_request[0]&&wall_ms()>=table.menu_until_ms)get_catalog(0,true);
        if(connected&&!table.cart_owner&&!table.order_owner&&!table.saved.pending.kind&&!table.view&&!table.needs_resume&&table.price[0]&&!table.read_request[0]) {
            if(!table.menu[0]||wall_ms()>=table.menu_until_ms)get_catalog(0,true);
            else if(table.menu_advance){table.menu_advance=false;get_catalog((table.menu_page+1)%table.menu_pages,false);}
        }
        idle_gif_prepare(); /* Last, optional RAM-only work; inbox preempts it. */
    }
}
