/* BitPOS application; board/display provenance remains in docs/FIRMWARE_PROVENANCE.json. */
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <ctype.h>
#include <time.h>
#include <sys/time.h>
#include <stdatomic.h>
#include "esp_sntp.h"
#include "esp_heap_caps.h"
#include "bitpos_media.h"
#include "bitpos_audio.h"
#include "bitpos_probe.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_app_desc.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "mbedtls/sha256.h"
#include "bitpos_table.h"
#include "esp_random.h"
#include <inttypes.h>
#include "ccp_board.h"
#include "display_engine.h"
LV_FONT_DECLARE(bitpos_font_20);
LV_FONT_DECLARE(bitpos_clock_64);
LV_IMAGE_DECLARE(bitpos_logo);

#define MESSAGE_MAX 8192
#define URL_MAX 768
#define ID_MAX 96
static QueueHandle_t inbox;
static esp_websocket_client_handle_t socket_client;
static nvs_handle_t state_nvs;
static char merchant[ID_MAX], terminal[ID_MAX]; /* Legacy private provisioning labels, never v2 authority. */
static table_state_t table;
static QueueHandle_t touches;
typedef struct { int action; unsigned index; uint32_t generation; } touch_t;
static atomic_uint touch_generation;
enum { T_NAV=1,T_MENU,T_SOUND,T_MOTION,T_VIEW,T_DISMISS,T_IDLE,T_CANCEL };
static atomic_bool resync;
static nvs_handle_t ordering_nvs;
static uint64_t journal_sequence;
/* One consumer reuses the compact journal workspace for bounded serialization. */
static union { uint8_t journal[TABLE_JOURNAL_MAX];char wire[TABLE_JOURNAL_MAX]; } table_io;
#define journal_buffer table_io.journal
#define outbound table_io.wire
static void touch_send(int action,unsigned index) {
    touch_t intent={action,index,atomic_load(&touch_generation)};
    if(xQueueSend(touches,&intent,0)!=pdTRUE)atomic_store(&resync,true);
}
static bool connected;
typedef struct { int kind; int64_t received_us; char json[MESSAGE_MAX]; } message_t;
typedef struct {
    char event[ID_MAX], order[ID_MAX], date[40], status[24], label[96], amount[32], qr[URL_MAX], items[6][96];
    uint32_t version; bool snapshot, sound; unsigned item_count;
    uint64_t connection, screen, seq;
    table_money_t total;
    char quote[TABLE_UUID], effect[ID_MAX];
    unsigned line_count, page_count;
    int64_t quote_until_ms;
    bool can_dismiss, can_cancel;
} order_t;
static order_t current;
static int page; /* 0 clock, 1 bill, 2 QR, 3 server status/receipt */
static uint32_t last_flush_ms;

static bool text(cJSON *o, const char *key, char *dst, size_t cap) {
    cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);
    if (!cJSON_IsString(v) || strlen(v->valuestring)>=cap) return false;
    strcpy(dst,v->valuestring); return true;
}
static bool parse_view(cJSON *p,order_t *o) {
    char device[TABLE_UUID];
    cJSON *v=cJSON_GetObjectItemCaseSensitive(p,"version"),*items=cJSON_GetObjectItemCaseSensitive(p,"items");
    cJSON *sound=cJSON_GetObjectItemCaseSensitive(p,"sound"),*dismiss=cJSON_GetObjectItemCaseSensitive(p,"canDismiss");
    if(!cJSON_IsNumber(v)||v->valuedouble<1||v->valuedouble>UINT32_MAX||floor(v->valuedouble)!=v->valuedouble||
       !text(p,"id",o->order,sizeof(o->order))||!table_uuid(o->order)||
       !text(p,"status",o->status,sizeof(o->status))||!text(p,"paymentUrl",o->qr,sizeof(o->qr))||
       !table.payment_origin[0]||strncmp(o->qr,table.payment_origin,strlen(table.payment_origin))||
       strncmp(o->qr+strlen(table.payment_origin),"/pay/",5)||
       !table_money(cJSON_GetObjectItemCaseSensitive(p,"total"),&o->total,true)||
       !cJSON_IsArray(items)||cJSON_GetArraySize(items)>6||!cJSON_IsBool(sound)||!cJSON_IsBool(dismiss))return false;
    cJSON *authority=cJSON_GetObjectItemCaseSensitive(p,"authority");
    cJSON *target=cJSON_GetObjectItemCaseSensitive(authority,"target");
    char authority_kind[24];
    if(!text(authority,"kind",authority_kind,sizeof(authority_kind)))return false;
    if(!strcmp(authority_kind,"versioned")){if(!text(target,"deviceId",device,sizeof(device))||strcmp(device,table.device)||!strcmp(o->total.currency,"THB"))return false;}
    else if(strcmp(authority_kind,"legacy")||strcmp(o->total.currency,"THB")||
        !text(target,"legacyTerminalId",device,sizeof(device))||strcmp(device,terminal))return false;
    const char *opaque=o->qr+strlen(table.payment_origin)+5;
    if(!*opaque)return false;
    for(const char *s=opaque;*s;s++)if(!isalnum((unsigned char)*s)&&*s!='-'&&*s!='_')return false;
    if(!text(cJSON_GetObjectItemCaseSensitive(authority,"serving"),"label",o->label,sizeof(o->label))||!table_display_text(o->label))return false;
    table_money_t settlement;
    if(!table_settlement(cJSON_GetObjectItemCaseSensitive(p,"settlement"),&settlement))return false;
    if((!strcmp(o->total.currency,"USD")&&(o->total.minor>UINT64_MAX/10000||settlement.minor!=o->total.minor*10000))||
       (!strcmp(o->total.currency,"USDG")&&settlement.minor!=o->total.minor))return false;
    snprintf(o->amount,sizeof(o->amount),"%" PRIu64,settlement.minor);
    if(!table_timestamp(p,"quoteExpiresAt",&o->quote_until_ms))return false;
    const char *statuses[]={"AWAITING_WALLET","AWAITING_PAYMENT","CONFIRMING","PAID","EXPIRED","RECOVERY"};
    bool known=false;for(unsigned i=0;i<6;i++)known|=!strcmp(o->status,statuses[i]);if(!known)return false;
    o->version=(uint32_t)v->valuedouble;o->sound=cJSON_IsTrue(sound)&&!o->snapshot;o->can_dismiss=cJSON_IsTrue(dismiss);o->can_cancel=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(p,"canCancel"));
    cJSON *count=cJSON_GetObjectItemCaseSensitive(p,"lineCount"),*pages=cJSON_GetObjectItemCaseSensitive(p,"pageCount");
    if(!cJSON_IsNumber(count)||count->valuedouble<1||count->valuedouble>50||floor(count->valuedouble)!=count->valuedouble||
       !cJSON_IsNumber(pages)||pages->valuedouble!=ceil(count->valuedouble/4))return false;
    cJSON *quote=cJSON_GetObjectItemCaseSensitive(p,"quoteId");
    if(cJSON_IsNull(quote)){if(strcmp(authority_kind,"legacy"))return false;}
    else if(!text(p,"quoteId",o->quote,sizeof(o->quote))||!table_uuid(o->quote))return false;
    o->line_count=(unsigned)count->valuedouble;o->page_count=(unsigned)pages->valuedouble;
    cJSON *effect=cJSON_GetObjectItemCaseSensitive(p,"effectId");if(cJSON_IsString(effect)&&!text(p,"effectId",o->effect,sizeof(o->effect)))return false;
    cJSON *item;cJSON_ArrayForEach(item,items){if(!cJSON_IsString(item)||strlen(item->valuestring)>=96)return false;strcpy(o->items[o->item_count++],item->valuestring);}
    return true;
}
static bool parse(cJSON *j,order_t *o) {
    cJSON *p=cJSON_GetObjectItemCaseSensitive(j,"payload");char type[32],device[TABLE_UUID];
    if(!text(j,"type",type,sizeof(type))||!text(j,"deviceId",device,sizeof(device))||strcmp(device,table.device)||
       !text(j,"eventId",o->event,sizeof(o->event))||!table_integer(j,"connectionGeneration",&o->connection)||o->connection!=table.connection||
       !table_integer(j,"screenGeneration",&o->screen)||o->screen<table.screen||!table_integer(j,"deviceSeq",&o->seq)||o->seq<table.seq)return false;
    o->snapshot=!strcmp(type,"SNAPSHOT");
    if(o->snapshot)p=cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(p,"screen"),"order");
    else if(strcmp(type,"ORDER"))return false;
    return parse_view(p,o);
}
/* UI ownership: only consumer/display task under the recursive display lock.
 * Every rebuild cancels scene timers/animations and releases the idle decoder
 * BEFORE deleting widgets. No timer captures a transient order or widget.
 * Clock buffers, check points and twelve particle slots have scene lifetime.
 * Navigation never changes payment facts and never starts a PAID effect.
 */
