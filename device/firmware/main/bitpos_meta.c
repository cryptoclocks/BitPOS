/* Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
 *
 * BitPOS Mini · Meta product (bitpos_terminal_meta, CONFIG_BITPOS_PRODUCT_META). Same board, display engine and
 * WiFi credentials as the standard terminal, but no ordering WebSocket and no crypto: every 2 seconds the device
 * asks the Meta server (HTTPS, cert bundle) which screen to show — idle, tap, Stripe QR for a counter bill, waiting,
 * paid, booking countdown, seated — and renders one server-described template (design/figcraft-meta B01–B11).
 * The server decides; the device never computes prices, payment state or bookings.
 *
 * Settings live in the bitpos_nvs partition under a separate "meta" namespace (url, device, key). The standard
 * "config"/"state" namespaces are only read (WiFi) and never written. Provision over USB with one line:
 *   META_PROVISION <https-origin> <device-uuid> <device-key>
 * The key is never logged. Text must stay within the device font (ASCII and Thai); the server keeps to that. "META_STATUS" prints whether settings exist; "META_FORGET" erases the meta namespace.
 * Layout checks: "META_DEMO <qr|paid|checkin|upcoming|seated|tapnew|idle>" shows a sample screen for 30 s, and
 * "META_SHOT" prints the rendered 480x320 RGB565 frame as hex rows (only what is on screen; no settings), and
 * "META_JOIN" acts like pressing the "scan QR" button.
 * Offer animations: on the idle and welcome screens the server may name a 240 px looping GIF ("anim", a same-origin
 * /meta/anim/... path). The device downloads it once into PSRAM (at most ANIM_MAX bytes, must start with GIF8) and plays
 * it with lv_gif; the text moves to the right. A failed download just leaves the plain screen. Playback follows the Sol
 * terminal's proven path (bitpos_media.c): the GIF is opened by path through a read-only in-memory lv_fs drive ('A:'),
 * shown as a plain image (no rounded clip), and dropped if lv_gif did not load it. */
#include <string.h>
#include <stdio.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include "esp_app_desc.h"
#include "esp_system.h"
#include "esp_heap_caps.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "lvgl.h"
#include "display_engine.h"
#include "ccp_board.h"
#include "bitpos_meta.h"

LV_FONT_DECLARE(bitpos_font_20);
static const char *TAG="BitPOSMeta";
#define URL_MAX 160
#define ID_MAX 40
#define KEY_MAX 64
#define BODY_MAX 2048
#define ANIM_PATH_MAX 128
#define ANIM_MAX (900*1024)
static char meta_url[URL_MAX],meta_device[ID_MAX],meta_key[KEY_MAX];
static volatile bool wifi_up;
static struct {char screen[16],tone[10],table[40],title[96],line1[128],line2[128],big[24],qr[200],anim[ANIM_PATH_MAX];int countdown;int poll_ms;int64_t fetched_us;bool online;} view;
static lv_obj_t *countdown_label;
static volatile int64_t demo_until_us; /* META_DEMO holds the screen until then */
/* "Scan to open Messenger": a short-lived link from POST /meta/device/qr, shown until it expires or Back is pressed.
 * Touch handlers only set flags and wake the poller; all HTTP happens on the poller task. */
static char join_url[200];static volatile int64_t join_until_us;static volatile bool join_wanted,join_close;
static TaskHandle_t poller_task;static lv_obj_t *join_countdown;
/* The downloaded animation (PSRAM) and the path it came from; the image descriptor points into anim_buf. */
static uint8_t *anim_buf;static size_t anim_len;static char anim_loaded[ANIM_PATH_MAX];
/* Read-only lv_fs drive 'A:' over anim_buf (one open file at a time), as bitpos_media.c does for the Sol GIFs. */
static lv_fs_drv_t anim_fs;static uint32_t anim_cursor;static bool anim_open;
static void *anim_fs_open(lv_fs_drv_t *d,const char *path,lv_fs_mode_t mode){(void)d;(void)path;if(mode!=LV_FS_MODE_RD||!anim_buf||anim_open)return NULL;anim_open=true;anim_cursor=0;return &anim_cursor;}
static lv_fs_res_t anim_fs_close(lv_fs_drv_t *d,void *f){(void)d;if(f!=&anim_cursor)return LV_FS_RES_INV_PARAM;anim_open=false;return LV_FS_RES_OK;}
static lv_fs_res_t anim_fs_read(lv_fs_drv_t *d,void *f,void *buf,uint32_t n,uint32_t *r){(void)d;*r=0;
    if(f!=&anim_cursor||n>anim_len-anim_cursor){memset(buf,0,n);return LV_FS_RES_FS_ERR;} /* gifdec ignores errors: never leave garbage */

    memcpy(buf,anim_buf+anim_cursor,n);anim_cursor+=n;*r=n;return LV_FS_RES_OK;}
static lv_fs_res_t anim_fs_seek(lv_fs_drv_t *d,void *f,uint32_t off,lv_fs_whence_t w){(void)d;if(f!=&anim_cursor)return LV_FS_RES_INV_PARAM;
    int64_t pos=w==LV_FS_SEEK_SET?(int64_t)off:w==LV_FS_SEEK_CUR?(int64_t)anim_cursor+(int32_t)off:w==LV_FS_SEEK_END?(int64_t)anim_len+(int32_t)off:-1;
    if(pos<0||pos>(int64_t)anim_len)return LV_FS_RES_INV_PARAM;
    anim_cursor=(uint32_t)pos;return LV_FS_RES_OK;}
