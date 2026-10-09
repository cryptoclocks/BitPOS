/* Included by main.c: single consumer owns domain state; LVGL callbacks enqueue only. */
_Static_assert(sizeof(table_state_t)+TABLE_JOURNAL_MAX<=32768,"Fixed ordering state plus journal exceeds 32KiB");
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
static bool send_bytes(size_t length) {
    if(!length||length>TABLE_SEND_MAX||!socket_client||!esp_websocket_client_is_connected(socket_client))return false;
    return esp_websocket_client_send_text(socket_client,outbound,length,pdMS_TO_TICKS(1000))==(int)length;
}
static size_t read_start(const char *type,char request[TABLE_UUID]) {
    request_id(request);
    int n=snprintf(outbound,sizeof(outbound),"{\"schemaVersion\":2,\"type\":\"%s\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",",type,request,table.connection);
    return n>0?(size_t)n:0;
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
    table_pending_t *p=&table.saved.pending;memset(p,0,sizeof(*p));p->kind=kind;request_id(p->request);
    strcpy(p->session,table.saved.session);p->cart=table.saved.cart;p->screen=table.screen;p->assignment=table.assignment;strcpy(p->price,table.price);
    if(kind==TC_OPEN){request_id(p->session);if(table.needs_resume)strcpy(p->recover,table.saved.session);}
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
    if(!strcmp(kind,"cart"))return table_cart(&table,screen);
    if(!strcmp(kind,"order")){
        order_t next={.snapshot=true,.screen=generation,.connection=table.connection};
        if(!parse_view(cJSON_GetObjectItemCaseSensitive(screen,"order"),&next))return false;
        apply_order(&next);return true;
    }
    if(strcmp(kind,"idle"))return false;
    table.screen=generation;table.cart_owner=false;table.observed_cart=false;table.order_owner=false;table.can_dismiss=false;table.quote_ready=false;
    memset(&current,0,sizeof(current));table.saved.locked_order[0]=0;
    table.needs_resume=false;table.view=0;page=0;presentation.paused=false;presentation.entry=false;presentation.photo=false;presentation.switched=lv_tick_get();return true;
}
static bool apply_value(cJSON *value) {
    cJSON *v=cJSON_GetObjectItemCaseSensitive(value,"screen");if(v&&!apply_screen(v))return false;
    v=cJSON_GetObjectItemCaseSensitive(value,"order");if(v){order_t next={.snapshot=true,.connection=table.connection,.screen=table.screen};if(!parse_view(v,&next))return false;apply_order(&next);}
    v=cJSON_GetObjectItemCaseSensitive(value,"catalog");if(v&&!table_catalog(&table,v))return false;
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
    if(pending){memset(&table.saved.pending,0,sizeof(table.saved.pending));if(!save_journal())return false;}
    return true;
}
static void handle_touch(touch_t touch) {
    if(touch.action==T_IDLE){if(display_engine_lock(2000)){idle_advance();display_engine_unlock();}return;}
    if(touch.generation!=atomic_load(&touch_generation))return;
    if(touch.action==T_VIEW&&!touch.index){pause_carousel();return;} /* Press must not delete the control before release. */
    pause_carousel();presentation.photo=false;presentation.switched=lv_tick_get();
    switch(touch.action) {
        case T_VIEW:
            if(!table.order_owner&&!table.saved.pending.kind){presentation.entry=true;table.view=0;}
            break;
        case T_MENU:if(display_engine_lock(2000)){if(touch.index)menu_render();else if(menu_shade){lv_obj_delete(menu_shade);menu_shade=NULL;}display_engine_unlock();}return;
        case T_SOUND:bitpos_audio_set_muted(!bitpos_audio_is_muted());break;
        case T_MOTION:reduced_motion=!reduced_motion;break;
        case T_NAV:
            if(touch.index==4&&!table.order_owner&&!table.saved.pending.kind&&table.synchronized){table.view=0;presentation.entry=false;presentation.paused=false;break;}
            if(table.order_owner){page=touch.index==2&&payable()?2:touch.index==1?1:3;}
            break;
        case T_DISMISS:if(table.order_owner&&table.can_dismiss)begin_command(TC_DISMISS);break;
        case T_CANCEL:if(table.order_owner&&current.can_cancel)begin_command(TC_CANCEL);break;
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
static void consume_v2(message_t *msg) {
    if(!table_json_bounded(msg->json,strlen(msg->json))){atomic_store(&resync,true);return;}
    cJSON *json=cJSON_ParseWithOpts(msg->json,NULL,true);bool event=false;char type[32];
    if(!json||!text(json,"type",type,sizeof(type))||!table_envelope(&table,json,table.device,&event)){cJSON_Delete(json);atomic_store(&resync,true);return;}
    bool ok=true,order_event=false,new_paid=false;order_t next={0};
    if(event) {
        cJSON *payload=cJSON_GetObjectItemCaseSensitive(json,"payload");
        if(!strcmp(type,"CONFIG")) {
            char pinned[ID_MAX];ok=(!merchant[0]||(text(payload,"merchantId",pinned,sizeof(pinned))&&!strcmp(pinned,merchant)))&&table_config(&table,payload);
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
        else if(!strcmp(type,"CATALOG"))ok=table_catalog(&table,payload);
        else ok=false;
        if(ok){table_integer(json,"deviceSeq",&table.seq);table_integer(json,"screenGeneration",&table.screen);}
    }else {
        char request[TABLE_UUID];uint64_t generation,assignment;
        ok=text(json,"requestId",request,sizeof(request))&&table_integer(json,"screenGeneration",&generation)&&
            table_integer(json,"assignmentGeneration",&assignment);
        cJSON *result=cJSON_GetObjectItemCaseSensitive(json,"result");
        if(ok&&assignment!=table.assignment){cJSON_Delete(json);atomic_store(&resync,true);return;}
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
    if(event&&(!strcmp(type,"CART")||!strcmp(type,"SNAPSHOT")))save_journal();
    bool rendered=physical_render();record_paid_flush(rendered);
    bool meaningful=!order_event||(ui.kind!=UI_OFFLINE&&(!strcmp(next.status,"PAID")?ui.kind==UI_PAID:true));
    bool acknowledged=event&&rendered&&meaningful&&send_event_ack(json,order_event?&next:NULL);
    if(event&&!strcmp(type,"CONFIG"))sync_session();
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
    cJSON_Delete(json);
}
static void consumer(void *arg) {
    (void)arg;restore_journal();physical_render();
    static message_t msg;
    for(;;) {
        atomic_store(&consuming,false);
        if(atomic_exchange(&resync,false)) {
            atomic_store(&consuming,true);
            xQueueReset(inbox);
            connected=false;table.online=false;table.synchronized=false;table.configured=false;table.resolving=true;table.quote_ready=false;
            table.read_request[0]=table.sync_request[0]=0;strcpy(table.notice,"Resynchronizing - retained draft");physical_render();
            if(socket_client){esp_websocket_client_stop(socket_client);esp_websocket_client_start(socket_client);}
        }
        if(xQueueReceive(inbox,&msg,pdMS_TO_TICKS(50))==pdTRUE) {
            atomic_store(&consuming,true);
            if(msg.kind){connected=false;table.online=false;table.synchronized=false;table.configured=false;table.quote_ready=false;physical_render();}
            else consume_v2(&msg);
            continue; /* Payment/ACK lane drains before page/touch/background work. */
        }
        atomic_store(&consuming,true);
        touch_t touch;while(xQueueReceive(touches,&touch,0)==pdTRUE)handle_touch(touch);
        uint32_t now=lv_tick_get();
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
