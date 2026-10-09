/* Injected backend fixtures exercise actual UI/consumer/journal source. Never hardware proof. */
static uint8_t pixels[480*320*2];static unsigned glyphs;static const char *output;
static const char *fixture_device="10000000-0000-4000-8000-000000000001";
static const char *fixture_order="20000000-0000-4000-8000-000000000001";
static const char *fixture_quote="30000000-0000-4000-8000-000000000001";
static void flush(lv_display_t *display,const lv_area_t *area,uint8_t *map){(void)area;assert(map==pixels);if(host_transfer){host_flushes++;host_flush_at=++host_serial;}lv_display_flush_ready(display);}
static lv_obj_t *find_label(lv_obj_t *o,const char *text){if(lv_obj_check_type(o,&lv_label_class)&&!strcmp(lv_label_get_text(o),text))return o;for(unsigned i=0;i<lv_obj_get_child_count(o);i++){lv_obj_t *found=find_label(lv_obj_get_child(o,i),text);if(found)return found;}return NULL;}
static void glyph_check(lv_obj_t *o){if(lv_obj_check_type(o,&lv_label_class)){const uint8_t *s=(const uint8_t *)lv_label_get_text(o);const lv_font_t *font=lv_obj_get_style_text_font(o,LV_PART_MAIN);while(*s){uint32_t cp=*s++;if(cp>=0xe0){cp&=15;for(unsigned i=0;i<2;i++){assert((*s&0xc0)==0x80);cp=(cp<<6)|(*s++&63);}}else if(cp>=0xc0){assert((*s&0xc0)==0x80);cp=((cp&31)<<6)|(*s++&63);}if(cp=='\n'||cp=='\r'||cp=='\t')continue;lv_font_glyph_dsc_t glyph={0};assert(lv_font_get_glyph_dsc(font,&glyph,cp,0)&&!glyph.is_placeholder);glyphs++;}}for(unsigned i=0;i<lv_obj_get_child_count(o);i++)glyph_check(lv_obj_get_child(o,i));}
static void image(const char *name){lv_refr_now(lv_display_get_default());glyph_check(lv_screen_active());char path[1024];assert(snprintf(path,sizeof(path),"%s/%s.rgb565",output,name)<(int)sizeof(path));FILE *f=fopen(path,"wb");assert(f&&fwrite(pixels,1,sizeof(pixels),f)==sizeof(pixels)&&fclose(f)==0);}
static void pump(void){touch_t touch;while(xQueueReceive(touches,&touch,0)==pdTRUE)handle_touch(touch);}
static lv_indev_t *pointer;static lv_point_t pointer_at;static bool pointer_down;
static void pointer_read(lv_indev_t *indev,lv_indev_data_t *data){(void)indev;data->point=pointer_at;data->state=pointer_down?LV_INDEV_STATE_PRESSED:LV_INDEV_STATE_RELEASED;}
static void pointer_click(lv_obj_t *button){
    lv_obj_update_layout(lv_screen_active());lv_area_t area;lv_obj_get_coords(button,&area);
    pointer_at=(lv_point_t){(area.x1+area.x2)/2,(area.y1+area.y2)/2};pointer_down=true;lv_indev_read(pointer);
    pump();assert(lv_obj_is_valid(button)); /* Consumer ran between actual press and release. */
    pointer_down=false;lv_indev_read(pointer);pump();
}
static void click(const char *text){
    lv_obj_update_layout(lv_screen_active());
    lv_obj_t *l=find_label(menu_shade?menu_shade:lv_screen_active(),text);assert(l);
    lv_obj_t *b=lv_obj_get_parent(l);
    assert(lv_obj_check_type(b,&lv_button_class)&&!lv_obj_has_state(b,LV_STATE_DISABLED));
    if(lv_obj_get_height(b)<44||lv_obj_get_width(b)<44)
        fprintf(stderr,"Undersized native control: %s width=%d height=%d\n",text,(int)lv_obj_get_width(b),(int)lv_obj_get_height(b));
    assert(lv_obj_get_height(b)>=44&&lv_obj_get_width(b)>=44);
    pointer_click(b);
}
static void open_menu(void){lv_obj_t *root=lv_screen_active();lv_obj_update_layout(root);lv_obj_t *button=NULL;for(unsigned i=0;i<lv_obj_get_child_count(root);i++){lv_obj_t *o=lv_obj_get_child(root,i);if(lv_obj_check_type(o,&lv_button_class)&&lv_obj_get_x(o)==428&&lv_obj_get_y(o)==0)button=o;}assert(button&&lv_obj_get_width(button)==44&&lv_obj_get_height(button)==44);pointer_click(button);assert(menu_shade);}
static cJSON *fixture_money(unsigned long long amount,const char *currency){cJSON *j=cJSON_CreateObject();char value[32];snprintf(value,sizeof(value),"%llu",amount);cJSON_AddStringToObject(j,"currency",currency);cJSON_AddNumberToObject(j,"decimals",!strcmp(currency,"USDG")?6:2);cJSON_AddStringToObject(j,"amountMinor",value);return j;}
static cJSON *settlement(unsigned long long amount){cJSON *j=fixture_money(amount,"USDG");cJSON_AddStringToObject(j,"network","solana:devnet");cJSON_AddStringToObject(j,"genesisHash","EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");cJSON_AddStringToObject(j,"mint","4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7");cJSON_AddStringToObject(j,"tokenProgram","TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");cJSON_AddBoolToObject(j,"testToken",true);return j;}
static cJSON *cart_screen(const char *session,unsigned version,unsigned quantity){cJSON *j=cJSON_CreateObject();char value[32];cJSON_AddStringToObject(j,"kind","cart");cJSON_AddStringToObject(j,"screenGeneration","2");cJSON_AddStringToObject(j,"sessionId",session);snprintf(value,sizeof(value),"%u",version);cJSON_AddStringToObject(j,"cartVersion",value);cJSON_AddStringToObject(j,"leaseUntil","2026-10-08T00:02:00.000Z");cJSON_AddNullToObject(j,"review");cJSON *items=cJSON_AddArrayToObject(j,"items");if(quantity){cJSON *item=cJSON_CreateObject();cJSON_AddStringToObject(item,"productId",table.rows[0].product);cJSON_AddNumberToObject(item,"qty",quantity);cJSON_AddItemToArray(items,item);}return j;}
static void feed(cJSON *j){char *bytes=cJSON_PrintUnformatted(j);assert(bytes&&strlen(bytes)<=8191);message_t msg={0};strcpy(msg.json,bytes);free(bytes);cJSON_Delete(j);consume_v2(&msg);assert(!atomic_load(&resync));}
static void reply(const char *request,cJSON *value,const char *generation){cJSON *j=cJSON_CreateObject();char connection[32],assignment[32];snprintf(connection,sizeof(connection),"%" PRIu64,table.connection);snprintf(assignment,sizeof(assignment),"%" PRIu64,table.assignment);cJSON_AddNumberToObject(j,"schemaVersion",2);cJSON_AddStringToObject(j,"type","COMMAND_RESULT");cJSON_AddStringToObject(j,"requestId",request);cJSON_AddStringToObject(j,"connectionGeneration",connection);cJSON_AddStringToObject(j,"screenGeneration",generation);cJSON_AddStringToObject(j,"assignmentGeneration",assignment);cJSON *result=cJSON_AddObjectToObject(j,"result");cJSON_AddBoolToObject(result,"ok",true);cJSON_AddItemToObject(result,"value",value);feed(j);}
static unsigned fixture_order_version(const char *status){return !strcmp(status,"PAID")?3:!strcmp(status,"CONFIRMING")?2:1;}
static cJSON *order_view(const char *status,bool sound){cJSON *j=cJSON_CreateObject();cJSON_AddStringToObject(j,"id",fixture_order);cJSON_AddStringToObject(j,"status",status);cJSON_AddNumberToObject(j,"version",fixture_order_version(status));cJSON *a=cJSON_AddObjectToObject(j,"authority");cJSON_AddStringToObject(a,"kind","versioned");cJSON *target=cJSON_AddObjectToObject(a,"target");cJSON_AddStringToObject(target,"deviceId",fixture_device);cJSON_AddStringToObject(target,"assignmentGeneration","1");cJSON *place=cJSON_AddObjectToObject(a,"serving");cJSON_AddStringToObject(place,"label","Host fixture table");cJSON_AddItemToObject(j,"total",fixture_money(13500,"USD"));cJSON_AddItemToObject(j,"settlement",settlement(135000000));time_t future=time(NULL)+300;struct tm utc;gmtime_r(&future,&utc);char expires[32];strftime(expires,sizeof(expires),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_AddStringToObject(j,"quoteExpiresAt",expires);cJSON_AddStringToObject(j,"paymentUrl","https://example.invalid/pay/explicit-host-fixture");cJSON *items=cJSON_AddArrayToObject(j,"items");cJSON_AddItemToArray(items,cJSON_CreateString("1 x Host fixture line"));cJSON_AddItemToArray(items,cJSON_CreateString("+ 49 more items"));cJSON_AddStringToObject(j,"quoteId",fixture_quote);cJSON_AddNumberToObject(j,"lineCount",50);cJSON_AddNumberToObject(j,"pageCount",13);cJSON_AddBoolToObject(j,"canDismiss",false);cJSON_AddBoolToObject(j,"sound",sound);cJSON_AddStringToObject(j,"effectId",fixture_quote);return j;}
static void order_event(const char *type,unsigned seq,const char *status,bool sound){cJSON *j=cJSON_CreateObject();char value[32];cJSON_AddNumberToObject(j,"schemaVersion",2);cJSON_AddStringToObject(j,"type",type);cJSON_AddStringToObject(j,"eventId",fixture_quote);cJSON_AddStringToObject(j,"deviceId",fixture_device);snprintf(value,sizeof(value),"%u",seq);cJSON_AddStringToObject(j,"deviceSeq",value);snprintf(value,sizeof(value),"%" PRIu64,table.connection);cJSON_AddStringToObject(j,"connectionGeneration",value);cJSON_AddStringToObject(j,"screenGeneration","3");cJSON_AddStringToObject(j,"occurredAt","2026-10-08T00:00:00.000Z");if(!strcmp(type,"SNAPSHOT")){cJSON *p=cJSON_AddObjectToObject(j,"payload"),*s=cJSON_AddObjectToObject(p,"screen");cJSON_AddStringToObject(s,"kind","order");cJSON_AddStringToObject(s,"screenGeneration","3");cJSON_AddItemToObject(s,"order",order_view(status,sound));cJSON_AddBoolToObject(s,"canDismiss",false);cJSON_AddNullToObject(p,"recoverableDraft");}else cJSON_AddItemToObject(j,"payload",order_view(status,sound));feed(j);}
static void ready(void){memset(&table,0,sizeof(table));memset(&current,0,sizeof(current));memset(&presentation,0,sizeof(presentation));table.configured=table.synchronized=table.online=table.storage_ok=true;table.connection=5;table.screen=1;table.assignment=1;strcpy(table.device,fixture_device);strcpy(table.price,"fixture-price");strcpy(table.payment_origin,"https://example.invalid");strcpy(table.table_entry_url,"https://example.invalid/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");strcpy(table.serving,"Host fixture table");connected=true;page=0;atomic_store(&clock_synced,true);}
static void refusal(const char *request,const char *code) {
    cJSON *j=cJSON_CreateObject();char connection[32],assignment[32],screen[32];
    snprintf(connection,sizeof(connection),"%" PRIu64,table.connection);snprintf(assignment,sizeof(assignment),"%" PRIu64,table.assignment);snprintf(screen,sizeof(screen),"%" PRIu64,table.screen);
    cJSON_AddNumberToObject(j,"schemaVersion",2);cJSON_AddStringToObject(j,"type","COMMAND_RESULT");cJSON_AddStringToObject(j,"requestId",request);
    cJSON_AddStringToObject(j,"connectionGeneration",connection);cJSON_AddStringToObject(j,"screenGeneration",screen);cJSON_AddStringToObject(j,"assignmentGeneration",assignment);
    cJSON *result=cJSON_AddObjectToObject(j,"result");cJSON_AddBoolToObject(result,"ok",false);cJSON *error=cJSON_AddObjectToObject(result,"error");cJSON_AddStringToObject(error,"code",code);feed(j);
}
static lv_fs_res_t decode_read(lv_fs_drv_t *driver,void *file,void *buffer,uint32_t count,uint32_t *read){
    if(host_decode_hook)host_decode_hook();
    return fs_read(driver,file,buffer,count,read);
}
static void queue_arrival(void){host_lock_hook=NULL;host_decode_hook=NULL;message_t msg={0};assert(xQueueSend(inbox,&msg,0)==pdTRUE);}
static void gif_preemption(void) {
    table_state_t retained=table;order_t order=current;bool oldphotos=photos_ready;
    ready();photos_ready=false;assert(physical_render());lv_tick_inc(800);
    message_t pending={0};assert(xQueueSend(inbox,&pending,0)==pdTRUE);idle_gif_prepare();assert(!ui.gif&&!ui.gif_attempted);
    xQueueReset(inbox);host_lock_hook=queue_arrival;idle_gif_prepare();assert(!ui.gif&&!ui.gif_attempted);
    xQueueReset(inbox);host_decode_hook=queue_arrival;uint32_t start=lv_tick_get();idle_gif_prepare();
    assert(ui.gif&&lv_gif_is_loaded(ui.gif)&&uxQueueMessagesWaiting(inbox)==1);
    lv_obj_update_layout(lv_screen_active());
    assert(lv_obj_get_x(ui.gif)==326&&lv_obj_get_y(ui.gif)==95);
    assert(lv_image_get_scale_x(ui.gif)==256&&lv_image_get_scale_y(ui.gif)==256);
    assert(lv_obj_get_width(ui.gif)==128&&lv_obj_get_height(ui.gif)==128);
    image("v2-centered-idle-coffee");
    printf("host_first_cached_RAM_decode_tick_delta=%u_not_physical_latency\n",lv_tick_get()-start);
    xQueueReset(inbox);order_event("ORDER",1,"AWAITING_PAYMENT",false);assert(table.order_owner&&!ui.gif&&ui.kind==UI_QR);
    image("v2-GIF-preempted-by-payment");
    table=retained;current=order;photos_ready=oldphotos;assert(physical_render());
    puts("actual_cache1_RAM_GIF_pending_arrival_before_lock_and_during_first_decode_preempts_before_order_ACK");
}
static void idle_carousel(void) {
    ready();table.rows_count=1;table.menu_generated_ms=wall_ms()-1000;table.menu_until_ms=wall_ms()+600000;
    table_row_t *row=&table.rows[0];strcpy(row->name,"Long cafe menu name with Thai กาแฟ and supported punctuation");
    row->available=true;row->asset=0;row->unit=(table_money_t){"USD",2,270};
    unsigned audio_before=host_audio;bool old_motion=reduced_motion;reduced_motion=true;
    presentation.switched=lv_tick_get();assert(physical_render());lv_tick_inc(10000);idle_advance();
    assert(presentation.photo&&ui.kind==UI_PHOTO&&find_label(lv_screen_active(),"USD 2.70"));image("v2-idle-long-name-canonical-price");
    open_menu();assert(presentation.paused&&menu_shade&&!find_label(menu_shade,"Menu")&&!find_label(menu_shade,"Cart"));
    click("Home");assert(!presentation.photo&&ui.kind==UI_IDLE&&find_label(lv_screen_active(),"Tap anywhere to order"));
    assert(!find_label(lv_screen_active(),"Scan to order")&&host_attract_active);
    pointer_click(lv_screen_active());assert(ui.kind==UI_ENTRY&&find_label(lv_screen_active(),"Scan to order")&&!host_attract_active);
    assert(entry_encodes>0);unsigned encoded=entry_encodes;assert(physical_render());assert(entry_encodes==encoded);
    lv_tick_inc(30000);idle_advance();assert(ui.kind==UI_IDLE&&!presentation.entry&&host_attract_active);lv_tick_inc(10000);idle_advance();assert(presentation.photo&&ui.kind==UI_PHOTO);
    table.observed_cart=true;idle_advance();assert(!presentation.photo);table.observed_cart=false;
    photos_ready=false;assert(physical_render()&&ui.kind==UI_IDLE);photos_ready=true;
    table.menu_until_ms=wall_ms();idle_advance();assert(!presentation.photo);
    assert(host_audio==audio_before);reduced_motion=old_motion;ready();assert(physical_render());
    puts("actual_LVGL_pointer_press_consumer_release_keeps_photo_hamburger_clickable_entry_QR_cached_guest_occupancy_preempts_host_only");
}
int main(int argc,char **argv){
 assert(argc==3);output=argv[1];FILE *gif=fopen(argv[2],"rb");assert(gif);source_size=85290;source=malloc(source_size);
 assert(source&&fread(source,1,source_size,gif)==source_size&&fgetc(gif)==EOF&&fclose(gif)==0);
 assert(first_transparent_background(source,source_size,initial_background_rgb));
 lv_init();lv_fs_drv_t drive;lv_fs_drv_init(&drive);drive.letter='M';drive.open_cb=fs_open;drive.close_cb=fs_close;
 drive.read_cb=decode_read;drive.seek_cb=fs_seek;drive.tell_cb=fs_tell;lv_fs_drv_register(&drive);atomic_store(&published,true);
 lv_display_t *display=lv_display_create(480,320);assert(display);lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);lv_display_set_buffers(display,pixels,NULL,sizeof(pixels),LV_DISPLAY_RENDER_MODE_FULL);lv_display_set_flush_cb(display,flush);touches=xQueueCreate(12,sizeof(touch_t));inbox=xQueueCreate(8,sizeof(message_t));socket_client=(void *)1;state_nvs=1;pointer=lv_indev_create();lv_indev_set_type(pointer,LV_INDEV_TYPE_POINTER);lv_indev_set_display(pointer,display);lv_indev_set_read_cb(pointer,pointer_read);lv_indev_add_event_cb(pointer,any_touch,LV_EVENT_PRESSED,NULL);restore_journal();ready();assert(physical_render());image("v2-idle-entry-qr");gif_preemption();host_sends=0;
 idle_carousel();
 table.rows_count=1;strcpy(table.rows[0].product,"40000000-0000-4000-8000-000000000001");strcpy(table.rows[0].name,"Host cafe");table.rows[0].available=true;
 unsigned before=host_sends;char request[37],key[37];cJSON *v;
 strcpy(table.saved.session,fixture_quote);table.saved.count=table.saved.desired_count=1;strcpy(table.saved.acknowledged[0].product,table.rows[0].product);table.saved.acknowledged[0].qty=1;
 v=cart_screen(fixture_quote,1,1);assert(apply_screen(v));cJSON_Delete(v);assert(table.observed_cart&&!table.cart_owner&&table.saved.count==1);
 heartbeat();assert(strstr(host_sent[host_sends-1],"\"sessionId\":null")&&host_sends==before+1);assert(physical_render());image("v2-observed-phone-cart");
 open_menu();assert(!find_label(menu_shade,"Menu")&&!find_label(menu_shade,"Cart"));click("Home");assert(!table.saved.pending.kind&&table.observed_cart);
 table.observed_cart=false;table.saved.pending.kind=TC_SUBMIT;strcpy(table.saved.pending.request,fixture_quote);strcpy(table.saved.pending.session,fixture_quote);strcpy(table.saved.pending.quote,fixture_quote);strcpy(table.saved.pending.price,"fixture-price");strcpy(table.saved.pending.key,fixture_order);strcpy(key,table.saved.pending.key);assert(save_journal());
 connected=false;host_network=false;before=host_sends;assert(!begin_command(TC_SUBMIT)&&host_sends==before&&!strcmp(key,table.saved.pending.key));host_network=true;connected=true;sync_session();assert(table.resolving&&!table.synchronized&&!strcmp(key,table.saved.pending.key));strcpy(request,table.sync_request);v=cJSON_CreateObject();cJSON *screen=cJSON_AddObjectToObject(v,"screen");cJSON_AddStringToObject(screen,"kind","order");cJSON_AddStringToObject(screen,"screenGeneration","3");cJSON_AddItemToObject(screen,"order",order_view("AWAITING_PAYMENT",false));cJSON_AddBoolToObject(screen,"canDismiss",false);cJSON_AddItemToObject(v,"pendingOrder",order_view("AWAITING_PAYMENT",false));cJSON_AddNullToObject(v,"pendingResult");cJSON_AddNullToObject(v,"recoverableDraft");reply(request,v,"3");assert(!table.saved.pending.kind&&table.order_owner&&!table.cart_owner&&table.saved.count==0&&!strcmp(current.order,fixture_order)&&ui.kind==UI_QR);image("v2-exact-order-qr");puts("legacy_pending_submit_preserved_resolved_same_key_without_new_local_menu_or_cart_mutation");
 current.can_cancel=true;assert(physical_render());assert(find_label(ui.body,"Cancel"));before=host_sends;click("Cancel");assert(table.saved.pending.kind==TC_CANCEL);assert(host_sends==before+1&&strstr(host_sent[host_sends-1],"ORDER_CANCEL")&&strstr(host_sent[host_sends-1],current.order));assert(table.order_owner&&current.order[0]);memset(&table.saved.pending,0,sizeof(table.saved.pending));table.resolving=false;assert(save_journal());current.can_cancel=false;puts("actual_cancel_button_queues_correlated_command_without_local_release");
 order_event("ORDER",1,"CONFIRMING",false);assert(ui.kind==UI_CONFIRMING);image("v2-confirming");before=host_sends;host_transfer=false;order_event("ORDER",2,"PAID",true);assert(host_sends==before&&host_audio==0&&host_claims==0);host_transfer=true;order_event("ORDER",2,"PAID",true);assert(host_sends>before&&host_ack_at>host_flush_at&&host_audio==1&&host_claims==1);order_event("ORDER",2,"PAID",true);assert(host_audio==1&&host_claims==1);image("v2-paid-once");puts("failed_transfer_no_ACK_successful_transfer_ACK_before_durable_once_only_effect");
 open_menu();assert(lv_obj_has_state(lv_obj_get_parent(find_label(menu_shade,"Home")),LV_STATE_DISABLED));click("Receipt");lv_tick_inc(60000);idle_advance();assert(table.order_owner&&ui.kind==UI_PAID&&!presentation.photo);order_event("SNAPSHOT",3,"PAID",false);assert(host_audio==1&&host_claims==1);image("v2-silent-paid-snapshot");puts("paid_dwell_never_releases_owner_snapshot_and_duplicate_are_silent");
 ui.celebrating=true;ui.paid_started=lv_tick_get();ui.motion_timer=lv_timer_create(motion_tick,40,NULL);paid_frame(0);lv_tick_inc(2400);lv_timer_handler();assert(!ui.celebrating);image("v2-paid-finite-end");
 for(unsigned i=0;i<40;i++){assert(physical_render());glyph_check(lv_screen_active());}puts("finite_effect_and_scene_teardown_supported_glyph_regression");
 /* Presentation-only fixtures cover every customer-facing order scene without
  * forging wire events, changing the durable owner, or claiming hardware proof. */
 order_t retained_order=current;unsigned retained_page=page;bool retained_connection=connected;
 before=host_audio;page=1;assert(physical_render()&&ui.kind==UI_BILL);image("v2-full-bill");
 page=0;strcpy(current.status,"AWAITING_PAYMENT");connected=false;assert(physical_render()&&ui.kind==UI_OFFLINE);image("v2-offline");
 connected=true;strcpy(current.status,"EXPIRED");assert(physical_render()&&ui.kind==UI_EXPIRED);image("v2-expired");
 strcpy(current.status,"RECOVERY");assert(physical_render()&&ui.kind==UI_RECOVERY);image("v2-recovery");
 assert(host_audio==before);current=retained_order;page=retained_page;connected=retained_connection;assert(physical_render());
 puts("all_order_scene_labels_bounded_supported_glyphs_no_replayed_payment_sound_host_only");
 table_durable_t saved=table.saved;host_storage=false;table.order_owner=false;table.cart_owner=true;connected=true;table.synchronized=true;table.resolving=false;table.saved.pending.kind=TC_NONE;before=host_sends;assert(!begin_command(TC_REVIEW)&&host_sends==before&&!table.storage_ok);table.saved=saved;host_storage=true;puts("storage_failure_sends_nothing_and_preserves_owned_partition");
 memset(&table,0,sizeof(table));restore_journal();assert(table.storage_ok&&journal_sequence&&table.saved.locked_order[0]);printf("glyphs_checked=%u host_frames=%u journal_sequence=%" PRIu64 "\n",glyphs,host_flushes,journal_sequence);stop_scene();lv_deinit();free(source);free(touches->bytes);free(touches);free(inbox->bytes);free(inbox);(void)consumer;return 0;
}