static lv_obj_t *label(lv_obj_t *parent,const char *s,int x,int y,int width,const lv_font_t *font) {
    lv_obj_t *l=lv_label_create(parent);
    lv_obj_remove_style_all(l);
    lv_label_set_text(l,s);
    lv_label_set_long_mode(l,LV_LABEL_LONG_CLIP);
    lv_obj_set_pos(l,x,y);
    lv_obj_set_width(l,width);
    lv_obj_set_style_text_font(l,font,0);
    lv_obj_set_style_text_color(l,lv_color_hex(0xfff5eb),0);
    return l;
}

enum { INK=0x1d0c2b, PANEL=0x301441, PURPLE=0x7542ac,
       ORANGE=0xffa352, MUTED=0xc0a8cb, LINE=0x573367 };
typedef enum { UI_IDLE, UI_PHOTO, UI_BILL, UI_QR, UI_CONFIRMING, UI_PAID,
               UI_EXPIRED, UI_RECOVERY, UI_OFFLINE, UI_ENTRY } scene_kind_t;
static struct {
    scene_kind_t kind;
    uint32_t generation, started, navigation_started, paid_started, last_motion;
    lv_obj_t *body, *hours, *minutes, *date, *colon[2], *orbit, *promo;
    lv_obj_t *ring, *check, *particles[12], *gif, *attract;
    lv_timer_t *motion_timer, *clock_timer;
    char hh[3], mm[3], day[64], bill[6][96], amount[64];
    bool entering, celebrating, gif_attempted;
    unsigned promo_index;
    time_t clock_minute;
} ui;
static lv_obj_t *menu_shade;
static atomic_bool reduced_motion;
static atomic_bool clock_synced;
static atomic_uint confirming_started;
/* Presentation state survives scene teardown, metadata renewals and replays. */
static struct {
    bool photo, paused, paid_flushed, entry;
    unsigned product, next_product;
    uint32_t switched, touched, paid_at;
    char paid_order[ID_MAX];
} presentation;
static atomic_bool receiving, consuming;
enum { STATUS_RING_X=32, STATUS_RING_Y=93, STATUS_RING_SIZE=86,
       PAID_CHECK_X=57, PAID_CHECK_Y=118, PAID_CENTER_X=75, PAID_CENTER_Y=136 };
static const lv_point_precise_t check_points[]={{0,19},{12,31},{35,4}};
static const int16_t particle_dx[12]={100,87,50,0,-50,-87,-100,-87,-50,0,50,87};
static const int16_t particle_dy[12]={0,50,87,100,87,50,0,-50,-87,-100,-87,-50};
static const char *const cafe_copy[]={
    "Good coffee. Great company.", "Take a break. Stay a while.", "Your next cafe moment."
};