static lv_fs_res_t anim_fs_tell(lv_fs_drv_t *d,void *f,uint32_t *pos){(void)d;if(f!=&anim_cursor)return LV_FS_RES_INV_PARAM;*pos=anim_cursor;return LV_FS_RES_OK;}
static void anim_fs_register(void){
    if(anim_fs.letter)return;

    lv_fs_drv_init(&anim_fs);anim_fs.letter='A';anim_fs.cache_size=0;anim_fs.open_cb=anim_fs_open;anim_fs.close_cb=anim_fs_close;
    anim_fs.read_cb=anim_fs_read;anim_fs.seek_cb=anim_fs_seek;anim_fs.tell_cb=anim_fs_tell;lv_fs_drv_register(&anim_fs);
}

/* Same visual language as the standard terminal (main.c): dark ink background, panel cards, a light logo pill in a
 * 44 px header, one accent colour. The Meta product uses Meta blue as its accent; the server's tone picks the accent
 * of the status ring (paid green, check-in red, booking violet, welcome blue). */
LV_IMAGE_DECLARE(bitpos_logo);
#define THAI_PAD 5
/* LVGL draws Thai marks without shaping, so a tone mark on an upper vowel (ที่, นี่) lands on the vowel and vanishes.
 * text() swaps such pairs to tone mark + vowel (drawing order of zero-width marks does not matter), and this font
 * raises a tone mark that is followed by an upper vowel so it sits above it. Everything else is bitpos_font_20 unchanged. */
static lv_font_t thai_font;
static bool thai_glyph(const lv_font_t *f,lv_font_glyph_dsc_t *g,uint32_t letter,uint32_t next){
    /* The label loop asks for each glyph's width with the next letter, then draws it with next=0 (lv_draw_label.c),
     * both on the LVGL task: remember a tone mark seen before an upper vowel and raise it on that draw. */
    static uint32_t raise;
    bool ok=lv_font_get_glyph_dsc_fmt_txt(f,g,letter,next);
    bool tone=letter>=0x0E48&&letter<=0x0E4C,upper=next==0x0E31||(next>=0x0E34&&next<=0x0E37)||next==0x0E47||next==0x0E4D;
    if(next){raise=tone&&upper?letter:0;if(ok&&raise)g->ofs_y+=6;}
    else if(tone&&letter==raise){raise=0;if(ok)g->ofs_y+=6;}
    return ok;
}
static const lv_font_t *thai(void){
    if(!thai_font.get_glyph_dsc){thai_font=bitpos_font_20;thai_font.get_glyph_dsc=thai_glyph;}
    return &thai_font;
}
enum { INK=0x0b1020, PANEL=0x18213a, LINE=0x2a3656, CREAM=0xf5f7ff, MUTED=0xa9b4cc, BLUE=0x3d8bff };
static uint32_t accent(const char *t){
    if(!strcmp(t,"green"))return 0x31c48d;
    if(!strcmp(t,"red"))return 0xff5a6a;
    if(!strcmp(t,"violet"))return 0xa98bff;
    if(!strcmp(t,"amber"))return 0xffb547;
    return BLUE;
}
static const char *icon(const char *screen){
    if(!strcmp(screen,"paid")||!strcmp(screen,"seated"))return LV_SYMBOL_OK;
    if(!strcmp(screen,"check_in")||!strcmp(screen,"upcoming"))return LV_SYMBOL_BELL;
    if(!strcmp(screen,"welcome"))return LV_SYMBOL_HOME;
    if(!strcmp(screen,"tap_new"))return LV_SYMBOL_RIGHT;
    return LV_SYMBOL_WIFI;
}
static lv_obj_t *box(lv_obj_t *parent,int x,int y,int w,int h,uint32_t color,int radius){
    lv_obj_t *o=lv_obj_create(parent);lv_obj_remove_style_all(o);lv_obj_remove_flag(o,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,h);lv_obj_set_style_bg_color(o,lv_color_hex(color),0);lv_obj_set_style_bg_opa(o,LV_OPA_COVER,0);
    lv_obj_set_style_radius(o,radius,0);return o;
}
/* A label cut to `lines` lines of its font with an ellipsis, so long server text never overlaps. */
/* UTF-8 Thai: upper vowel (U+0E31, U+0E34-0E37, U+0E47, U+0E4D) then tone mark (U+0E48-0E4C) -> tone mark first. */
static void thai_order(char *t){
    for(uint8_t *p=(uint8_t *)t;p[0]&&p[1]&&p[2];p++){
        if(p[0]!=0xE0||!p[3]||p[3]!=0xE0||p[4]!=0xB9||p[5]<0x88||p[5]>0x8C)continue;
        uint16_t v=(uint16_t)(p[1]<<8|p[2]);
        if(v==0xB8B1||(v>=0xB8B4&&v<=0xB8B7)||v==0xB987||v==0xB98D){uint8_t a=p[1],b=p[2];p[1]=0xB9;p[2]=p[5];p[4]=a;p[5]=b;p+=5;}
    }
}
static lv_obj_t *text(lv_obj_t *parent,const char *s,int x,int y,int w,const lv_font_t *font,uint32_t color,int lines){
    lv_obj_t *l=lv_label_create(parent);lv_obj_remove_style_all(l);
    if(font==&bitpos_font_20){char t[256];snprintf(t,sizeof(t),"%s",s);thai_order(t);lv_label_set_text(l,t);}else lv_label_set_text(l,s);lv_obj_set_style_text_color(l,lv_color_hex(color),0);lv_obj_set_width(l,w);lv_obj_set_pos(l,x,y);
    /* Thai tone marks stacked on an upper vowel (ที่, นี่) rise above the line box; give them room instead of clipping. */
    if(font==&bitpos_font_20)font=thai();
    lv_obj_set_style_text_font(l,font,0);
    int pad=font==&thai_font?THAI_PAD:0;lv_obj_set_style_pad_top(l,pad,0);if(pad)lv_obj_set_y(l,y-pad);
    if(lines>0){lv_obj_set_height(l,lines*lv_font_get_line_height(font)+pad);lv_label_set_long_mode(l,LV_LABEL_LONG_DOT);}
    else lv_label_set_long_mode(l,LV_LABEL_LONG_CLIP);
    return l;
}

