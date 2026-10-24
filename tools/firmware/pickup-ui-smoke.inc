/* Real consumer/LVGL behavioral coverage; explicit host NVS/network/transfer adapters. */
static cJSON *pickup_fixture(const char *notification,const char *effect,bool sound,bool canceled,int ttl) {
    cJSON *j=cJSON_CreateObject();char value[32];
    cJSON_AddNumberToObject(j,"schemaVersion",2);cJSON_AddStringToObject(j,"type","PICKUP_READY");
    cJSON_AddStringToObject(j,"eventId",fixture_quote);cJSON_AddStringToObject(j,"deviceId",fixture_device);
    snprintf(value,sizeof(value),"%" PRIu64,table.seq+1);cJSON_AddStringToObject(j,"deviceSeq",value);
    snprintf(value,sizeof(value),"%" PRIu64,table.connection);cJSON_AddStringToObject(j,"connectionGeneration",value);
    snprintf(value,sizeof(value),"%" PRIu64,table.screen);cJSON_AddStringToObject(j,"screenGeneration",value);
    snprintf(value,sizeof(value),"%" PRIu64,table.assignment);cJSON_AddStringToObject(j,"assignmentGeneration",value);
    cJSON_AddStringToObject(j,"occurredAt","2026-10-12T00:00:00.000Z");
    cJSON *p=cJSON_AddObjectToObject(j,"payload");
    cJSON_AddStringToObject(p,"notificationId",notification);cJSON_AddStringToObject(p,"orderId",fixture_order);
    cJSON_AddStringToObject(p,"pickupCode","A012");cJSON_AddStringToObject(p,"effectId",effect);
    time_t future=time(NULL)+ttl;struct tm utc;gmtime_r(&future,&utc);char expires[32];
    strftime(expires,sizeof(expires),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_AddStringToObject(p,"expiresAt",expires);
    cJSON_AddBoolToObject(p,"sound",sound);cJSON_AddStringToObject(p,"state",canceled?"CANCELED":"READY");return j;
}
static void pickup_notice(const char *effect,bool sound){feed(pickup_fixture(fixture_quote,effect,sound,false,300));}
static void pickup_cancel(void){feed(pickup_fixture(fixture_quote,"pickup-cancel",false,true,300));}
static cJSON *idle_value(void){cJSON *v=cJSON_CreateObject(),*s=cJSON_AddObjectToObject(v,"screen");char value[32];snprintf(value,sizeof(value),"%" PRIu64,table.screen);cJSON_AddStringToObject(s,"kind","idle");cJSON_AddStringToObject(s,"screenGeneration",value);return v;}
static void pickup_config(void) {
    cJSON *j=pickup_fixture(fixture_quote,"pickup-config",false,false,300);
    char connection[32];snprintf(connection,sizeof(connection),"%" PRIu64,table.connection+1);
    cJSON_ReplaceItemInObjectCaseSensitive(j,"connectionGeneration",cJSON_CreateString(connection));
    cJSON_ReplaceItemInObjectCaseSensitive(j,"type",cJSON_CreateString("CONFIG"));
    cJSON *p=cJSON_CreateObject();cJSON_ReplaceItemInObjectCaseSensitive(j,"payload",p);
    cJSON_AddStringToObject(p,"deviceId",fixture_device);cJSON_AddStringToObject(p,"assignmentGeneration","1");
    cJSON_AddStringToObject(p,"label","Host pickup fixture");cJSON_AddNullToObject(p,"tableLabel");cJSON_AddNullToObject(p,"pairingGeneration");
    cJSON_AddBoolToObject(p,"pricingReady",true);cJSON_AddStringToObject(p,"priceVersion","fixture-price");
    cJSON_AddStringToObject(p,"paymentOrigin","https://example.invalid");cJSON_AddNullToObject(p,"tableEntryUrl");
    cJSON *caps=cJSON_AddArrayToObject(p,"capabilities");cJSON_AddItemToArray(caps,cJSON_CreateString("pickup_ready_v1"));feed(j);
}
static void pickup_error(const char *request,bool retryable) {
    cJSON *j=pickup_fixture(fixture_quote,"unused",false,false,300);
    cJSON_ReplaceItemInObjectCaseSensitive(j,"type",cJSON_CreateString("COMMAND_RESULT"));
    cJSON_AddStringToObject(j,"requestId",request);cJSON_DeleteItemFromObjectCaseSensitive(j,"payload");
    cJSON *r=cJSON_AddObjectToObject(j,"result");cJSON_AddBoolToObject(r,"ok",false);
    cJSON *e=cJSON_AddObjectToObject(r,"error");cJSON_AddStringToObject(e,"code",retryable?"INTERNAL_ERROR":"INVALID_REQUEST");
    cJSON_AddBoolToObject(e,"retryable",retryable);feed(j);
}
static void pickup_render_success(void) {
    char request[TABLE_UUID];strcpy(request,pickup_render_retry.request);
    assert(request[0]);cJSON *v=cJSON_CreateObject();cJSON_AddBoolToObject(v,"acknowledged",true);
    char screen[32];snprintf(screen,sizeof(screen),"%" PRIu64,table.screen);reply(request,v,screen);
    assert(!pickup_render_retry.event[0]);
}
static void original_pickup_ack(unsigned index,uint64_t seq,uint64_t connection) {
    cJSON *ack=cJSON_Parse(host_sent[index]);assert(ack);
    assert(!strcmp(cJSON_GetObjectItem(ack,"type")->valuestring,"ACK")&&
           !strcmp(cJSON_GetObjectItem(ack,"eventId")->valuestring,fixture_quote));
    assert(strtoull(cJSON_GetObjectItem(ack,"deviceSeq")->valuestring,NULL,10)==seq&&
           strtoull(cJSON_GetObjectItem(ack,"connectionGeneration")->valuestring,NULL,10)==connection&&
           strtoull(cJSON_GetObjectItem(ack,"screenGeneration")->valuestring,NULL,10)==table.screen);
    assert(cJSON_IsTrue(cJSON_GetObjectItem(ack,"rendered"))&&
           cJSON_IsNull(cJSON_GetObjectItem(ack,"orderId"))&&cJSON_IsNull(cJSON_GetObjectItem(ack,"orderVersion")));
    assert(host_ack_at>host_flush_at);cJSON_Delete(ack);
}
static void pickup_behavior(void) {
    table_state_t retained=table;order_t order=current;unsigned financial_audio=host_audio;
    ready();restore_pickup_ack();assert(pickup_ack.storage_ok);
    unsigned sends=host_sends;pickup_config();assert(!table.synchronized&&host_sends==sends+3);
    cJSON *cap=cJSON_Parse(host_sent[sends+1]);assert(cap);
    assert(!strcmp(cJSON_GetObjectItem(cap,"type")->valuestring,"CAPABILITIES"));
    cJSON *caps=cJSON_GetObjectItem(cap,"capabilities");assert(cJSON_GetArraySize(caps)==1&&!strcmp(cJSON_GetArrayItem(caps,0)->valuestring,"pickup_ready_v1"));
    assert(!strcmp(cJSON_GetObjectItem(cap,"connectionGeneration")->valuestring,"6"));cJSON_Delete(cap);
    char request[37];strcpy(request,capability_request);cJSON *v=cJSON_CreateObject();cJSON_AddBoolToObject(v,"acknowledged",true);reply(request,v,"1");assert(!capability_request[0]);
    strcpy(request,table.sync_request);v=idle_value();cJSON_AddNullToObject(v,"pendingOrder");cJSON_AddNullToObject(v,"pendingResult");reply(request,v,"1");assert(table.synchronized);
    puts("pickup_capability_negotiated_after_CONFIG_correlated_result_without_promotion_claim");

    table_durable_t financial=table.saved;uint8_t slots[2][4096];memcpy(slots,host_slots,sizeof(slots));
    unsigned audio=host_pickup_audio,claims=host_claims;host_transfer=false;sends=host_sends;
    uint64_t original_seq=table.seq+1,connection=table.connection;
    pickup_notice("pickup-first",true);assert(host_sends==sends&&host_claims==claims&&host_pickup_audio==audio);
    host_transfer=true;lv_tick_inc(PICKUP_RENDER_RETRY_MS-1);pickup_render_tick();assert(host_sends==sends);
    lv_tick_inc(1);pickup_render_tick();assert(host_sends==sends+1&&table.seq==original_seq&&table.connection==connection);
    assert(ui.kind==UI_PICKUP&&host_pickup_audio==audio+1&&host_claims==claims+1);
    original_pickup_ack(sends,original_seq,connection);
    assert(find_label(ui.body,"Order #A012")&&find_label(ui.body,"Ready for pickup")&&find_label(ui.body,"Please collect at the counter")&&find_label(ui.body,"Got it"));
    assert(!host_attract_active&&!current.order[0]&&!table.order_owner);
    /* Result loss retries the original event AND request, not another server event. */
    lv_tick_inc(PICKUP_RENDER_RETRY_MS);pickup_render_tick();assert(host_sends==sends+2);
    assert(!strcmp(host_sent[sends],host_sent[sends+1])&&host_pickup_audio==audio+1&&host_claims==claims+1);
    pickup_render_success();sends=host_sends;lv_tick_inc(5000);pickup_render_tick();assert(host_sends==sends);
    assert(!memcmp(&financial,&table.saved,sizeof(financial))&&!memcmp(slots,host_slots,sizeof(slots)));
    image("pickup-ready-cup-check");
    puts("pickup_fail_first_flush_real_consumer_idle_retry_original_event_same_connection_no_early_ACK_bounded_cadence_one_effect_financial_unchanged");

    sends=host_sends;feed(pickup_fixture(fixture_device,"pickup-other",true,false,300));
    assert(host_sends==sends&&pickup.active&&!strcmp(pickup.notification,fixture_quote)&&host_pickup_audio==audio+1);
    feed(pickup_fixture(fixture_device,"pickup-other",false,true,300));assert(pickup.active);
    cJSON *catalog=pickup_fixture(fixture_quote,"pickup-catalog",false,false,300);
    cJSON_ReplaceItemInObjectCaseSensitive(catalog,"type",cJSON_CreateString("CATALOG"));
    cJSON *p=cJSON_CreateObject();cJSON_AddNullToObject(p,"priceVersion");cJSON_AddArrayToObject(p,"products");cJSON_ReplaceItemInObjectCaseSensitive(catalog,"payload",p);feed(catalog);
    lv_tick_inc(30000);idle_advance();assert(ui.kind==UI_PICKUP&&pickup.active&&!presentation.photo);
    puts("pickup_one_active_notice_catalog_carousel_and_unrelated_cancel_cannot_replace_it");

    financial=table.saved;memcpy(slots,host_slots,sizeof(slots));
    click("Got it");assert(pickup_ack.request[0]&&pickup.active&&ui.kind==UI_PICKUP);
    assert(!memcmp(&financial,&table.saved,sizeof(financial))&&!memcmp(slots,host_slots,sizeof(slots)));
    assert(strstr(host_sent[host_sends-1],"\"type\":\"PICKUP_ACK\"")&&!strstr(host_sent[host_sends-1],"orderId"));
    strcpy(request,pickup_ack.request);char first[7169];strcpy(first,host_sent[host_sends-1]);
    memset(&pickup_ack,0,sizeof(pickup_ack));restore_pickup_ack();assert(pickup_ack.storage_ok&&!strcmp(request,pickup_ack.request));
    table.connection++;send_pickup_ack();cJSON *a=cJSON_Parse(first),*b=cJSON_Parse(host_sent[host_sends-1]);
    cJSON_DeleteItemFromObjectCaseSensitive(a,"connectionGeneration");cJSON_DeleteItemFromObjectCaseSensitive(b,"connectionGeneration");assert(cJSON_Compare(a,b,true));cJSON_Delete(a);cJSON_Delete(b);
    v=cJSON_CreateObject();cJSON_AddBoolToObject(v,"acknowledged",true);reply(request,v,"1");assert(!pickup_ack.request[0]&&!pickup.active&&ui.kind==UI_IDLE);
    memset(&pickup_ack,0,sizeof(pickup_ack));restore_pickup_ack();assert(pickup_ack.storage_ok&&!pickup_ack.request[0]);
    assert(!memcmp(&financial,&table.saved,sizeof(financial))&&!memcmp(slots,host_slots,sizeof(slots)));
    puts("pickup_Got_it_real_pointer_durable_before_send_same_request_reboot_reconnect_retry_correlated_success_restores_idle_not_collection");
    /* First ACK enqueue fails while authentication/socket remain live. A Got it
     * press is persisted, but cannot reach the server before the render receipt. */
    sends=host_sends;audio=host_pickup_audio;claims=host_claims;host_fail_render_acks=1;
    original_seq=table.seq+1;connection=table.connection;pickup_notice("pickup-enqueue-first",true);
    assert(host_sends==sends&&host_render_ack_failures==1&&host_network&&host_pickup_audio==audio&&host_claims==claims);
    click("Got it");assert(pickup_ack.request[0]&&host_sends==sends);
    lv_tick_inc(PICKUP_RENDER_RETRY_MS-1);pickup_render_tick();assert(host_sends==sends);
    lv_tick_inc(1);pickup_render_tick();assert(host_sends==sends+1&&table.seq==original_seq&&table.connection==connection);
    original_pickup_ack(sends,original_seq,connection);
    assert(host_pickup_audio==audio+1&&host_claims==claims+1);
    strcpy(request,pickup_ack.request);pickup_render_success();
    assert(host_sends==sends+2&&strstr(host_sent[host_sends-1],"\"type\":\"PICKUP_ACK\"")&&strstr(host_sent[host_sends-1],request));
    v=cJSON_CreateObject();cJSON_AddBoolToObject(v,"acknowledged",true);reply(request,v,"1");
    assert(!pickup.active&&!pickup_ack.request[0]&&ui.kind==UI_IDLE);
    lv_tick_inc(5000);pickup_render_tick();assert(host_sends==sends+2&&host_pickup_audio==audio+1&&host_claims==claims+1);
    assert(!memcmp(&financial,&table.saved,sizeof(financial))&&!memcmp(slots,host_slots,sizeof(slots)));
    puts("pickup_fail_first_ACK_enqueue_original_event_retry_then_correlated_render_result_releases_durable_Got_it_once_no_financial_mutation");

    pickup_notice("pickup-silent-reconnect",false);claims=host_claims;audio=host_pickup_audio;
    ready();pickup_notice("pickup-silent-reconnect",true);assert(host_claims==claims&&host_pickup_audio==audio);
    pickup_cancel();assert(!pickup.active&&!host_pickup_active&&ui.kind==UI_IDLE);
    pickup_notice("pickup-ACK-retry-result",false);pickup_render_success();click("Got it");strcpy(request,pickup_ack.request);
    pickup_error(request,true);assert(!strcmp(request,pickup_ack.request)&&pickup.active);
    sends=host_sends;lv_tick_inc(5000);send_pickup_ack();assert(host_sends==sends+1&&strstr(host_sent[host_sends-1],request));
    v=cJSON_CreateObject();cJSON_AddBoolToObject(v,"acknowledged",true);reply(fixture_device,v,"1");
    assert(!strcmp(request,pickup_ack.request)&&pickup.active);
    pickup_error(request,false);assert(!pickup_ack.request[0]&&pickup.active);pickup_cancel();
    pickup_notice("pickup-ACK-assignment-change",false);pickup_render_success();click("Got it");table.assignment++;sends=host_sends;
    send_pickup_ack();assert(host_sends==sends&&!pickup_ack.request[0]);pickup_maintenance();table.assignment=1;
    puts("pickup_ACK_retryable_error_keeps_same_request_uncorrelated_success_ignored_terminal_error_and_reassignment_clear_only_nonfinancial_record");
    cJSON *crash=pickup_fixture(fixture_quote,"pickup-crash-consumed",true,false,300);pickup_t notice={0};assert(parse_pickup(crash,&notice)&&claim_pickup(&notice));cJSON_Delete(crash);
    ready();pickup_notice("pickup-crash-consumed",true);assert(host_pickup_audio==audio);pickup_cancel();
    host_storage=false;pickup_notice("pickup-storage-failed",true);assert(ui.kind==UI_PICKUP&&host_pickup_audio==audio);host_storage=true;pickup_cancel();
    puts("pickup_silent_reconnect_durable_dedup_and_crash_after_claim_before_audio_suppress_replay_storage_failure_silent");

    pickup_notice("pickup-expiry",false);pickup.expires_ms=wall_ms()-1;pickup_maintenance();assert(physical_render()&&!pickup.active&&ui.kind==UI_IDLE&&!host_pickup_active);
    sends=host_sends;feed(pickup_fixture(fixture_quote,"pickup-already-expired",true,false,-1));assert(!pickup.active&&host_sends==sends);
    atomic_store(&clock_synced,false);pickup_notice("pickup-unsynced",true);assert(!pickup.active&&host_sends==sends);atomic_store(&clock_synced,true);
    pickup_notice("pickup-reassignment",false);table.assignment++;pickup_maintenance();assert(physical_render()&&!pickup.active&&ui.kind==UI_IDLE);table.assignment=1;
    pickup_notice("pickup-screen-fence",false);table.screen++;pickup_maintenance();assert(physical_render()&&!pickup.active&&ui.kind==UI_IDLE);ready();
    puts("pickup_expired_unsynced_clock_changed_assignment_and_changed_screen_restore_idle_without_audio_or_false_ready_ACK");
    /* A failed initial flush must never send a stale receipt after displacement. */
    for(unsigned fence=0;fence<5;fence++){
        ready();sends=host_sends;claims=host_claims;audio=host_pickup_audio;host_transfer=false;
        pickup_notice("pickup-retry-displaced",true);host_transfer=true;
        if(fence==0)pickup.expires_ms=wall_ms()-1;
        else if(fence==1)table.assignment++;
        else if(fence==2)table.screen++;
        else if(fence==3)preempt_order(false);
        else table.connection++;
        lv_tick_inc(PICKUP_RENDER_RETRY_MS);pickup_render_tick();
        assert(!pickup_render_retry.event[0]&&host_sends==sends&&host_claims==claims&&host_pickup_audio==audio);
    }
    ready();host_transfer=false;pickup_notice("pickup-cancel-retry",true);host_transfer=true;pickup_cancel();
    assert(!pickup.active&&!strcmp(pickup_render_retry.notice.effect,"pickup-cancel"));
    pickup_render_success();sends=host_sends;lv_tick_inc(PICKUP_RENDER_RETRY_MS);pickup_render_tick();assert(host_sends==sends);
    puts("pickup_failed_flush_retry_expiry_assignment_screen_payment_connection_and_cancellation_fences_clear_original_receipt_without_effect");

    pickup_notice("pickup-cart-preemption",false);v=cart_screen(fixture_quote,1,0);assert(apply_screen(v));cJSON_Delete(v);assert(physical_render()&&!pickup.active&&!host_pickup_active&&ui.kind==UI_ENTRY);
    sends=host_sends;pickup_notice("pickup-busy-cart",true);assert(host_sends==sends&&!pickup.active);ready();
    pickup_notice("pickup-payment-preemption",false);order_event("ORDER",(unsigned)table.seq+1,"AWAITING_PAYMENT",false);assert(!pickup.active&&!host_pickup_active&&ui.kind==UI_QR&&table.order_owner);
    sends=host_sends;pickup_notice("pickup-busy-payment",true);assert(host_sends==sends&&ui.kind==UI_QR&&!pickup.active);ready();
    table.saved.pending.kind=TC_SUBMIT;strcpy(table.saved.pending.request,fixture_quote);strcpy(table.saved.pending.key,fixture_order);assert(save_journal());financial=table.saved;
    sends=host_sends;pickup_notice("pickup-financial-pending",true);assert(host_sends==sends&&!pickup.active&&!memcmp(&financial,&table.saved,sizeof(financial)));
    puts("pickup_phone_cart_and_payment_preempt_pending_financial_journal_never_overwritten");

    ready();pickup_notice("pickup-failed-touch-save",false);sends=host_sends;host_storage=false;click("Got it");assert(host_sends==sends&&!pickup_ack.storage_ok&&pickup.active);host_storage=true;
    assert(save_pickup_ack(true));pickup_cancel();assert(host_audio==financial_audio);
    table=retained;current=order;pickup.active=false;bitpos_audio_set_pickup(false);assert(save_journal());assert(physical_render());
    puts("pickup_nonfinancial_ACK_storage_failure_sends_nothing_existing_paid_audio_dedup_unchanged_host_only");
}