static lv_obj_t *box(lv_obj_t *parent,int x,int y,int w,int h,uint32_t color,int radius) {
    lv_obj_t *o=lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(o,x,y);
    lv_obj_set_size(o,w,h);
    lv_obj_set_style_bg_color(o,lv_color_hex(color),0);
    lv_obj_set_style_bg_opa(o,LV_OPA_COVER,0);
    /* Seed opacity at construction: motion only updates existing properties. */
    lv_obj_set_style_opa(o,LV_OPA_COVER,0);
    lv_obj_set_style_radius(o,radius,0);
    return o;
}
static void tint(lv_obj_t *o,uint32_t color) {
    lv_obj_set_style_text_color(o,lv_color_hex(color),0);
}
static void cancel_animations(lv_obj_t *o) {
    for(uint32_t i=0;i<lv_obj_get_child_count(o);i++)cancel_animations(lv_obj_get_child(o,i));
    lv_anim_delete(o,NULL);
}
static void stop_scene(void) {
    menu_shade=NULL; /* The root teardown below destroys any open overlay. */
    if(ui.motion_timer){lv_timer_delete(ui.motion_timer);ui.motion_timer=NULL;}
    if(ui.clock_timer){lv_timer_delete(ui.clock_timer);ui.clock_timer=NULL;}
#if LV_USE_GIF
    if(ui.gif)lv_gif_pause(ui.gif);
#endif
    cancel_animations(lv_screen_active());
    /* lv_obj_clean invokes GIF's destructor, releasing decoder/cache/timer. */
    lv_obj_clean(lv_screen_active());
    uint32_t generation=ui.generation+1;
    memset(&ui,0,sizeof(ui));
    ui.generation=generation;
    atomic_store(&touch_generation,generation);
    ui.clock_minute=(time_t)-1;
}
static void render(bool navigation);
static int64_t wall_ms(void) {
    struct timeval now;gettimeofday(&now,NULL);
    return (int64_t)now.tv_sec*1000+now.tv_usec/1000;
}
static bool catalog_valid(void) {
    return bitpos_media_photos_available()&&atomic_load(&clock_synced)&&table.rows_count&&
        wall_ms()>=table.menu_generated_ms&&wall_ms()<table.menu_until_ms;
}
static bool idle_eligible(void) {
    return !atomic_load(&receiving)&&uxQueueMessagesWaiting(inbox)==0&&
        connected&&table.synchronized&&!table.cart_owner&&!table.observed_cart&&!table.order_owner&&!table.needs_resume&&
        !table.saved.pending.kind&&table.view==0&&!current.order[0];
}
static void pause_carousel(void) {
    presentation.paused=true;presentation.touched=lv_tick_get();
    bitpos_audio_set_attract(false);
}
static void toggle_menu(lv_event_t *e);
static void photo_touch(lv_event_t *e);
static void any_touch(lv_event_t *e) {
    (void)e;
    touch_send(T_VIEW,0); /* Deferred consumer handling; no IO or UI allocations in input callback. */
}
static void photo_touch(lv_event_t *e) {
    (void)e;
    touch_send(T_VIEW,1); /* Change the scene on release, never while pressed. */
}
static void record_paid_flush(bool rendered) {
    if(rendered&&!strcmp(current.status,"PAID")&&ui.kind==UI_PAID&&!presentation.paid_flushed) {
        presentation.paid_flushed=true;presentation.paid_at=lv_tick_get();
        strcpy(presentation.paid_order,current.order);
    }
}
static void preempt_order(bool same_order) {
    presentation.photo=false;
    presentation.entry=false;bitpos_audio_set_attract(false);
    if(!same_order) {
        presentation.paid_flushed=false;presentation.paid_order[0]=0;
        presentation.next_product=0;
    }
    presentation.switched=lv_tick_get();
}
static bool payable(void) {
    return connected&&table.synchronized&&current.quote_until_ms>wall_ms()&&current.order[0]&&
        (!strcmp(current.status,"AWAITING_WALLET")||!strcmp(current.status,"AWAITING_PAYMENT"));
}
static void navigate(lv_event_t *e) {
    touch_send(T_NAV,(unsigned)(intptr_t)lv_event_get_user_data(e));
}
static void toggle_sound(lv_event_t *e) {
    (void)e;touch_send(T_SOUND,0);
}
static void toggle_motion(lv_event_t *e) {
    (void)e;touch_send(T_MOTION,0);
}
static void action(lv_obj_t *parent,const char *s,int x,int y,int width,
                   lv_event_cb_t callback,void *data,bool primary) {
    lv_obj_t *b=lv_button_create(parent);
    lv_obj_remove_style_all(b);
    lv_obj_set_pos(b,x,y);lv_obj_set_size(b,width,44);
    lv_obj_set_style_radius(b,9,0);
    lv_obj_set_style_bg_color(b,lv_color_hex(primary?ORANGE:PANEL),0);
    lv_obj_set_style_bg_opa(b,LV_OPA_COVER,0);
    lv_obj_set_style_border_color(b,lv_color_hex(LINE),0);
    lv_obj_set_style_border_width(b,primary?0:1,0);
    lv_obj_set_style_bg_color(b,lv_color_hex(primary?0xffbd7c:PURPLE),LV_STATE_PRESSED);
    lv_obj_add_event_cb(b,callback,LV_EVENT_CLICKED,data);
    lv_obj_t *l=label(b,s,0,0,width,&lv_font_montserrat_14);
    tint(l,primary?INK:0xfff5eb);
    lv_obj_set_style_text_align(l,LV_TEXT_ALIGN_CENTER,0);
    lv_obj_center(l);
}
static void close_menu(lv_event_t *e) {
    (void)e;touch_send(T_MENU,0);
}
static void toggle_menu(lv_event_t *e) {
    (void)e;touch_send(T_MENU,1);
}
static void menu_render(void) {
    pause_carousel();
    if(presentation.photo){presentation.photo=false;presentation.switched=lv_tick_get();page=0;render(false);}
    if(menu_shade){lv_obj_delete(menu_shade);menu_shade=NULL;return;}
    lv_obj_t *root=lv_screen_active();
    menu_shade=box(root,0,44,480,276,INK,0);
    lv_obj_set_style_bg_opa(menu_shade,LV_OPA_80,0);
    lv_obj_add_flag(menu_shade,LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(menu_shade,close_menu,LV_EVENT_CLICKED,NULL);
    lv_obj_t *panel=box(menu_shade,252,4,220,268,PANEL,12);
    lv_obj_add_flag(panel,LV_OBJ_FLAG_CLICKABLE);
    action(panel,"Home",8,8,204,navigate,(void *)(intptr_t)4,false);
    if(table.order_owner||table.saved.pending.kind||!table.synchronized)lv_obj_add_state(lv_obj_get_child(panel,0),LV_STATE_DISABLED);
    action(panel,"Bill",8,60,204,navigate,(void *)(intptr_t)1,false);
    action(panel,payable()?"Pay QR":!strcmp(current.status,"PAID")?"Receipt":"Status",
           8,112,204,navigate,(void *)(intptr_t)(payable()?2:3),payable());
    action(panel,bitpos_audio_is_muted()?"Sound: off":"Sound: on",8,164,204,toggle_sound,NULL,false);
    action(panel,reduced_motion?"Motion: reduced":"Motion: on",8,216,204,toggle_motion,NULL,false);
    if(!current.order[0]){lv_obj_add_state(lv_obj_get_child(panel,1),LV_STATE_DISABLED);lv_obj_add_state(lv_obj_get_child(panel,2),LV_STATE_DISABLED);}
    ESP_LOGI("BitPOS","BITPOS_MENU open=1");
}
static void hamburger(lv_obj_t *root) {
    lv_obj_t *button=lv_button_create(root);
    lv_obj_remove_style_all(button);
    lv_obj_set_pos(button,428,0);lv_obj_set_size(button,44,44);
    lv_obj_add_event_cb(button,toggle_menu,LV_EVENT_CLICKED,NULL);
    static const lv_point_precise_t points[]={{0,0},{20,0}};
    for(unsigned i=0;i<3;i++) {
        lv_obj_t *line=lv_line_create(button);
        lv_obj_remove_style_all(line);
        lv_line_set_points(line,points,2);
        lv_obj_set_pos(line,12,14+(int)i*7);
        lv_obj_set_style_line_width(line,2,0);
        lv_obj_set_style_line_color(line,lv_color_hex(0xfff5eb),0);
    }
}
/* Only presentation copies change; immutable parsed/on-wire payment facts stay
 * byte-for-byte intact. Legacy frozen outbox lines can predate ASCII cutover. */
static void bill_text(char *dst,const char *src) {
    while(*src) {
        if(!strncmp(src,"\xc3\x97",2)){*dst++='x';src+=2;}
        else if(!strncmp(src,"\xe2\x80\xa6",3)){memcpy(dst,"...",3);dst+=3;src+=3;}
        else *dst++=*src++;
    }
    *dst=0; /* Replacements never exceed the original bounded 95 bytes. */
}
static void clock_update(lv_timer_t *timer) {
    (void)timer;
    bool synced=atomic_load_explicit(&clock_synced,memory_order_acquire);
    time_t now=time(NULL), minute=now/60;
    if(synced&&ui.clock_minute!=minute) {
        /* Bangkok has no DST. Use UTC+7 without process-global TZ mutation. */
        time_t bangkok=now+7*60*60;
        struct tm local;
        gmtime_r(&bangkok,&local);
        strftime(ui.hh,sizeof(ui.hh),"%H",&local);
        strftime(ui.mm,sizeof(ui.mm),"%M",&local);
        strftime(ui.day,sizeof(ui.day),"%a %d %b  BKK",&local);
        ui.clock_minute=minute;
        lv_label_set_text_static(ui.hours,ui.hh);
        lv_label_set_text_static(ui.minutes,ui.mm);
        lv_label_set_text_static(ui.date,ui.day);
    }
    unsigned promo=(lv_tick_get()-ui.started)/8000%3;
    if(!reduced_motion&&promo!=ui.promo_index) {
        ui.promo_index=promo;
        lv_label_set_text_static(ui.promo,cafe_copy[promo]);
    }
    /* Optional GIF preparation is consumer-owned, never a timer/network/touch action. */
}
static void idle_gif_prepare(void) {
#if LV_USE_GIF && LV_GIF_CACHE_DECODE_DATA
    /* Existing media task has already validated and published immutable RAM
     * bytes through M:; this path never opens SD or introduces another loader. */
    if(!connected||!table.synchronized||table.cart_owner||table.order_owner||
       table.saved.pending.kind||table.needs_resume||table.view||presentation.entry||
       reduced_motion||uxQueueMessagesWaiting(inbox)||!bitpos_media_available())return;
    if(!display_engine_lock(0))return;
    if(ui.kind==UI_IDLE&&!ui.gif_attempted&&lv_tick_get()-ui.started>=750&&
       uxQueueMessagesWaiting(inbox)==0) {
        ui.gif_attempted=true;
        const size_t headroom=128*1024;
        bool room=heap_caps_get_free_size(MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT)>=2*headroom&&
                  heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT)>=headroom;
#if LV_USE_STDLIB_MALLOC == LV_STDLIB_BUILTIN
        lv_mem_monitor_t memory;lv_mem_monitor(&memory);
        room=room&&memory.free_size>=2*headroom&&memory.free_biggest_size>=headroom;
#endif
        const char *path=room?bitpos_media_gif_path():NULL;
        if(path) {
            ui.gif=lv_gif_create(ui.body);lv_gif_set_src(ui.gif,path);
            /* Approved GIF canvas is 128x128. Center it in the 148x174 card
             * (316,72), with an explicit origin pivot so scaling cannot shift
             * its visible content towards the bottom action strip. */
            lv_image_set_pivot(ui.gif,0,0);lv_image_set_scale(ui.gif,256);
            lv_obj_set_pos(ui.gif,326,95);
            if(!lv_gif_is_loaded(ui.gif)||!bitpos_media_prepare_canvas(ui.gif)){lv_obj_delete(ui.gif);ui.gif=NULL;}
            else {lv_obj_add_flag(ui.attract,LV_OBJ_FLAG_HIDDEN);lv_obj_add_flag(ui.orbit,LV_OBJ_FLAG_HIDDEN);}
        }
    }
    display_engine_unlock();
#endif
}
static void paid_frame(uint32_t elapsed) {
    if(elapsed>=2300) {
        ui.celebrating=false;
        lv_arc_set_rotation(ui.ring,0);
        lv_arc_set_angles(ui.ring,0,360);
        lv_obj_set_pos(ui.check,PAID_CHECK_X,PAID_CHECK_Y);
        for(unsigned i=0;i<12;i++)lv_obj_add_flag(ui.particles[i],LV_OBJ_FLAG_HIDDEN);
        return;
    }
    /* Ring sweep and subtle check settle never hide the meaningful PAID mark. */
    int sweep=elapsed<650?45+(315*(int)elapsed/650):360;
    lv_arc_set_angles(ui.ring,0,sweep);
    lv_arc_set_rotation(ui.ring,elapsed<650?(int)elapsed*180/650:0);
    lv_obj_set_pos(ui.check,PAID_CHECK_X,PAID_CHECK_Y+(elapsed<240?3-(int)elapsed*3/240:0));
    int radius=elapsed<1100?12+(36*(int)elapsed/1100):48;
    for(unsigned i=0;i<12;i++) {
        if(elapsed>=1800){lv_obj_add_flag(ui.particles[i],LV_OBJ_FLAG_HIDDEN);continue;}
        lv_obj_remove_flag(ui.particles[i],LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_pos(ui.particles[i],PAID_CENTER_X+particle_dx[i]*radius/100,
                       PAID_CENTER_Y+particle_dy[i]*radius/100);
        lv_obj_set_style_opa(ui.particles[i],elapsed<1100?LV_OPA_COVER:
                             (lv_opa_t)((1800-elapsed)*255/700),0);
    }
}
static void motion_tick(lv_timer_t *timer) {
    (void)timer;
    uint32_t now=lv_tick_get();
    if(ui.entering) {
        uint32_t elapsed=now-ui.navigation_started;
        if(elapsed>=200){ui.entering=false;lv_obj_set_x(ui.body,0);}
        else {
            int remaining=200-(int)elapsed;
            lv_obj_set_x(ui.body,20*remaining*remaining/40000);
        }
    }
    /* Clock/orbit and verification motion capped near 12fps, no per-frame
     * allocation, new widgets, string formatting, trig floats or media IO. */
    if(now-ui.last_motion<80)return;
    ui.last_motion=now;
    if(ui.kind==UI_IDLE&&!reduced_motion) {
        int angle=(int)((now-ui.started)%12000)*360/12000;
        if(!ui.gif) {
            lv_obj_set_pos(ui.orbit,386+lv_trigo_cos(angle)*62/32768,
                           132+lv_trigo_sin(angle)*62/32768);
        }
        lv_opa_t opacity=(lv_opa_t)(130+(lv_trigo_sin(angle*2)+32768)*125/65536);
        for(unsigned i=0;i<2;i++)lv_obj_set_style_opa(ui.colon[i],opacity,0);
    }
    if(ui.kind==UI_CONFIRMING&&!reduced_motion) {
        uint32_t elapsed=now-confirming_started;
        lv_arc_set_rotation(ui.ring,elapsed<30000?(int)(elapsed%1600)*360/1600:0);
        if(elapsed>=30000)lv_arc_set_angles(ui.ring,0,300);
    }
    if(ui.celebrating)paid_frame(now-ui.paid_started);
    bool perpetual=ui.kind==UI_IDLE||
                   (ui.kind==UI_CONFIRMING&&now-confirming_started<30000);
    if(!ui.entering&&!ui.celebrating&&!perpetual) {
        ui.motion_timer=NULL;
        lv_timer_delete(timer); /* LVGL supports deleting the executing timer. */
    }
}
static lv_obj_t *ring(lv_obj_t *parent,int x,int y,int size,bool full) {
    lv_obj_t *o=lv_arc_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o,LV_OBJ_FLAG_CLICKABLE|LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(o,x,y);lv_obj_set_size(o,size,size);
    lv_obj_set_style_arc_width(o,4,LV_PART_MAIN);
    lv_obj_set_style_arc_color(o,lv_color_hex(LINE),LV_PART_MAIN);
    lv_obj_set_style_arc_width(o,5,LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(o,lv_color_hex(ORANGE),LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(o,true,LV_PART_INDICATOR);
    lv_arc_set_bg_angles(o,0,360);
    lv_arc_set_angles(o,0,full?360:100);
    return o;
}
static void money(lv_obj_t *parent,int x,int y,int width) {
    label(parent,ui.amount,x,y,width,&lv_font_montserrat_20);
}

static void idle_tick(lv_timer_t *timer) {
    (void)timer;
    touch_t intent={T_IDLE,0,atomic_load(&touch_generation)};
    xQueueSend(touches,&intent,0); /* Optional timer never performs IO or rebuilds under LVGL. */
}
static void idle_advance(void) {
    if(atomic_load(&receiving)||uxQueueMessagesWaiting(inbox))return;
    uint32_t now=lv_tick_get();
    if(presentation.paused&&now-presentation.touched>=30000) {
        presentation.paused=false;presentation.switched=now;
        if(presentation.entry&&idle_eligible()&&!menu_shade){presentation.entry=false;presentation.photo=false;render(false);return;}
    }
    bool valid=catalog_valid(),eligible=idle_eligible();
    if(presentation.photo&&(!valid||!eligible||presentation.paused)) {
        presentation.photo=false;presentation.switched=now;page=0;render(false);return;
    }
    if(!eligible||presentation.paused||presentation.entry||menu_shade)return;
    /* Ownership is released only by an explicit accepted ORDER_DISMISS. */
    if(page!=0||!valid||now-presentation.switched<10000)return;
    if(presentation.photo) {
        presentation.photo=false;presentation.switched=now;
        if(!presentation.next_product)table.menu_advance=true;
        render(false);return;
    }
    for(unsigned i=0;i<table.rows_count;i++) {
        unsigned index=(presentation.next_product+i)%table.rows_count;
        if(!table.rows[index].available||table.rows[index].asset<0)continue;
        presentation.product=index;presentation.next_product=(index+1)%table.rows_count;
        presentation.photo=true;presentation.switched=now;render(false);return;
    }
}
static void table_touch(lv_event_t *e) {
    uintptr_t packed=(uintptr_t)lv_event_get_user_data(e);
    touch_send((int)(packed>>16),(unsigned)(packed&65535));
}
static void table_button(const char *s,int x,int y,int w,int intent,unsigned index,bool enabled) {
    action(ui.body,s,x,y,w,table_touch,(void *)(uintptr_t)(((unsigned)intent<<16)|index),intent==T_DISMISS);
    if(!enabled)lv_obj_add_state(lv_obj_get_child(ui.body,lv_obj_get_child_count(ui.body)-1),LV_STATE_DISABLED);
}
/* A plain canvas references caller-owned indexed pixels. Never give a static
 * buffer to lv_qrcode: its destructor frees the backing allocation. */
#include "src/libs/qrcode/qrcodegen.h"
#define ENTRY_QR_SIZE 208
LV_DRAW_BUF_DEFINE_STATIC(entry_bitmap,ENTRY_QR_SIZE,ENTRY_QR_SIZE,LV_COLOR_FORMAT_I1);
static char entry_cached[256];
static uint8_t entry_work[qrcodegen_BUFFER_LEN_FOR_VERSION(12)],entry_code[qrcodegen_BUFFER_LEN_FOR_VERSION(12)];
static unsigned entry_encodes;
static bool entry_qr(lv_obj_t *parent) {
    if(!table.table_entry_url[0]){entry_cached[0]=0;return false;}
    lv_obj_t *canvas=lv_canvas_create(parent);lv_obj_set_pos(canvas,12,83);
    if(strcmp(entry_cached,table.table_entry_url)){
        size_t length=strlen(table.table_entry_url);memcpy(entry_work,table.table_entry_url,length);
        if(!qrcodegen_encodeBinary(entry_work,length,entry_code,qrcodegen_Ecc_MEDIUM,1,12,qrcodegen_Mask_AUTO,true)){lv_obj_delete(canvas);entry_cached[0]=0;return false;}
        LV_DRAW_BUF_INIT_STATIC(entry_bitmap);lv_draw_buf_clear(&entry_bitmap,NULL);
        lv_canvas_set_draw_buf(canvas,&entry_bitmap);
        lv_canvas_set_palette(canvas,0,lv_color_to_32(lv_color_hex(0xffffff),LV_OPA_COVER));
        lv_canvas_set_palette(canvas,1,lv_color_to_32(lv_color_hex(0x15101e),LV_OPA_COVER));
        int modules=qrcodegen_getSize(entry_code),scale=ENTRY_QR_SIZE/(modules+8),margin=(ENTRY_QR_SIZE-modules*scale)/2;
        if(scale<2){lv_obj_delete(canvas);entry_cached[0]=0;return false;}
        uint8_t *pixels=(uint8_t *)entry_bitmap.data+8;
        for(int my=0;my<modules;my++)for(int mx=0;mx<modules;mx++)if(qrcodegen_getModule(entry_code,mx,my))
            for(int y=margin+my*scale;y<margin+(my+1)*scale;y++)for(int x=margin+mx*scale;x<margin+(mx+1)*scale;x++)pixels[y*entry_bitmap.header.stride+(x>>3)]|=(uint8_t)(0x80>>(x&7));
        strcpy(entry_cached,table.table_entry_url);entry_encodes++;
    }else lv_canvas_set_draw_buf(canvas,&entry_bitmap);
    lv_obj_remove_flag(canvas,LV_OBJ_FLAG_CLICKABLE);return true;
}
static void entry_scene(bool photo) {
    tint(label(ui.body,"Scan to order",12,55,236,&lv_font_montserrat_20),ORANGE);
    box(ui.body,8,79,216,216,0xffffff,4);
    bool ready=connected&&table.synchronized&&table.configured&&table.storage_ok&&!table.saved.pending.kind;
    if(!ready||!entry_qr(ui.body)){
        label(ui.body,!connected?"Offline\nReconnecting":table.saved.pending.kind?"Resolving\nsaved request":"Table QR\nnot ready",28,148,180,&lv_font_montserrat_20);
    }
    lv_obj_t *right=box(ui.body,236,79,232,216,PANEL,12);
    if(photo&&catalog_valid()){
        const table_row_t *p=&table.rows[presentation.product];const lv_image_dsc_t *image=p->asset>=0?bitpos_media_photo((unsigned)p->asset):NULL;
        if(image){lv_obj_t *art=lv_image_create(right);lv_image_set_src(art,image);lv_image_set_pivot(art,0,0);lv_image_set_scale(art,124);lv_obj_set_pos(art,0,0);}
        lv_obj_t *name=label(right,p->name,10,105,212,&bitpos_font_20);lv_label_set_long_mode(name,LV_LABEL_LONG_DOT);
        char price[64];table_format_money(&p->unit,price,sizeof(price));tint(label(right,price,10,135,212,&lv_font_montserrat_20),ORANGE);
    }else{
        strcpy(ui.hh,"--");strcpy(ui.mm,"--");strcpy(ui.day,"TIME UNSYNCED / BKK");
        ui.hours=label(right,ui.hh,14,18,90,&bitpos_clock_64);
        ui.minutes=label(right,ui.mm,123,18,90,&bitpos_clock_64);tint(ui.hours,ORANGE);tint(ui.minutes,ORANGE);
        ui.colon[0]=box(right,111,38,5,5,ORANGE,2);ui.colon[1]=box(right,111,62,5,5,ORANGE,2);
        ui.date=label(right,ui.day,14,94,204,&lv_font_montserrat_14);tint(ui.date,MUTED);
        ui.promo=label(right,cafe_copy[0],14,121,204,&lv_font_montserrat_14);ui.attract=ui.promo;
        ui.orbit=box(right,204,152,5,5,ORANGE,LV_RADIUS_CIRCLE);
        clock_update(NULL);ui.clock_timer=lv_timer_create(clock_update,1000,NULL);
    }
    tint(label(right,table.observed_cart?"Ordering on phone":ready?"Choose. Order. Enjoy.":"Please wait",14,171,204,&lv_font_montserrat_14),MUTED);
}
static void attract_scene(bool photo) {
    if(photo&&catalog_valid()){
        const table_row_t *p=&table.rows[presentation.product];
        const lv_image_dsc_t *image=p->asset>=0?bitpos_media_photo((unsigned)p->asset):NULL;
        if(!image){presentation.photo=false;attract_scene(false);return;}
        lv_obj_t *art=lv_image_create(ui.body);lv_image_set_src(art,image);lv_obj_set_pos(art,0,48);
        box(ui.body,0,225,480,95,INK,0);
        lv_obj_t *name=label(ui.body,p->name,20,232,282,&bitpos_font_20);lv_obj_set_height(name,28);lv_label_set_long_mode(name,LV_LABEL_LONG_DOT);
        char price[64];table_format_money(&p->unit,price,sizeof(price));
        lv_obj_t *amount=label(ui.body,price,300,232,160,&lv_font_montserrat_20);tint(amount,ORANGE);lv_obj_set_style_text_align(amount,LV_TEXT_ALIGN_RIGHT,0);
        if(p->promotion){char offer[40];if(p->percent)snprintf(offer,sizeof(offer),"%u%% OFF",p->percent);else strcpy(offer,"SPECIAL OFFER");box(ui.body,18,65,146,36,ORANGE,8);tint(label(ui.body,offer,28,73,132,&lv_font_montserrat_20),INK);}
    }else{
        strcpy(ui.hh,"--");strcpy(ui.mm,"--");strcpy(ui.day,"TIME UNSYNCED / BKK");
        ui.hours=label(ui.body,ui.hh,22,87,132,&bitpos_clock_64);ui.minutes=label(ui.body,ui.mm,164,87,132,&bitpos_clock_64);
        tint(ui.hours,ORANGE);tint(ui.minutes,ORANGE);
        ui.colon[0]=box(ui.body,148,104,6,6,ORANGE,3);ui.colon[1]=box(ui.body,148,132,6,6,ORANGE,3);
        ui.date=label(ui.body,ui.day,24,158,280,&lv_font_montserrat_14);tint(ui.date,MUTED);
        ui.promo=label(ui.body,cafe_copy[0],24,188,276,&lv_font_montserrat_20);
        lv_obj_set_height(ui.promo,54);lv_label_set_long_mode(ui.promo,LV_LABEL_LONG_WRAP);
        box(ui.body,316,72,148,174,PANEL,18);
        ui.attract=ring(ui.body,327,94,120,true);ui.orbit=box(ui.body,386,132,7,7,ORANGE,LV_RADIUS_CIRCLE);
        clock_update(NULL);ui.clock_timer=lv_timer_create(clock_update,1000,NULL);
    }
    box(ui.body,20,273,440,35,PANEL,12);
    lv_obj_t *hint=label(ui.body,"Tap anywhere to order",40,282,400,&lv_font_montserrat_14);lv_obj_set_style_text_align(hint,LV_TEXT_ALIGN_CENTER,0);tint(hint,MUTED);
}
static void bill_scene(void) {
    label(ui.body,!strcmp(current.status,"PAID")?"Paid receipt":"Your bill",20,60,236,&lv_font_montserrat_28);
    char count[32];snprintf(count,sizeof(count),"%u item%s",current.line_count,current.line_count==1?"":"s");
    lv_obj_t *count_label=label(ui.body,count,280,70,180,&lv_font_montserrat_14);
    lv_obj_set_style_text_align(count_label,LV_TEXT_ALIGN_RIGHT,0);
    lv_obj_t *list=box(ui.body,20,99,440,148,PANEL,12);
    lv_obj_add_flag(list,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_scroll_dir(list,LV_DIR_VER);
    lv_obj_set_scrollbar_mode(list,LV_SCROLLBAR_MODE_AUTO);
    for(unsigned i=0;i<current.item_count;i++) {
        bill_text(ui.bill[i],current.items[i]);
        const char *name=ui.bill[i];char quantity[12]="",more[96];
        char *end=NULL;unsigned long qty=strtoul(name,&end,10);
        if(end!=name&&qty<=100&&!strncmp(end," x ",3)) {
            snprintf(quantity,sizeof(quantity),"%lux",qty);name=end+3;
        } else if(!strncmp(name,"+ ",2)) {
            strcpy(quantity,"+");
            snprintf(more,sizeof(more),"%s on your phone",name+2);name=more;
        }
        lv_obj_t *badge=box(list,10,7+(int)i*48,48,34,INK,7);
        lv_obj_t *q=label(badge,quantity,0,6,48,&lv_font_montserrat_14);
        lv_obj_set_style_text_align(q,LV_TEXT_ALIGN_CENTER,0);
        lv_obj_t *row=label(list,name,72,9+(int)i*48,356,&bitpos_font_20);
        lv_obj_set_height(row,30);
        lv_label_set_long_mode(row,LV_LABEL_LONG_DOT); /* ASCII dot glyphs. */
    }
    if(!current.item_count)label(list,"View your order on your phone",10,10,416,&lv_font_montserrat_20);
    /* Wire is bounded: overflow stays explicit; the phone shows the full bill.
     * There are no item prices in this payload, so none are invented here. */
    tint(label(ui.body,"TOTAL",20,261,292,&lv_font_montserrat_14),MUTED);
    money(ui.body,20,284,292);
    action(ui.body,payable()?"Pay QR":!strcmp(current.status,"PAID")?"Receipt":"Status",
           328,262,132,navigate,(void *)(intptr_t)(payable()?2:3),payable());
}
static void qr_scene(void) {
    label(ui.body,"Scan to pay",20,82,220,&lv_font_montserrat_28);
    label(ui.body,"Open your camera.",20,125,225,&lv_font_montserrat_14);
    lv_obj_t *panel=box(ui.body,251,75,211,211,0xffffff,8);
    lv_obj_t *q=lv_qrcode_create(panel);
    lv_qrcode_set_size(q,190);lv_obj_set_pos(q,10,10);
    lv_qrcode_set_dark_color(q,lv_color_hex(INK));
    lv_qrcode_set_light_color(q,lv_color_white());
    if(lv_qrcode_update(q,current.qr,strlen(current.qr))!=LV_RESULT_OK) {
        lv_obj_delete(q);
        lv_obj_t *l=label(panel,"QR unavailable.\nView bill and retry.",10,72,191,&lv_font_montserrat_14);
        tint(l,INK);
    }
    lv_obj_t *order_label=label(ui.body,current.label,20,161,223,&bitpos_font_20);
    lv_obj_set_height(order_label,30);
    /* Keep every quoted amount digit; narrow QR-side region wraps explicitly. */
    lv_obj_t *amount=label(ui.body,ui.amount,20,203,223,&lv_font_montserrat_20);
    lv_label_set_long_mode(amount,LV_LABEL_LONG_WRAP);
    lv_obj_set_height(amount,50);
    table_button("Cancel",20,262,128,T_CANCEL,0,connected&&table.synchronized&&current.can_cancel&&!table.saved.pending.kind);
}
static void status_amount(void) {
    const lv_font_t *font=&lv_font_montserrat_32;
    /* Keep the complete canonical value visible even at the parser's maximum. */
    if(lv_text_get_width(ui.amount,(uint32_t)strlen(ui.amount),font,0)>324)
        font=&lv_font_montserrat_20;
    label(ui.body,ui.amount,138,139,324,font);
}
static void paid_scene(void) {
    ui.ring=ring(ui.body,STATUS_RING_X,STATUS_RING_Y,STATUS_RING_SIZE,true);
    lv_obj_set_style_bg_color(ui.ring,lv_color_hex(PANEL),0);
    lv_obj_set_style_bg_opa(ui.ring,LV_OPA_COVER,0);
    lv_obj_set_style_radius(ui.ring,LV_RADIUS_CIRCLE,0);
    ui.check=lv_line_create(ui.body);
    lv_obj_remove_style_all(ui.check);
    lv_line_set_points(ui.check,check_points,3);
    lv_obj_set_pos(ui.check,PAID_CHECK_X,PAID_CHECK_Y);
    lv_obj_set_style_line_width(ui.check,5,0);
    lv_obj_set_style_line_rounded(ui.check,true,0);
    lv_obj_set_style_line_color(ui.check,lv_color_hex(ORANGE),0);
    /* Slots exist BEFORE flush/ACK, but are invisible until durable claim. */
    for(unsigned i=0;i<12;i++) {
        ui.particles[i]=box(ui.body,PAID_CENTER_X,PAID_CENTER_Y,i%2?4:6,4,i%3?ORANGE:0xbe87ed,2);
        lv_obj_add_flag(ui.particles[i],LV_OBJ_FLAG_HIDDEN);
    }
    label(ui.body,"Payment received",138,104,324,&lv_font_montserrat_20);
    status_amount();
    box(ui.body,20,244,440,62,PANEL,10);
    tint(label(ui.body,"YOUR ORDER",32,252,280,&lv_font_montserrat_14),MUTED);
    if(current.item_count)bill_text(ui.bill[0],current.items[0]);
    lv_obj_t *summary=label(ui.body,current.item_count?ui.bill[0]:"Paid receipt",32,273,280,&bitpos_font_20);
    lv_obj_set_height(summary,25);lv_label_set_long_mode(summary,LV_LABEL_LONG_DOT);
    table_button("Done",332,252,116,T_DISMISS,0,connected&&table.can_dismiss&&!table.saved.pending.kind);
}
static void confirming_scene(void) {
    ui.ring=ring(ui.body,STATUS_RING_X,STATUS_RING_Y,STATUS_RING_SIZE,false);
    label(ui.body,"Confirming payment",138,104,324,&lv_font_montserrat_20);
    status_amount();
    tint(label(ui.body,"Almost there...",138,184,324,&lv_font_montserrat_14),MUTED);
    box(ui.body,20,244,440,62,PANEL,10);
    tint(label(ui.body,"Please wait. Do not pay again.",32,264,416,&lv_font_montserrat_14),ORANGE);
}
static void problem_scene(void) {
    const char *title, *message;
    if(ui.kind==UI_OFFLINE) {
        title="Reconnecting";
        message="Your bill stays safe.";
    } else if(ui.kind==UI_EXPIRED) {
        title="This bill has expired";
        message="Ask the cafe team for a new bill.";
    } else {
        title="Please ask the cafe team";
        message="We are checking this payment. Do not pay again.";
    }
    label(ui.body,title,18,87,444,&lv_font_montserrat_28);
    label(ui.body,message,18,140,444,&lv_font_montserrat_14);
    money(ui.body,18,241,444);
}
static void render(bool navigation) {
    stop_scene(); /* Idle GIF is paused/destroyed BEFORE payment-critical flush. */
    lv_obj_t *root=lv_screen_active();
    lv_obj_set_style_bg_color(root,lv_color_hex(INK),0);
    lv_obj_set_style_pad_all(root,0,0);
    lv_obj_remove_flag(root,LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(root,LV_OBJ_FLAG_CLICKABLE);
    /* Screen persists across stop_scene(); install this callback only once. */
    static bool root_touch_installed;
    if(!root_touch_installed){lv_obj_add_event_cb(root,photo_touch,LV_EVENT_CLICKED,NULL);root_touch_installed=true;}
    /* Existing transparent product artwork, downscaled without recoloring. */
    box(root,0,0,480,44,INK,0);
    box(root,12,4,96,36,0xfff8f0,8);
    lv_obj_t *logo=lv_image_create(root);
    lv_image_set_src(logo,&bitpos_logo);
    lv_image_set_pivot(logo,0,0);
    lv_obj_set_pos(logo,18,8);
    lv_image_set_scale(logo,170);
    tint(label(root,connected?(table.synchronized?"DEVNET":"SYNCING"):"OFFLINE",316,15,104,&lv_font_montserrat_14),MUTED);
    const char *serving=current.order[0]?current.label:table.serving;
    char short_place[96];unsigned fixture_table;int matched=0;
    if(sscanf(serving,"Devnet demo table %u%n",&fixture_table,&matched)==1&&serving[matched]=='\0'){
        snprintf(short_place,sizeof(short_place),"Table %u",fixture_table);serving=short_place;
    }
    lv_obj_t *place=label(root,serving,116,8,188,&bitpos_font_20);lv_obj_set_height(place,28);lv_label_set_long_mode(place,LV_LABEL_LONG_DOT);
    hamburger(root);
    ui.body=box(root,0,0,480,320,INK,0);
    lv_obj_set_style_bg_opa(ui.body,LV_OPA_TRANSP,0);
    /* Body is behind header controls, so controls stay hit-testable/unchanged. */
    lv_obj_move_to_index(ui.body,0);
    ui.started=lv_tick_get();
    table_format_money(&current.total,ui.amount,sizeof(ui.amount));
    if(!current.order[0]){
        bool entry=presentation.entry||table.observed_cart||table.saved.pending.kind||table.needs_resume;
        ui.kind=entry?UI_ENTRY:presentation.photo&&catalog_valid()?UI_PHOTO:UI_IDLE;
        bitpos_audio_set_attract(idle_eligible()&&!entry&&!presentation.paused&&!menu_shade);
        if(entry)entry_scene(false);else attract_scene(ui.kind==UI_PHOTO);
        if(ui.kind==UI_IDLE&&!reduced_motion)ui.motion_timer=lv_timer_create(motion_tick,40,NULL);
        return;
    }
    bitpos_audio_set_attract(false);
    if(!connected||(!table.synchronized&&(!strcmp(current.status,"AWAITING_WALLET")||!strcmp(current.status,"AWAITING_PAYMENT")))||
        ((!strcmp(current.status,"AWAITING_WALLET")||!strcmp(current.status,"AWAITING_PAYMENT"))&&!payable()))ui.kind=UI_OFFLINE;
    else if(page==1)ui.kind=UI_BILL;
    else if(!strcmp(current.status,"PAID"))ui.kind=UI_PAID;
    else if(!strcmp(current.status,"CONFIRMING"))ui.kind=UI_CONFIRMING;
    else if(!strcmp(current.status,"EXPIRED"))ui.kind=UI_EXPIRED;
    else if(!strcmp(current.status,"RECOVERY"))ui.kind=UI_RECOVERY;
    else ui.kind=UI_QR;
    switch(ui.kind) {
        case UI_IDLE:entry_scene(false);break;
        case UI_PHOTO:entry_scene(true);break;
        case UI_BILL:bill_scene();break;
        case UI_QR:qr_scene();break;
        case UI_PAID:paid_scene();break;
        case UI_CONFIRMING:confirming_scene();break;
        default:problem_scene();break;
    }
    /* Critical events have NO entrance transition. Only touch navigation eases
     * 20px to rest in 200ms. Reduced motion is instant, without animated GIF. */
    ui.entering=navigation&&!reduced_motion&&ui.kind!=UI_PHOTO;
    ui.navigation_started=ui.started;
    if(ui.entering)lv_obj_set_x(ui.body,20);
    if(!reduced_motion&&(ui.entering||ui.kind==UI_IDLE||ui.kind==UI_CONFIRMING))
        ui.motion_timer=lv_timer_create(motion_tick,40,NULL);
}
static bool physical_render(void) {
    if(!display_engine_lock(2000))return false;
    int64_t started=esp_timer_get_time();
    uint32_t before=display_engine_get_flush_count();render(false);lv_obj_invalidate(lv_screen_active());
    lv_refr_now(display_engine_get_disp());bool ok=display_engine_get_flush_count()!=before;
    last_flush_ms=(uint32_t)((esp_timer_get_time()-started)/1000);
    display_engine_unlock();if(ok)ccp_board_set_brightness(85);return ok;
}
static bool log_id(const char *s);
static bool claim_paid(const order_t *o) {
    if(strcmp(o->status,"PAID"))return false;
    unsigned char hash[32];mbedtls_sha256((const unsigned char *)o->order,strlen(o->order),hash,0);
    char key[16];snprintf(key,sizeof(key),"p%02x%02x%02x%02x%02x%02x%02x",hash[0],hash[1],hash[2],hash[3],hash[4],hash[5],hash[6]);
    uint32_t prior;
    esp_err_t found=nvs_get_u32(state_nvs,key,&prior);
    if(found==ESP_OK) {
        if(log_id(o->order))ESP_LOGI("BitPOS","BITPOS_SOUND_SUPPRESSED order=%s reason=dedup",o->order);
        return false;
    }
    if(found!=ESP_ERR_NVS_NOT_FOUND)return false;
    /* Preserve existing key format/history. One durable claim gates BOTH
     * motion and sound. Snapshots claim silently; storage failure is silent.
     * A reset may lose an optional effect, but can never replay a claimed one. */
    return nvs_set_u32(state_nvs,key,o->version)==ESP_OK&&nvs_commit(state_nvs)==ESP_OK;
}
static bool log_id(const char *s) {
    for(;*s;s++)if(!isalnum((unsigned char)*s)&&*s!='-'&&*s!='_')return false;
    return true;
}
#include "bitpos_table_runtime.inc"
/* WebSocket callbacks only assemble bounded text and enqueue; never touch LVGL/NVS/audio. */
static void ws_event(void *arg,esp_event_base_t base,int32_t id,void *data) {
    (void)arg;(void)base;
    static message_t assembly;static table_fragment_t fragment;
    if(id==WEBSOCKET_EVENT_CONNECTED||id==WEBSOCKET_EVENT_DISCONNECTED||id==WEBSOCKET_EVENT_ERROR||id==WEBSOCKET_EVENT_CLOSED) {
        assembly.kind=id==WEBSOCKET_EVENT_CONNECTED?1:2;
        if(xQueueSend(inbox,&assembly,0)!=pdTRUE)atomic_store(&resync,true);
        memset(&fragment,0,sizeof(fragment));atomic_store(&receiving,false);return;
    }
    if(id!=WEBSOCKET_EVENT_DATA)return;
    esp_websocket_event_data_t *e=data;
    int result=table_fragment(&fragment,assembly.json,e->op_code,e->fin,e->payload_len,e->payload_offset,e->data_ptr,e->data_len);
    atomic_store(&receiving,fragment.active);
    if(result<0){atomic_store(&resync,true);return;}
    if(result==1) {
        assembly.kind=0;assembly.received_us=esp_timer_get_time();
        if(xQueueSend(inbox,&assembly,0)!=pdTRUE)atomic_store(&resync,true);
    }
}
static void wifi_event(void *arg,esp_event_base_t base,int32_t id,void *data) {
    if(base==WIFI_EVENT&&(id==WIFI_EVENT_STA_START||id==WIFI_EVENT_STA_DISCONNECTED))esp_wifi_connect();
    if(base==IP_EVENT&&id==IP_EVENT_STA_GOT_IP&&!esp_websocket_client_is_connected(socket_client))esp_websocket_client_start(socket_client);
    if(base==WIFI_EVENT&&id==WIFI_EVENT_STA_DISCONNECTED)atomic_store(&resync,true);
}
static bool config_string(nvs_handle_t n,const char *key,char *out,size_t cap) {return nvs_get_str(n,key,out,&cap)==ESP_OK&&out[0];}
static void time_synchronized(struct timeval *tv) {
    /* Only SNTP's successful completion callback enables real local time.
     * A power-on epoch, order timestamp or RTC guess is never shown as live. */
    if(tv&&tv->tv_sec>=1704067200)
        atomic_store_explicit(&clock_synced,true,memory_order_release);
}
static void optional_startup(void *arg) {
    (void)arg;
    /* No SD/I2S startup on the consumer/LVGL/WS path or before baseline. */
    bitpos_audio_init();
    bitpos_media_init();
    vTaskDelete(NULL);
}
void app_main(void) {
    /* Transport libraries can log request URIs; device tokens must never enter logs. */
    esp_log_level_set("*",ESP_LOG_NONE);
    esp_log_level_set("BitPOS",ESP_LOG_INFO);
    esp_log_level_set("BitPOSMedia",ESP_LOG_INFO);
    uint8_t mac[6];ESP_ERROR_CHECK(esp_read_mac(mac,ESP_MAC_WIFI_STA));
    ESP_LOGI("BitPOS","BOOT product=bitpos_terminal version=%s mac=%02x:%02x:%02x:%02x:%02x:%02x",esp_app_get_description()->version,mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
    /* Never erase NVS on errors: preserving original/private state beats an automatic reset. */
    ESP_ERROR_CHECK(nvs_flash_init_partition("bitpos_nvs"));
    ESP_ERROR_CHECK(nvs_open_from_partition("bitpos_nvs","state",NVS_READWRITE,&state_nvs));
    ESP_ERROR_CHECK(ccp_board_init());ESP_ERROR_CHECK(display_engine_start());
    bitpos_probe_init(); /* Optional read-only pixels; before any app consumers. */
    touches=xQueueCreate(12,sizeof(touch_t));configASSERT(touches);
    /* JSON payloads are task-only, not DMA/ISR data; preserve internal RAM for WiFi. */
    static StaticQueue_t inbox_control;
    uint8_t *inbox_storage=heap_caps_malloc(8*sizeof(message_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    configASSERT(inbox_storage);
    inbox=xQueueCreateStatic(8,sizeof(message_t),inbox_storage,&inbox_control);
    configASSERT(inbox);physical_render();
    if(display_engine_lock(2000)) {
        presentation.switched=lv_tick_get();
        lv_timer_create(idle_tick,250,NULL); /* Boot lifetime, outside ui memset. */
        for(lv_indev_t *input=lv_indev_get_next(NULL);input;input=lv_indev_get_next(input))
            lv_indev_add_event_cb(input,any_touch,LV_EVENT_PRESSED,NULL);
        display_engine_unlock();
    }
    xTaskCreate(consumer,"terminal",16384,NULL,5,NULL);
    xTaskCreate(optional_startup,"optional_media",8192,NULL,3,NULL);
    nvs_handle_t n; if(nvs_open_from_partition("bitpos_nvs","config",NVS_READONLY,&n)!=ESP_OK)return;
    char ssid[33],password[65],endpoint[URL_MAX];static char authorization[256];
    bool ok=config_string(n,"ssid",ssid,sizeof(ssid))&&config_string(n,"password",password,sizeof(password))&&config_string(n,"ws_url",endpoint,sizeof(endpoint))
      &&config_string(n,"merchant",merchant,sizeof(merchant))&&config_string(n,"terminal",terminal,sizeof(terminal));nvs_close(n);
    /* Migrate existing private query credential in RAM only; no v1 runtime,
     * config rewrite, token in URI/log, or client-selected device authority. */
    char *query=strchr(endpoint,'?'),token[193]={0};
    if(ok&&query) {
        char *cursor=query+1;
        while(*cursor){char *end=strchr(cursor,'&');if(!end)end=cursor+strlen(cursor);
            if((size_t)(end-cursor)>6&&!strncmp(cursor,"token=",6)){
                size_t len=(size_t)(end-cursor-6);if(len>=sizeof(token))ok=false;
                else {memcpy(token,cursor+6,len);token[len]=0;}}
            if(!*end)break;
            cursor=end+1;
        }*query=0;
    }
    for(unsigned i=0;token[i];i++)if(!isalnum((unsigned char)token[i])&&token[i]!='-'&&token[i]!='_')ok=false;
    /* Move the previously pinned LAN installation to its authenticated public
     * transport without rewriting NVS or clearing paid-event dedup history. */
    if(ok&&!strcmp(endpoint,"ws://192.168.1.34:3001/api/device"))
        snprintf(endpoint,sizeof(endpoint),"wss://device.cashlessthailand.com/api/device");
    if(!ok||!token[0]||(strncmp(endpoint,"wss://",6)&&strcmp(endpoint,"ws://192.168.1.34:3001/api/device")))return;
    snprintf(authorization,sizeof(authorization),"Authorization: Bearer %s\r\n",token);memset(token,0,sizeof(token));
    esp_websocket_client_config_t ws={.uri=endpoint,.headers=authorization,.crt_bundle_attach=esp_crt_bundle_attach,.reconnect_timeout_ms=3000,.network_timeout_ms=5000,.buffer_size=2048,.disable_auto_reconnect=false,.enable_close_reconnect=true};
    socket_client=esp_websocket_client_init(&ws);if(!socket_client)return;
    esp_websocket_register_events(socket_client,WEBSOCKET_EVENT_ANY,ws_event,NULL);
    ESP_ERROR_CHECK(esp_netif_init());ESP_ERROR_CHECK(esp_event_loop_create_default());esp_netif_create_default_wifi_sta();
    esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
    esp_sntp_setservername(0,"pool.ntp.org");
    esp_sntp_set_time_sync_notification_cb(time_synchronized);
    esp_sntp_init(); /* Asynchronous; never wait for time to render/pay. */
    ESP_LOGI("BitPOS","BITPOS_MEMORY internal_free=%lu internal_largest=%lu inbox_psram_bytes=%lu",
             (unsigned long)heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
             (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
             (unsigned long)(8*sizeof(message_t)));
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    wifi_config_t cfg={0};memcpy(cfg.sta.ssid,ssid,strlen(ssid));memcpy(cfg.sta.password,password,strlen(password));
    cfg.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK;cfg.sta.pmf_cfg.capable=true;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&cfg));memset(password,0,sizeof(password));
    ESP_ERROR_CHECK(esp_wifi_start());
    /* Mains-powered counter display: modem sleep adds DTIM latency to render events. */
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
}