/* Height a wrapped label needs, at most `lines` lines; the label is cut there with an ellipsis. */
static int fit(lv_obj_t *l,int lines){
    lv_label_set_long_mode(l,LV_LABEL_LONG_WRAP);lv_obj_set_height(l,LV_SIZE_CONTENT);lv_obj_update_layout(l);
    const lv_font_t *f=lv_obj_get_style_text_font(l,0);int max=lines*lv_font_get_line_height(f)+(f==&thai_font?THAI_PAD:0),h=lv_obj_get_height(l);
    if(h>max){h=max;lv_obj_set_height(l,h);lv_label_set_long_mode(l,LV_LABEL_LONG_DOT);}
    return h;
}
static void on_join(lv_event_t *e){(void)e;join_wanted=true;if(poller_task)xTaskNotifyGive(poller_task);}
static void on_back(lv_event_t *e){(void)e;join_close=true;if(poller_task)xTaskNotifyGive(poller_task);}
/* Screens where a customer may start: offer the QR button there (never over a bill, payment or booking countdown). */
static bool join_allowed(void){return !strcmp(view.screen,"idle")||!strcmp(view.screen,"welcome")||!strcmp(view.screen,"tap_new")||!strcmp(view.screen,"seated");}
static bool joining(void){return join_url[0]&&esp_timer_get_time()<join_until_us&&join_allowed();}
static lv_obj_t *button(lv_obj_t *parent,int x,int y,int w,const char *label,uint32_t color,lv_event_cb_t cb){
    lv_obj_t *b=box(parent,x,y,w,46,color,12);lv_obj_add_flag(b,LV_OBJ_FLAG_CLICKABLE);lv_obj_set_ext_click_area(b,8);
    lv_obj_set_style_bg_opa(b,LV_OPA_80,LV_STATE_PRESSED);lv_obj_add_event_cb(b,cb,LV_EVENT_CLICKED,NULL);
    lv_obj_t *t=text(b,label,14,8,w-28,&bitpos_font_20,0xffffff,1);lv_obj_set_style_text_align(t,LV_TEXT_ALIGN_CENTER,0);
    return b;
}
static void join_left(lv_obj_t *l){
    int left=(int)((join_until_us-esp_timer_get_time())/1000000);if(left<0)left=0;
    if(left>999){left=999;}
    char s[64];snprintf(s,sizeof(s),"QR หมดอายุใน %d:%02d",left/60,left%60);lv_label_set_text(l,s);
}

/* One template for every screen; layout depends only on which fields the server sent. Call with the LVGL lock. */
static void render(void){
    lv_obj_t *scr=lv_screen_active();lv_obj_clean(scr);countdown_label=NULL;join_countdown=NULL;
    lv_obj_set_style_bg_color(scr,lv_color_hex(INK),0);lv_obj_set_style_bg_opa(scr,LV_OPA_COVER,0);
    lv_obj_set_style_pad_all(scr,0,0);lv_obj_remove_flag(scr,LV_OBJ_FLAG_SCROLLABLE);
    uint32_t tone=accent(view.online?view.tone:"amber");
    /* Header: logo pill, table, connection. */
    box(scr,12,4,96,36,0xfff8f0,8);
    lv_obj_t *logo=lv_image_create(scr);lv_image_set_src(logo,&bitpos_logo);lv_image_set_pivot(logo,0,0);lv_obj_set_pos(logo,18,8);lv_image_set_scale(logo,170);
    text(scr,view.table[0]?view.table:"BitPOS x Muse",120,8,200,&bitpos_font_20,CREAM,1);
    box(scr,352,18,8,8,view.online?0x31c48d:0xffb547,LV_RADIUS_CIRCLE);
    text(scr,view.online?"ONLINE":"OFFLINE",366,13,104,&lv_font_montserrat_14,MUTED,0);
    if(!view.online){
        lv_obj_t *r=box(scr,32,93,86,86,PANEL,LV_RADIUS_CIRCLE);lv_obj_set_style_border_color(r,lv_color_hex(tone),0);lv_obj_set_style_border_width(r,4,0);
        lv_obj_t *i=text(r,LV_SYMBOL_WARNING,0,24,78,&lv_font_montserrat_28,tone,0);lv_obj_set_style_text_align(i,LV_TEXT_ALIGN_CENTER,0);
        text(scr,"กำลังเชื่อมต่อใหม่…",138,104,324,&bitpos_font_20,CREAM,2);
        box(scr,20,244,440,62,PANEL,10);
        text(scr,"ออเดอร์ที่ค้างจะไม่หาย - ไม่ตัดเงินซ้ำ",32,261,416,&bitpos_font_20,MUTED,1);return;
    }
    if(joining()){
        /* Scan to open Messenger: QR left, how it works right, Back. */
        text(scr,"สแกนเพื่อเข้า Messenger",12,52,300,&bitpos_font_20,BLUE,1);
        box(scr,8,84,216,216,0xffffff,6);
        lv_obj_t *qr=lv_qrcode_create(scr);lv_qrcode_set_size(qr,196);lv_qrcode_set_dark_color(qr,lv_color_hex(0x111827));lv_qrcode_set_light_color(qr,lv_color_hex(0xffffff));
        lv_qrcode_update(qr,join_url,strlen(join_url));lv_obj_set_pos(qr,18,94);
        lv_obj_t *card=box(scr,236,84,232,216,PANEL,12);
        text(card,"เปิดกล้องแล้วสแกน",14,12,204,&bitpos_font_20,CREAM,1);
        text(card,"กดยินยอมในแชท ร้านจะส่งโปรและเมนูให้",14,50,204,&bitpos_font_20,MUTED,2);
        join_countdown=text(card,"",14,116,204,&bitpos_font_20,BLUE,1);join_left(join_countdown);
        button(card,14,156,96,"กลับ",LINE,on_back);
        return;
    }
    bool anim=false;
    if(!view.qr[0]&&view.anim[0]&&anim_buf&&!strcmp(view.anim,anim_loaded)){
        anim_fs_register();
        lv_obj_t *g=lv_gif_create(scr);lv_gif_set_src(g,"A:/offer.gif");
        if(lv_gif_is_loaded(g)){lv_image_set_pivot(g,0,0);lv_image_set_scale(g,256);lv_obj_set_pos(g,12,60);anim=true;}
        else{ESP_LOGW("BitPOS","META_ANIM not loaded bytes=%u",(unsigned)anim_len);lv_obj_delete(g);}
    }
    if(view.qr[0]){
        /* Stripe QR: white tile left, amount card right (like the standard terminal's entry scene). */
        text(scr,view.title,12,52,216,&bitpos_font_20,tone,1);
        box(scr,8,84,216,216,0xffffff,6);
        lv_obj_t *qr=lv_qrcode_create(scr);lv_qrcode_set_size(qr,196);lv_qrcode_set_dark_color(qr,lv_color_hex(0x111827));lv_qrcode_set_light_color(qr,lv_color_hex(0xffffff));
        lv_qrcode_update(qr,view.qr,strlen(view.qr));lv_obj_set_pos(qr,18,94);
        lv_obj_t *card=box(scr,236,84,232,216,PANEL,12);
        text(card,"TOTAL",14,12,204,&lv_font_montserrat_14,MUTED,0);
        text(card,view.big,14,34,204,&lv_font_montserrat_32,CREAM,0);
        box(card,14,80,204,1,LINE,0);
        text(card,view.line1,14,92,204,&bitpos_font_20,CREAM,2);
        text(card,view.line2,14,154,204,&bitpos_font_20,MUTED,2);
        return;
    }
    if(anim){
        /* Offer animation left; right card: chip, shop/greeting, details, and the call to action as a button. */
        lv_obj_t *card=box(scr,264,60,204,240,PANEL,16);
        lv_obj_t *chip=box(card,14,14,92,30,0x24365e,15);
        text(chip,"โปรวันนี้",12,1,80,&bitpos_font_20,0xb9d3ff,0);
        text(card,view.title,14,56,176,&bitpos_font_20,CREAM,2);
        text(card,view.line1,14,116,176,&bitpos_font_20,MUTED,2);
        if(join_allowed())button(card,12,180,180,"สแกน QR เข้าแชท",tone,on_join);
        return;
    }
    /* Status: ring with an icon left, title and big value right, details card at the bottom (like the paid scene). */
    lv_obj_t *r=box(scr,32,72,86,86,PANEL,LV_RADIUS_CIRCLE);lv_obj_set_style_border_color(r,lv_color_hex(tone),0);lv_obj_set_style_border_width(r,4,0);
    lv_obj_t *i=text(r,icon(view.screen),0,24,78,&lv_font_montserrat_28,tone,0);lv_obj_set_style_text_align(i,LV_TEXT_ALIGN_CENTER,0);
    /* Title centred on the ring, or above the big value / countdown. */
    lv_obj_t *t=text(scr,view.title,138,0,324,&bitpos_font_20,CREAM,0);int th=fit(t,2);
    bool value=view.big[0]||view.countdown>0,join=!value&&join_allowed();int ty=value||join?70:115-th/2;lv_obj_set_y(t,ty);
    if(join)button(scr,138,ty+th+10,220,"สแกน QR เข้าแชท",tone,on_join);
    if(view.big[0])text(scr,view.big,138,ty+th+4,324,&lv_font_montserrat_48,tone,0);
    else if(view.countdown>0)countdown_label=text(scr,"--:--",138,ty+th+4,324,&lv_font_montserrat_48,tone,0);
    if(view.line1[0]||view.line2[0]){
        /* Details card sized to its lines, sitting on the bottom margin. */
        lv_obj_t *card=box(scr,20,0,440,0,PANEL,12);
        int h=12;
        if(view.line1[0]){lv_obj_t *a=text(card,view.line1,16,h,408,&bitpos_font_20,CREAM,0);h+=fit(a,2)+4;}
        if(view.line2[0]){lv_obj_t *b=text(card,view.line2,16,h,408,&bitpos_font_20,MUTED,0);h+=fit(b,1)+4;}
        h+=8;lv_obj_set_size(card,440,h);lv_obj_set_y(card,306-h);
    }
}
/* display_engine leaves the backlight off; like the standard terminal (main.c physical_render), turn it on once a
 * frame has been flushed so the panel never shows stale memory. Call without the LVGL lock. */
static void backlight_on(void){
    static bool lit;if(lit)return;
    if(display_engine_lock(1000)){lv_refr_now(display_engine_get_disp());display_engine_unlock();}
    lit=ccp_board_set_brightness(85)==ESP_OK;
}
static void tick(lv_timer_t *t){
    (void)t;
    if(join_countdown){join_left(join_countdown);if(esp_timer_get_time()>=join_until_us&&poller_task)xTaskNotifyGive(poller_task);}
    if(!countdown_label||view.countdown<=0)return;
    int left=view.countdown-(int)((esp_timer_get_time()-view.fetched_us)/1000000);if(left<0)left=0;
    char s[12];snprintf(s,sizeof(s),"%02d:%02d",left/60,left%60);lv_label_set_text(countdown_label,s);
}

static void copy(cJSON *o,const char *key,char *dst,size_t cap){
    cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);dst[0]=0;
    if(cJSON_IsString(v)&&v->valuestring)snprintf(dst,cap,"%s",v->valuestring);
}
/* GET /meta/device/state; true when a new, valid view was stored. The key goes only in the Authorization header. */
static bool fetch_view(void){
    static char body[BODY_MAX];char url[URL_MAX+64],auth[KEY_MAX+16];
    snprintf(url,sizeof(url),"%s/meta/device/state?d=%s",meta_url,meta_device);snprintf(auth,sizeof(auth),"Bearer %s",meta_key);
    esp_http_client_config_t cfg={.url=url,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=5000,.disable_auto_redirect=true};
    esp_http_client_handle_t c=esp_http_client_init(&cfg);if(!c)return false;
    esp_http_client_set_header(c,"Authorization",auth);memset(auth,0,sizeof(auth));
    bool ok=false;
    if(esp_http_client_open(c,0)==ESP_OK&&esp_http_client_fetch_headers(c)>=0&&esp_http_client_get_status_code(c)==200){
        int n=0,r;while(n<BODY_MAX-1&&(r=esp_http_client_read(c,body+n,BODY_MAX-1-n))>0)n+=r;body[n]=0;
        cJSON *j=cJSON_Parse(body);
        if(j&&cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(j,"v"))){
            copy(j,"screen",view.screen,sizeof(view.screen));copy(j,"tone",view.tone,sizeof(view.tone));copy(j,"table",view.table,sizeof(view.table));
            copy(j,"title",view.title,sizeof(view.title));copy(j,"line1",view.line1,sizeof(view.line1));copy(j,"line2",view.line2,sizeof(view.line2));
            copy(j,"big",view.big,sizeof(view.big));copy(j,"qr",view.qr,sizeof(view.qr));
            if(strncmp(view.qr,"https://",8))view.qr[0]=0;
            copy(j,"anim",view.anim,sizeof(view.anim));if(strncmp(view.anim,"/meta/anim/",11)||strstr(view.anim,".."))view.anim[0]=0;
            cJSON *cd=cJSON_GetObjectItemCaseSensitive(j,"countdown_s"),*pm=cJSON_GetObjectItemCaseSensitive(j,"poll_ms");
            view.countdown=cJSON_IsNumber(cd)?cd->valueint:0;view.poll_ms=cJSON_IsNumber(pm)&&pm->valueint>=1000&&pm->valueint<=30000?pm->valueint:2000;
            view.fetched_us=esp_timer_get_time();ok=true;
        }
        cJSON_Delete(j);
    }
    esp_http_client_close(c);esp_http_client_cleanup(c);return ok;
}
/* Downloads view.anim into a new PSRAM buffer; true when it is a GIF that fits. Runs without the LVGL lock. */
static bool fetch_anim(uint8_t **out,size_t *len){
    char url[URL_MAX+ANIM_PATH_MAX];snprintf(url,sizeof(url),"%s%s",meta_url,view.anim);
    esp_http_client_config_t cfg={.url=url,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=15000,.disable_auto_redirect=true,.buffer_size=4096};
    esp_http_client_handle_t c=esp_http_client_init(&cfg);if(!c)return false;
    bool ok=false;uint8_t *buf=NULL;
    if(esp_http_client_open(c,0)==ESP_OK){
        int64_t size=esp_http_client_fetch_headers(c);
        if(esp_http_client_get_status_code(c)==200&&size>16&&size<=ANIM_MAX&&(buf=heap_caps_malloc((size_t)size,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT))){
            int n=0,r;while(n<size&&(r=esp_http_client_read(c,(char*)buf+n,(int)size-n))>0)n+=r;
            ok=n==size&&!memcmp(buf,"GIF8",4);
            if(ok){*out=buf;*len=(size_t)n;}else{heap_caps_free(buf);}
        }
    }
    esp_http_client_close(c);esp_http_client_cleanup(c);
    if(!ok)ESP_LOGW(TAG,"offer animation not loaded");
    return ok;
}
/* POST /meta/device/qr: a fresh "scan to open Messenger" link for this device (key only in the header). */
static bool fetch_join(void){
    static char body[512];char url[URL_MAX+64],auth[KEY_MAX+16];
    snprintf(url,sizeof(url),"%s/meta/device/qr?d=%s",meta_url,meta_device);snprintf(auth,sizeof(auth),"Bearer %s",meta_key);
    esp_http_client_config_t cfg={.url=url,.method=HTTP_METHOD_POST,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=6000,.disable_auto_redirect=true};
    esp_http_client_handle_t c=esp_http_client_init(&cfg);if(!c)return false;
    esp_http_client_set_header(c,"Authorization",auth);memset(auth,0,sizeof(auth));
    bool ok=false;
    if(esp_http_client_open(c,0)==ESP_OK&&esp_http_client_fetch_headers(c)>=0&&esp_http_client_get_status_code(c)==200){
        int n=0,r;while(n<(int)sizeof(body)-1&&(r=esp_http_client_read(c,body+n,sizeof(body)-1-n))>0)n+=r;body[n]=0;
        cJSON *j=cJSON_Parse(body);cJSON *u=cJSON_GetObjectItemCaseSensitive(j,"url"),*e=cJSON_GetObjectItemCaseSensitive(j,"expires_s");
        char prefix[URL_MAX+16];snprintf(prefix,sizeof(prefix),"%s/meta/q/",meta_url);
        if(cJSON_IsString(u)&&u->valuestring&&!strncmp(u->valuestring,prefix,strlen(prefix))&&strlen(u->valuestring)<sizeof(join_url)&&cJSON_IsNumber(e)&&e->valueint>5&&e->valueint<=180){
            snprintf(join_url,sizeof(join_url),"%s",u->valuestring);join_until_us=esp_timer_get_time()+(int64_t)(e->valueint-5)*1000000;ok=true;
        }
        cJSON_Delete(j);
    }
    esp_http_client_close(c);esp_http_client_cleanup(c);
    if(!ok)ESP_LOGW("BitPOS","META_JOIN qr link not issued");
    return ok;
}
static void poller(void *arg){
    (void)arg;uint32_t last=0;bool rendered=false;int failures=0;
    for(;;){
        if(esp_timer_get_time()<demo_until_us){rendered=false;vTaskDelay(pdMS_TO_TICKS(500));continue;}
        bool ok=wifi_up&&fetch_view();
        failures=ok?0:failures+1;bool online=failures<3;
        if(join_close){join_close=false;join_url[0]=0;join_until_us=0;}
        if(join_wanted){join_wanted=false;if(ok&&join_allowed())fetch_join();}
        if(join_url[0]&&esp_timer_get_time()>=join_until_us)join_url[0]=0;
        /* A new animation: download first, then swap it in under the lock (the old buffer is freed after the re-render). */
        uint8_t *old=NULL;
        static int64_t anim_retry_us;
        if(ok&&view.anim[0]&&strcmp(view.anim,anim_loaded)&&esp_timer_get_time()>=anim_retry_us){
            anim_retry_us=esp_timer_get_time()+30000000; /* one try per 30 s while the same path keeps failing */
            uint8_t *buf;size_t len;
            if(fetch_anim(&buf,&len)&&display_engine_lock(1000)){old=anim_buf;anim_buf=buf;anim_len=len;snprintf(anim_loaded,sizeof(anim_loaded),"%s",view.anim);anim_retry_us=0;last=0;rendered=false;display_engine_unlock();}
        }
        /* Re-render only when what the screen shows changed (FNV-1a over the fields). */
        uint32_t sig=2166136261u;const char *fields[]={view.screen,view.tone,view.title,view.line1,view.line2,view.big,view.qr,view.table,view.anim,anim_loaded};
        for(size_t f=0;f<sizeof(fields)/sizeof(fields[0]);f++)for(const char *p=fields[f];;p++){sig=(sig^(uint8_t)*p)*16777619u;if(!*p)break;}
        sig=(sig^(uint32_t)online^((uint32_t)(view.countdown>0)<<1)^((uint32_t)joining()<<2))*16777619u;
        for(const char *p=join_url;*p;p++)sig=(sig^(uint8_t)*p)*16777619u;
        if((sig!=last||!rendered)&&display_engine_lock(1000)){view.online=online;render();display_engine_unlock();last=sig;rendered=true;backlight_on();}
        if(old&&rendered)heap_caps_free(old);else if(old&&display_engine_lock(5000)){lv_obj_clean(lv_screen_active());display_engine_unlock();heap_caps_free(old);rendered=false;}
        ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(ok?view.poll_ms:3000)); /* a button press wakes the poller at once */
    }
}

static void wifi_event(void *arg,esp_event_base_t base,int32_t id,void *data){
    (void)arg;(void)data;
    if(base==WIFI_EVENT&&(id==WIFI_EVENT_STA_START||id==WIFI_EVENT_STA_DISCONNECTED)){wifi_up=false;esp_wifi_connect();}
    if(base==IP_EVENT&&id==IP_EVENT_STA_GOT_IP)wifi_up=true;
}

static bool load(void){
    nvs_handle_t n;if(nvs_open_from_partition("bitpos_nvs","meta",NVS_READONLY,&n)!=ESP_OK)return false;
    size_t a=sizeof(meta_url),b=sizeof(meta_device),c=sizeof(meta_key);
    bool ok=nvs_get_str(n,"url",meta_url,&a)==ESP_OK&&nvs_get_str(n,"device",meta_device,&b)==ESP_OK&&nvs_get_str(n,"key",meta_key,&c)==ESP_OK;nvs_close(n);
    return ok&&!strncmp(meta_url,"https://",8)&&strlen(meta_device)==36;
}
static bool safe(const char *s,size_t max,bool url){
    size_t n=strlen(s);if(!n||n>=max)return false;
    for(size_t i=0;i<n;i++){unsigned char c=(unsigned char)s[i];if(!(isalnum(c)||c=='-'||c=='_'||(url&&(c==':'||c=='/'||c=='.'))))return false;}
    return true;
}
/* USB provisioning: one line at a time; replies never echo the key. */
static void provisioning(void *arg){
    (void)arg;usb_serial_jtag_driver_config_t cfg=USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();usb_serial_jtag_driver_install(&cfg);
    char line[320];size_t n=0;uint8_t ch;
    for(;;){
        if(usb_serial_jtag_read_bytes(&ch,1,portMAX_DELAY)!=1)continue;
        if(ch!='\n'&&ch!='\r'){if(n<sizeof(line)-1)line[n++]=(char)ch;continue;}
        line[n]=0;n=0;char cmd[24]={0},u[URL_MAX]={0},d[ID_MAX]={0},k[KEY_MAX]={0};
        int parts=sscanf(line,"%23s %159s %39s %63s",cmd,u,d,k);memset(line,0,sizeof(line));
        if(!strcmp(cmd,"META_JOIN")){on_join(NULL);printf("META_JOIN requested\n");}
        else if(!strcmp(cmd,"META_DEMO")){
            /* Layout check without a real order: show a sample of one template for 30 s (u = template name). */
            static const struct {const char *name,*screen,*tone,*title,*big,*line1,*line2,*qr;int cd;} demo[]={
                {"qr","pay_qr","white","สแกนเพื่อจ่าย","$9.45","Latte x 1, Croissant x 1","Stripe sandbox - ไม่ใช่เงินจริง","https://meta-pay.cashlessthailand.com/pay/demo",0},
                {"paid","paid","green","จ่ายแล้ว ขอบคุณค่ะ","#A1B2","รหัสรับสินค้า - Stripe ยืนยันแล้ว","",NULL,0},
                {"checkin","check_in","red","รอผู้จองเช็กอิน - แตะเพื่อเช็กอิน","","2 คน - 18:30 - ไม่มาภายใน 18:45 โต๊ะจะว่าง","",NULL,540},
                {"upcoming","upcoming","violet","จองไว้ 19:00 - 4 คน","","เช็กอินได้ตั้งแต่ 18:45","",NULL,1500},
                {"seated","seated","blue","เช็กอินแล้ว ยินดีต้อนรับ","","โต๊ะนี้ของคุณถึง 20:30","สั่งจากมือถือหรือสแกน QR บนโต๊ะ",NULL,0},
                {"tapnew","tap_new","white","ไปต่อในมือถือนะคะ","","กดยินยอมใน Messenger เพื่อให้ร้านจำคุณได้","ไม่ยินยอมก็สั่งจาก QR บนโต๊ะได้",NULL,0},
                {"idle","idle","white","Muse Cafe","","แตะมือถือตรงนี้ - รับโปรและสั่งผ่าน Messenger","หรือสแกน QR บนโต๊ะ - จ่ายด้วย Stripe",NULL,0}};
            for(size_t i=0;i<sizeof(demo)/sizeof(demo[0]);i++)if(!strcmp(u,demo[i].name)&&display_engine_lock(2000)){
                demo_until_us=esp_timer_get_time()+30000000;
                snprintf(view.screen,sizeof(view.screen),"%s",demo[i].screen);snprintf(view.tone,sizeof(view.tone),"%s",demo[i].tone);
                snprintf(view.title,sizeof(view.title),"%s",demo[i].title);snprintf(view.big,sizeof(view.big),"%s",demo[i].big);
                snprintf(view.line1,sizeof(view.line1),"%s",demo[i].line1);snprintf(view.line2,sizeof(view.line2),"%s",demo[i].line2);
                snprintf(view.qr,sizeof(view.qr),"%s",demo[i].qr?demo[i].qr:"");view.anim[0]=0;view.countdown=demo[i].cd;view.fetched_us=esp_timer_get_time();view.online=true;
                render();display_engine_unlock();printf("META_DEMO %s\n",demo[i].name);
            }
        }
        else if(!strcmp(cmd,"META_SHOT")){
            /* Screenshot for layout checks: the RGB565 frame LVGL rendered, as hex rows. Shows only what is on screen. */
            uint16_t *copy=heap_caps_malloc(480*320*2,MALLOC_CAP_SPIRAM);
            if(copy&&display_engine_lock(2000)){lv_draw_buf_t *fb=lv_display_get_buf_active(NULL);bool ok=fb&&fb->data&&fb->header.w==480&&fb->header.h==320;
                if(ok){memcpy(copy,fb->data,480*320*2);}
                display_engine_unlock();
                if(ok){printf("META_SHOT_BEGIN 480 320\n");static char row[480*4+8];
                    for(int y=0;y<320;y++){for(int x=0;x<480;x++)sprintf(row+x*4,"%04x",copy[y*480+x]);printf("S%03d %s\n",y,row);if(y%16==0)vTaskDelay(1);}
                    printf("META_SHOT_END\n");}
                else printf("META_SHOT failed\n");}
            heap_caps_free(copy);
        }
        else if(!strcmp(cmd,"META_STATUS")){printf("META_STATUS configured=%d device=%s version=%s\n",load(),meta_device[0]?meta_device:"-",esp_app_get_description()->version);}
        else if(!strcmp(cmd,"META_FORGET")){nvs_handle_t h;if(nvs_open_from_partition("bitpos_nvs","meta",NVS_READWRITE,&h)==ESP_OK){nvs_erase_all(h);nvs_commit(h);nvs_close(h);}printf("META_FORGET ok\n");vTaskDelay(pdMS_TO_TICKS(200));esp_restart();}
        else if(!strcmp(cmd,"META_PROVISION")&&parts==4&&!strncmp(u,"https://",8)&&safe(u,sizeof(u),true)&&strlen(d)==36&&safe(d,sizeof(d),false)&&safe(k,sizeof(k),false)){
            nvs_handle_t h;bool ok=nvs_open_from_partition("bitpos_nvs","meta",NVS_READWRITE,&h)==ESP_OK;
            if(ok){ok=nvs_set_str(h,"url",u)==ESP_OK&&nvs_set_str(h,"device",d)==ESP_OK&&nvs_set_str(h,"key",k)==ESP_OK&&nvs_commit(h)==ESP_OK;nvs_close(h);}
            memset(k,0,sizeof(k));printf("META_PROVISION %s\n",ok?"ok":"failed");
            if(ok){vTaskDelay(pdMS_TO_TICKS(200));esp_restart();}
        } else if(cmd[0])printf("META_ERROR unknown or invalid command\n");
        memset(k,0,sizeof(k));
    }
}

void bitpos_meta_main(void){
    esp_log_level_set("display",ESP_LOG_WARN); /* LCD transfer errors only; no request data */
    ESP_LOGI(TAG,"BOOT product=bitpos_terminal_meta version=%s",esp_app_get_description()->version);
    xTaskCreate(provisioning,"meta_usb",6144,NULL,4,NULL);
    bool configured=load();
    snprintf(view.tone,sizeof(view.tone),"white");
    if(display_engine_lock(2000)){
        view.online=true;
        if(!configured){snprintf(view.title,sizeof(view.title),"ตั้งค่าเครื่อง BitPOS Mini (Meta)");snprintf(view.line1,sizeof(view.line1),"ต่อ USB แล้วส่งคำสั่ง META_PROVISION");snprintf(view.line2,sizeof(view.line2),"ดู device/firmware/README.md");}
        else {snprintf(view.title,sizeof(view.title),"BitPOS x Muse");snprintf(view.line1,sizeof(view.line1),"กำลังเชื่อมต่อ…");}
        render();lv_timer_create(tick,250,NULL);display_engine_unlock();backlight_on();
    }
    if(!configured)return;
    nvs_handle_t n;if(nvs_open_from_partition("bitpos_nvs","config",NVS_READONLY,&n)!=ESP_OK)return;
    char ssid[33]={0},password[65]={0};size_t a=sizeof(ssid),b=sizeof(password);
    bool ok=nvs_get_str(n,"ssid",ssid,&a)==ESP_OK&&nvs_get_str(n,"password",password,&b)==ESP_OK;nvs_close(n);
    if(!ok){ESP_LOGW(TAG,"no WiFi credentials in bitpos_nvs/config");return;}
    ESP_ERROR_CHECK(esp_netif_init());ESP_ERROR_CHECK(esp_event_loop_create_default());esp_netif_create_default_wifi_sta();
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();ESP_ERROR_CHECK(esp_wifi_init(&init));ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    wifi_config_t cfg={0};memcpy(cfg.sta.ssid,ssid,strlen(ssid));memcpy(cfg.sta.password,password,strlen(password));memset(password,0,sizeof(password));
    cfg.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK;cfg.sta.pmf_cfg.capable=true;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&cfg));ESP_ERROR_CHECK(esp_wifi_start());ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    xTaskCreate(poller,"meta_poll",8192,NULL,5,&poller_task);
}
