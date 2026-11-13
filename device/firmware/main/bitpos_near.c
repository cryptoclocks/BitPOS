/* NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
 *
 * BitPOS Mini · NEAR product (bitpos_terminal_near, CONFIG_BITPOS_PRODUCT_NEAR). Same board, display engine and WiFi
 * credentials as the standard terminal, but no ordering WebSocket and no Solana code. The device is the bill's
 * WITNESS on NEAR (near-hackathon/PLAN_TH.md section 7):
 *
 *  1. Every poll it asks the BitPOS NEAR server which screen to show (GET <url>/near/device/state). The server may
 *     ask for a QR, an idle screen or "checking"; it can never make this device show "paid".
 *  2. When a bill is being paid, the device asks a NEAR RPC node itself (HTTPS, cert bundle) for get_bill on the
 *     bill contract, at final finality, and reads the answer with a bounded parser (bitpos_near_core.c).
 *  3. Only when the chain says the bill is in Escrow AND names this device's public key as its witness does the
 *     device draw the paid screen, wait until the panel really flushed that frame, sign the one-line witness
 *     message "bitpos-near-ack:v1:<contract>:<merchant>:<bill_id>" with its Ed25519 key and POST the signature to
 *     <url>/near/device/ack. The contract verifies that signature; the server only relays it.
 *  4. Settling/Settled show paid without signing; Refunding/Refunded show refunded; Open keeps the QR.
 *  5. While the server says "register":true (it has no public key for this device yet) the device shows the setup
 *     screen and POSTs {"pk":"<hex64>"} to <url>/near/device/register. The first key wins; a 409 means another key
 *     is already registered and is shown on the setup screen.
 *
 * Key: a 32-byte Ed25519 seed made on the device with esp_fill_random() AFTER esp_wifi_start() (the hardware RNG
 * is a true RNG only while the RF subsystem is on; the board uses the ADC, so bootloader_random is not used). It
 * is stored in NVS bitpos_nvs/near "sk", never printed and never sent. Only the public key leaves the device.
 *
 * Settings live in the bitpos_nvs partition under the separate "near" namespace (url, device, key, lang, sk,
 * acked, toned and the optional pins contract, rpc). The standard "config" namespace is only read (WiFi).
 * USB (one line each; replies never echo the device key or the seed):
 *   NEAR_PROVISION <https-origin> <device-uuid> <device-key>
 *   NEAR_PIN <contract-account> [<https-rpc-url>] | NEAR_PIN clear     accept bills of this contract only / use this RPC only
 *   NEAR_STATUS        version, device id, public key as 64 hex and as ed25519:<base58>
 *   NEAR_SELFTEST      RFC 8032 test 1 and a sign/verify round trip with the device key
 *   NEAR_FORGET        erase the settings but keep the key   |   NEAR_FORGET key   erase everything incl. the key
 *   NEAR_DEMO <setup|idle|qr|checking|paid|refunded|offline>   sample screen for 30 s, marked DEMO, signs nothing
 *   NEAR_SHOT          the rendered 480x320 RGB565 frame as hex rows
 *   NEAR_LANG en|th
 * Layout helpers (box/text/Thai mark handling) follow the project's own earlier server-driven product. */
#include "sdkconfig.h"
typedef int bitpos_near_translation_unit_t; /* keeps the file non-empty for the other products */
#if CONFIG_BITPOS_PRODUCT_NEAR
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
#include "esp_random.h"
#include "esp_heap_caps.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "lvgl.h"
#include "display_engine.h"
#include "ccp_board.h"
#include "bitpos_audio.h"
#include "bitpos_near.h"
#include "bitpos_near_core.h"
#include "bitpos_near_ed25519.h"

LV_FONT_DECLARE(bitpos_font_20);
LV_IMAGE_DECLARE(bitpos_logo);
static const char *TAG="BitPOS"; /* app_main silences every other log tag */
#define URL_MAX 160
#define ID_MAX 40
#define KEY_MAX 64
#define RPC_MAX 96
#define BODY_MAX 4096
#define SPLITS_MAX 6
/* RPC nodes this firmware will ask. The server's "rpc" hint is used only when it is one of these, so a server
 * cannot point the device at a node of its own; NEAR_PIN replaces the list with one URL chosen by the owner. */
static const char *const RPC_ALLOWED[]={"https://test.rpc.fastnear.com","https://near-testnet.drpc.org","https://testnet-rpc.intea.rs","https://rpc.testnet.near.org"};
#define RPC_COUNT (sizeof(RPC_ALLOWED)/sizeof(RPC_ALLOWED[0]))

typedef enum {SC_SETUP,SC_IDLE,SC_QR,SC_CHECKING,SC_PAID,SC_REFUNDED,SC_OFFLINE} scene_t;
typedef struct {char label[40],amount[24];} split_t;
/* What the server asked for (never trusted for "paid"). */
static struct {
    char screen[12],table[40],title[96],line1[128],line2[128],big[24],qr[200],rpc[RPC_MAX];
    split_t splits[SPLITS_MAX];int split_count;
    bool has_bill;char contract[BN_ACCOUNT_MAX],merchant[BN_ACCOUNT_MAX],bill[BN_BILL_ID_MAX];
    int poll_ms;bool reg; /* the server has no public key for this device yet */
} view;
/* What the chain said about the bill the server named. */
static struct {bool valid,terminal;char contract[BN_ACCOUNT_MAX],merchant[BN_ACCOUNT_MAX],bill[BN_BILL_ID_MAX];bn_show_t show;bn_state_t state;} chain;
/* What is drawn. */
static struct {scene_t scene;bool online,demo,witness,configured;char note[160];} shown;

static char near_url[URL_MAX],near_device[ID_MAX],near_key[KEY_MAX],pin_contract[BN_ACCOUNT_MAX],pin_rpc[RPC_MAX];
static uint8_t device_seed[BITPOS_NEAR_SEED_BYTES],device_pk[BITPOS_NEAR_PK_BYTES];
static char pk_hex[BN_PK_HEX_MAX],pk_b58[64];static volatile bool have_key;
static char acked[BN_BILL_ID_MAX],toned[BN_BILL_ID_MAX],flushed_paid[BN_BILL_ID_MAX];
static volatile bool wifi_up,wifi_wanted;
static volatile int64_t demo_until_us;static volatile int demo_request=-1; /* sample screen asked over USB, applied by the poller */
static volatile bool lang_th;static volatile int lang_request; /* 0 none, 1 toggle, 2 en, 3 th */
static TaskHandle_t poller_task;static bool poll_active; /* false: not provisioned yet, the task only serves the setup screen */
static size_t rpc_index;
static int reg_state; /* 0 not tried, 1 accepted, 2 another key is registered (409), 3 failed */
static char *rpc_body,*bill_scratch; /* PSRAM, allocated once */
#define TR(en,th) (lang_th?(th):(en))

/* ---- drawing ------------------------------------------------------------------------------------------------ */
#define THAI_PAD 5
/* LVGL draws Thai marks without shaping, so a tone mark on an upper vowel lands on the vowel and vanishes. text()
 * swaps such pairs to tone mark + vowel, and this font raises a tone mark that is followed by an upper vowel. */
static lv_font_t thai_font;
static bool thai_glyph(const lv_font_t *f,lv_font_glyph_dsc_t *g,uint32_t letter,uint32_t next){
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
/* NEAR product palette: the terminal's dark ink and panels, NEAR green as the accent. */
enum {INK=0x0b1020,PANEL=0x18213a,LINE=0x2a3656,CREAM=0xf5f7ff,MUTED=0xa9b4cc,GREEN=0x00ec97,AMBER=0xffb547,RED=0xff5a6a,BLUE=0x6ab7ff};
static lv_obj_t *box(lv_obj_t *parent,int x,int y,int w,int h,uint32_t color,int radius){
    lv_obj_t *o=lv_obj_create(parent);lv_obj_remove_style_all(o);lv_obj_remove_flag(o,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,h);lv_obj_set_style_bg_color(o,lv_color_hex(color),0);lv_obj_set_style_bg_opa(o,LV_OPA_COVER,0);
    lv_obj_set_style_radius(o,radius,0);return o;
}
/* UTF-8 Thai: upper vowel then tone mark -> tone mark first. */
static void thai_order(char *t){
    for(uint8_t *p=(uint8_t *)t;p[0]&&p[1]&&p[2];p++){
        if(p[0]!=0xE0||!p[3]||p[3]!=0xE0||p[4]!=0xB9||p[5]<0x88||p[5]>0x8C)continue;
        uint16_t v=(uint16_t)(p[1]<<8|p[2]);
        if(v==0xB8B1||(v>=0xB8B4&&v<=0xB8B7)||v==0xB987||v==0xB98D){uint8_t a=p[1],b=p[2];p[1]=0xB9;p[2]=p[5];p[4]=a;p[5]=b;p+=5;}
    }
}
/* A label cut to `lines` lines of its font with an ellipsis, so long server text never overlaps. */
static lv_obj_t *text(lv_obj_t *parent,const char *s,int x,int y,int w,const lv_font_t *font,uint32_t color,int lines){
    lv_obj_t *l=lv_label_create(parent);lv_obj_remove_style_all(l);
    if(font==&bitpos_font_20){char t[256];snprintf(t,sizeof(t),"%s",s);thai_order(t);lv_label_set_text(l,t);}else lv_label_set_text(l,s);
    lv_obj_set_style_text_color(l,lv_color_hex(color),0);lv_obj_set_width(l,w);lv_obj_set_pos(l,x,y);
    if(font==&bitpos_font_20)font=thai();
    lv_obj_set_style_text_font(l,font,0);
    int pad=font==&thai_font?THAI_PAD:0;lv_obj_set_style_pad_top(l,pad,0);if(pad)lv_obj_set_y(l,y-pad);
    if(lines>0){lv_obj_set_height(l,lines*lv_font_get_line_height(font)+pad);lv_label_set_long_mode(l,LV_LABEL_LONG_DOT);}
    else lv_label_set_long_mode(l,LV_LABEL_LONG_CLIP);
    return l;
}
static void on_lang(lv_event_t *e){(void)e;lang_request=1;if(poller_task)xTaskNotifyGive(poller_task);}

#define W 480
#define MARGIN 12
#define BODY_Y 52
#define BODY_H (320-MARGIN-BODY_Y)
#define TEXT_X 128
#define QR_W 228
#define CARD_X (MARGIN+QR_W+12)
#define CARD_W (W-MARGIN-CARD_X)
static void qr_tile(const char *data){
    lv_obj_t *scr=lv_screen_active();box(scr,MARGIN,BODY_Y,QR_W,BODY_H,0xffffff,10);
    int q=QR_W-20;lv_obj_t *qr=lv_qrcode_create(scr);lv_qrcode_set_size(qr,q);lv_qrcode_set_dark_color(qr,lv_color_hex(0x111827));lv_qrcode_set_light_color(qr,lv_color_hex(0xffffff));
    lv_qrcode_update(qr,data,strlen(data));lv_obj_set_pos(qr,MARGIN+10,BODY_Y+(BODY_H-q)/2);
}
/* Ring with an icon on the left, title (and optional big value) on the right, a details card at the bottom. */
static void status_scene(const char *symbol,uint32_t tone,const char *title,const char *big,const char *line1,const char *line2){
    lv_obj_t *scr=lv_screen_active();
    lv_obj_t *r=box(scr,MARGIN+12,BODY_Y+24,86,86,PANEL,LV_RADIUS_CIRCLE);lv_obj_set_style_border_color(r,lv_color_hex(tone),0);lv_obj_set_style_border_width(r,4,0);
    lv_obj_t *i=text(r,symbol,0,24,78,&lv_font_montserrat_28,tone,0);lv_obj_set_style_text_align(i,LV_TEXT_ALIGN_CENTER,0);
    text(scr,title,TEXT_X,BODY_Y+(big&&big[0]?20:40),W-MARGIN-TEXT_X,&bitpos_font_20,CREAM,2);
    if(big&&big[0])text(scr,big,TEXT_X,BODY_Y+78,W-MARGIN-TEXT_X,&lv_font_montserrat_48,tone,0);
    if((line1&&line1[0])||(line2&&line2[0])){
        box(scr,MARGIN,BODY_Y+BODY_H-92,W-2*MARGIN,92,PANEL,12);
        if(line1&&line1[0])text(scr,line1,MARGIN+16,BODY_Y+BODY_H-82,W-2*MARGIN-32,&bitpos_font_20,CREAM,2);
        if(line2&&line2[0])text(scr,line2,MARGIN+16,BODY_Y+BODY_H-30,W-2*MARGIN-32,&bitpos_font_20,MUTED,1);
    }
}
/* Server text is used only on the scene the server asked for: when the chain overrules the server (say "checking"
 * becomes paid, or "paid" stays checking) the device's own wording is shown instead. */
static const char *srv(const char *screen,const char *value,const char *fallback){return !strcmp(view.screen,screen)&&value[0]?value:fallback;}
/* One renderer for every scene. Call with the LVGL lock. */
static void render(void){
    lv_obj_t *scr=lv_screen_active();lv_obj_clean(scr);
    lv_obj_set_style_bg_color(scr,lv_color_hex(INK),0);lv_obj_set_style_bg_opa(scr,LV_OPA_COVER,0);
    lv_obj_set_style_pad_all(scr,0,0);lv_obj_remove_flag(scr,LV_OBJ_FLAG_SCROLLABLE);
    /* Header: logo pill, table, network chip (or DEMO), connection dot, language button. */
    box(scr,12,4,96,36,0xfff8f0,8);
    lv_obj_t *logo=lv_image_create(scr);lv_image_set_src(logo,&bitpos_logo);lv_image_set_pivot(logo,0,0);lv_obj_set_pos(logo,18,8);lv_image_set_scale(logo,170);
    text(scr,view.table[0]?view.table:"BitPOS x NEAR",120,8,150,&bitpos_font_20,CREAM,1);
    lv_obj_t *chip=box(scr,278,10,shown.demo?58:84,24,shown.demo?RED:0x12382c,12);
    lv_obj_t *ct=text(chip,shown.demo?"DEMO":"TESTNET",0,4,shown.demo?58:84,&lv_font_montserrat_14,shown.demo?0xffffff:GREEN,0);lv_obj_set_style_text_align(ct,LV_TEXT_ALIGN_CENTER,0);
    box(scr,374,18,8,8,shown.online?GREEN:AMBER,LV_RADIUS_CIRCLE);
    lv_obj_t *lb=box(scr,W-MARGIN-62,6,62,32,LINE,16);lv_obj_add_flag(lb,LV_OBJ_FLAG_CLICKABLE);lv_obj_set_ext_click_area(lb,8);
    lv_obj_set_style_bg_opa(lb,LV_OPA_70,LV_STATE_PRESSED);lv_obj_add_event_cb(lb,on_lang,LV_EVENT_CLICKED,NULL);
    lv_obj_t *lt=text(lb,lang_th?"EN":"ไทย",0,lang_th?7:3,62,lang_th?&lv_font_montserrat_14:&bitpos_font_20,CREAM,1);lv_obj_set_style_text_align(lt,LV_TEXT_ALIGN_CENTER,0);

    switch(shown.scene){
    case SC_OFFLINE:
        status_scene(LV_SYMBOL_WARNING,AMBER,TR("Reconnecting...","กำลังเชื่อมต่อใหม่..."),"",
            TR("Bills are kept on NEAR - nothing is lost","บิลอยู่บน NEAR - ไม่มีอะไรหาย"),TR("No payment is confirmed while offline","ออฟไลน์อยู่จะไม่ยืนยันการจ่าย"));
        break;
    case SC_SETUP:{
        /* Public key as a QR (what the owner registers as this table's witness) and in short form. */
        char payload[160],shortkey[72];
        snprintf(payload,sizeof(payload),"bitpos-near-device:v1:%s:%s",near_device[0]?near_device:"-",have_key?pk_hex:"-");
        if(have_key)snprintf(shortkey,sizeof(shortkey),"%.8s...%s",pk_hex,pk_hex+56);else snprintf(shortkey,sizeof(shortkey),"%s",TR("making key...","กำลังสร้างกุญแจ..."));
        if(have_key)qr_tile(payload);else box(scr,MARGIN,BODY_Y,QR_W,BODY_H,PANEL,10);
        lv_obj_t *card=box(scr,CARD_X,BODY_Y,CARD_W,BODY_H,PANEL,12);
        text(card,srv("setup",view.title,TR("Set up this Mini","ตั้งค่าเครื่อง Mini")),14,12,CARD_W-28,&bitpos_font_20,GREEN,1);
        text(card,TR("WITNESS KEY","กุญแจพยาน"),14,48,CARD_W-28,lang_th?&bitpos_font_20:&lv_font_montserrat_14,MUTED,lang_th?1:0);
        text(card,shortkey,14,lang_th?76:68,CARD_W-28,&lv_font_montserrat_14,CREAM,0);
        text(card,"DEVICE",14,100,CARD_W-28,&lv_font_montserrat_14,MUTED,0);
        text(card,near_device[0]?near_device:"-",14,120,CARD_W-28,&lv_font_montserrat_14,CREAM,0);
        box(card,14,146,CARD_W-28,1,LINE,0);
        text(card,shown.note[0]?shown.note:srv("setup",view.line1,shown.configured?TR("Scan in the shop page: Devices","สแกนในหน้าร้าน: เครื่อง"):TR("USB: NEAR_PROVISION","ต่อ USB: NEAR_PROVISION")),14,156,CARD_W-28,&bitpos_font_20,CREAM,2);
        text(card,srv("setup",view.line2,TR("The key never leaves this device","กุญแจไม่ออกจากเครื่องนี้")),14,BODY_H-36,CARD_W-28,&bitpos_font_20,MUTED,1);
        break;}
    case SC_QR:{
        qr_tile(view.qr);
        lv_obj_t *card=box(scr,CARD_X,BODY_Y,CARD_W,BODY_H,PANEL,12);
        text(card,srv("qr",view.title,TR("Scan to pay","สแกนเพื่อจ่าย")),14,12,CARD_W-28,&bitpos_font_20,GREEN,1);
        text(card,"TOTAL",14,52,CARD_W-28,&lv_font_montserrat_14,MUTED,0);
        text(card,view.big,14,70,CARD_W-28,&lv_font_montserrat_32,CREAM,0);
        box(card,14,116,CARD_W-28,1,LINE,0);
        text(card,srv("qr",view.line1,""),14,128,CARD_W-28,&bitpos_font_20,CREAM,2);
        text(card,srv("qr",view.line2,TR("No gas fee for you","คุณไม่ต้องจ่ายค่า gas")),14,BODY_H-64,CARD_W-28,&bitpos_font_20,MUTED,2);
        break;}
    case SC_CHECKING:
        status_scene(LV_SYMBOL_REFRESH,BLUE,TR("Checking the chain...","กำลังตรวจบนเชน..."),view.big,
            shown.note[0]?shown.note:TR("This screen asks NEAR itself","จอนี้ถาม NEAR เอง ไม่เชื่อใครบอก"),
            TR("Paid shows only when the chain says so","ขึ้นจ่ายแล้วเมื่อเชนยืนยันเท่านั้น"));
        break;
    case SC_PAID:{
        /* Left: verified mark and the amount. Right: where the money went (the bill's split). */
        lv_obj_t *left=box(scr,MARGIN,BODY_Y,170,BODY_H,PANEL,12);
        lv_obj_t *r=box(left,42,18,86,86,INK,LV_RADIUS_CIRCLE);lv_obj_set_style_border_color(r,lv_color_hex(GREEN),0);lv_obj_set_style_border_width(r,4,0);
        lv_obj_t *i=text(r,LV_SYMBOL_OK,0,24,78,&lv_font_montserrat_28,GREEN,0);lv_obj_set_style_text_align(i,LV_TEXT_ALIGN_CENTER,0);
        lv_obj_t *t=text(left,srv("paid",view.title,TR("Paid","จ่ายแล้ว")),8,116,154,&bitpos_font_20,CREAM,1);lv_obj_set_style_text_align(t,LV_TEXT_ALIGN_CENTER,0);
        lv_obj_t *b=text(left,view.big,8,148,154,&lv_font_montserrat_28,GREEN,0);lv_obj_set_style_text_align(b,LV_TEXT_ALIGN_CENTER,0);
        lv_obj_t *v=text(left,shown.witness?TR("Witness: this screen","พยาน: จอนี้"):TR("Seen on NEAR","เห็นบน NEAR แล้ว"),8,BODY_H-36,154,&bitpos_font_20,MUTED,1);lv_obj_set_style_text_align(v,LV_TEXT_ALIGN_CENTER,0);
        int cx=MARGIN+170+12,cw=W-MARGIN-cx;
        lv_obj_t *card=box(scr,cx,BODY_Y,cw,BODY_H,PANEL,12);
        if(view.split_count>0){
            text(card,TR("Where the money goes","เงินนี้ไปหาใคร"),14,10,cw-28,&bitpos_font_20,GREEN,1);
            for(int k=0;k<view.split_count;k++){
                int y=44+k*32;
                if(k)box(card,14,y-4,cw-28,1,LINE,0);
                text(card,view.splits[k].label,14,y,cw-28-96,&bitpos_font_20,CREAM,1);
                lv_obj_t *a=text(card,view.splits[k].amount,cw-14-92,y,92,&bitpos_font_20,CREAM,1);lv_obj_set_style_text_align(a,LV_TEXT_ALIGN_RIGHT,0);
            }
        } else {
            text(card,TR("Thank you","ขอบคุณค่ะ"),14,12,cw-28,&bitpos_font_20,GREEN,1);
            text(card,srv("paid",view.line1,""),14,52,cw-28,&bitpos_font_20,CREAM,3);
            text(card,srv("paid",view.line2,""),14,BODY_H-64,cw-28,&bitpos_font_20,MUTED,2);
        }
        break;}
    case SC_REFUNDED:
        status_scene(LV_SYMBOL_LOOP,AMBER,srv("refunded",view.title,TR("Money sent back","เงินกลับไปหาลูกค้าแล้ว")),view.big,
            srv("refunded",view.line1,TR("The bill returned the payment by itself","บิลคืนเงินให้เองอัตโนมัติ")),srv("refunded",view.line2,""));
        break;
    default:
        status_scene(LV_SYMBOL_HOME,GREEN,srv("idle",view.title,"BitPOS x NEAR"),"",
            srv("idle",view.line1,TR("Scan the table QR to order","สแกน QR ที่โต๊ะเพื่อสั่ง")),
            srv("idle",view.line2,TR("One payment pays everyone","จ่ายครั้งเดียว ทุกคนได้เงิน")));
        break;
    }
}
/* Draws and reports whether the panel really flushed a new frame (same rule as the standard terminal's render ACK). */
static bool draw(void){
    if(!display_engine_lock(2000))return false;
    uint32_t before=display_engine_get_flush_count();render();lv_obj_invalidate(lv_screen_active());
    lv_refr_now(display_engine_get_disp());bool ok=display_engine_get_flush_count()!=before;
    display_engine_unlock();if(ok)ccp_board_set_brightness(85);return ok;
}

/* ---- settings and key --------------------------------------------------------------------------------------- */
static void store_string(const char *key,const char *value){
    nvs_handle_t h;if(nvs_open_from_partition("bitpos_nvs","near",NVS_READWRITE,&h)!=ESP_OK)return;
    nvs_set_str(h,key,value);nvs_commit(h);nvs_close(h);
}
static void read_string(nvs_handle_t n,const char *key,char *out,size_t cap){size_t len=cap;if(nvs_get_str(n,key,out,&len)!=ESP_OK)out[0]=0;}
static bool load(void){
    nvs_handle_t n;if(nvs_open_from_partition("bitpos_nvs","near",NVS_READONLY,&n)!=ESP_OK)return false;
    read_string(n,"url",near_url,sizeof(near_url));read_string(n,"device",near_device,sizeof(near_device));read_string(n,"key",near_key,sizeof(near_key));
    read_string(n,"contract",pin_contract,sizeof(pin_contract));read_string(n,"rpc",pin_rpc,sizeof(pin_rpc));
    read_string(n,"acked",acked,sizeof(acked));read_string(n,"toned",toned,sizeof(toned));
    uint8_t th=0;lang_th=nvs_get_u8(n,"lang",&th)==ESP_OK&&th;nvs_close(n);
    if(pin_contract[0]&&!bn_valid_account(pin_contract))pin_contract[0]=0;
    if(pin_rpc[0]&&strncmp(pin_rpc,"https://",8))pin_rpc[0]=0;
    return !strncmp(near_url,"https://",8)&&strlen(near_device)==36&&near_key[0];
}
/* Loads the witness key, or makes it on first use. Must run after esp_wifi_start(): see the note at the top. */
static bool ensure_key(void){
    nvs_handle_t h;if(nvs_open_from_partition("bitpos_nvs","near",NVS_READWRITE,&h)!=ESP_OK)return false;
    size_t len=sizeof(device_seed);bool ok=nvs_get_blob(h,"sk",device_seed,&len)==ESP_OK&&len==sizeof(device_seed);
    if(!ok){
        esp_fill_random(device_seed,sizeof(device_seed));
        uint8_t any=0;for(size_t i=0;i<sizeof(device_seed);i++)any|=device_seed[i];
        ok=any&&nvs_set_blob(h,"sk",device_seed,sizeof(device_seed))==ESP_OK&&nvs_commit(h)==ESP_OK;
        ESP_LOGI(TAG,"NEAR_KEY %s",ok?"created":"could not be stored");
    }
    nvs_close(h);if(!ok)return false;
    bitpos_near_ed25519_public(device_pk,device_seed);
    bn_hex_encode(pk_hex,device_pk,sizeof(device_pk));bn_base58_encode(pk_b58,sizeof(pk_b58),device_pk,sizeof(device_pk));
    have_key=true;return true;
}

/* ---- network ------------------------------------------------------------------------------------------------ */
static void copy(cJSON *o,const char *key,char *dst,size_t cap){
    cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);dst[0]=0;
    if(cJSON_IsString(v)&&v->valuestring)snprintf(dst,cap,"%s",v->valuestring);
}
/* Reads a response body into buf (cap includes the NUL). Returns the length, or -1 when it does not fit. */
static int read_body(esp_http_client_handle_t c,char *buf,int cap){
    int n=0,r;
    while((r=esp_http_client_read(c,buf+n,cap-1-n))>0){n+=r;if(n>=cap-1){char extra;if(esp_http_client_read(c,&extra,1)>0)return -1;break;}}
    buf[n]=0;return n;
}
/* GET /near/device/state; true when a new, valid view was stored. The key goes only in the Authorization header. */
static bool fetch_view(void){
    static char body[BODY_MAX];char url[URL_MAX+ID_MAX+48],auth[KEY_MAX+16];
    snprintf(url,sizeof(url),"%s/near/device/state?d=%s&l=%s",near_url,near_device,lang_th?"th":"en");snprintf(auth,sizeof(auth),"Bearer %s",near_key);
    esp_http_client_config_t cfg={.url=url,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=5000,.disable_auto_redirect=true};
    esp_http_client_handle_t c=esp_http_client_init(&cfg);if(!c)return false;
    esp_http_client_set_header(c,"Authorization",auth);memset(auth,0,sizeof(auth));
    bool ok=false;
    if(esp_http_client_open(c,0)==ESP_OK&&esp_http_client_fetch_headers(c)>=0&&esp_http_client_get_status_code(c)==200&&read_body(c,body,sizeof(body))>0){
        cJSON *j=cJSON_Parse(body);
        if(j&&cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(j,"v"))){
            copy(j,"screen",view.screen,sizeof(view.screen));copy(j,"table",view.table,sizeof(view.table));
            copy(j,"title",view.title,sizeof(view.title));copy(j,"line1",view.line1,sizeof(view.line1));copy(j,"line2",view.line2,sizeof(view.line2));
            copy(j,"big",view.big,sizeof(view.big));copy(j,"qr",view.qr,sizeof(view.qr));copy(j,"rpc",view.rpc,sizeof(view.rpc));
            if(strncmp(view.qr,"https://",8))view.qr[0]=0;
            view.split_count=0;cJSON *splits=cJSON_GetObjectItemCaseSensitive(j,"splits"),*row;
            if(cJSON_IsArray(splits))cJSON_ArrayForEach(row,splits){
                if(view.split_count>=SPLITS_MAX)break;
                split_t *s=&view.splits[view.split_count];copy(row,"label",s->label,sizeof(s->label));copy(row,"amount",s->amount,sizeof(s->amount));
                if(s->label[0]||s->amount[0])view.split_count++;
            }
            cJSON *bill=cJSON_GetObjectItemCaseSensitive(j,"bill");view.has_bill=false;
            if(cJSON_IsObject(bill)){
                copy(bill,"contract",view.contract,sizeof(view.contract));copy(bill,"merchant",view.merchant,sizeof(view.merchant));copy(bill,"id",view.bill,sizeof(view.bill));
                view.has_bill=bn_valid_account(view.contract)&&bn_valid_account(view.merchant)&&bn_valid_bill_id(view.bill);
            }
            view.reg=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j,"register"));
            cJSON *pm=cJSON_GetObjectItemCaseSensitive(j,"poll_ms");
            view.poll_ms=cJSON_IsNumber(pm)&&pm->valueint>=1000&&pm->valueint<=30000?pm->valueint:2000;
            ok=true;
        }
        cJSON_Delete(j);
    }
    esp_http_client_close(c);esp_http_client_cleanup(c);return ok;
}
/* POST with a JSON body; returns the HTTP status (or -1) and, when out is given, the body length in *len (-1 = too large). */
static int post_json(const char *url,const char *bearer,const char *json,char *out,int cap,int *len){
    char auth[KEY_MAX+16];
    esp_http_client_config_t cfg={.url=url,.method=HTTP_METHOD_POST,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=8000,.disable_auto_redirect=true,.buffer_size=2048};
    esp_http_client_handle_t c=esp_http_client_init(&cfg);if(!c)return -1;
    esp_http_client_set_header(c,"Content-Type","application/json");
    if(bearer){snprintf(auth,sizeof(auth),"Bearer %s",bearer);esp_http_client_set_header(c,"Authorization",auth);memset(auth,0,sizeof(auth));}
    int status=-1,size=(int)strlen(json);
    if(esp_http_client_open(c,size)==ESP_OK&&esp_http_client_write(c,json,size)==size&&esp_http_client_fetch_headers(c)>=0){
        status=esp_http_client_get_status_code(c);
        if(out&&len)*len=read_body(c,out,cap);
    }
    esp_http_client_close(c);esp_http_client_cleanup(c);return status;
}
static const char *rpc_url(void){
    if(pin_rpc[0])return pin_rpc;
    if(!rpc_index)for(size_t i=0;i<RPC_COUNT;i++)if(!strcmp(view.rpc,RPC_ALLOWED[i]))return RPC_ALLOWED[i];
    return RPC_ALLOWED[rpc_index%RPC_COUNT];
}
/* Asks the chain about the bill the server named. Leaves chain.valid=false when the chain could not be read. */
static void check_chain(void){
    if(strcmp(chain.contract,view.contract)||strcmp(chain.merchant,view.merchant)||strcmp(chain.bill,view.bill)){
        memset(&chain,0,sizeof(chain));
        snprintf(chain.contract,sizeof(chain.contract),"%s",view.contract);snprintf(chain.merchant,sizeof(chain.merchant),"%s",view.merchant);snprintf(chain.bill,sizeof(chain.bill),"%s",view.bill);
    }
    if(chain.valid&&chain.terminal)return; /* Settled, Refunded and Void never change again */
    char request[BN_RPC_REQUEST_MAX];int len=0;bn_bill_t bill;
    if(!rpc_body||!bill_scratch||bn_rpc_request(request,sizeof(request),view.contract,view.merchant,view.bill)<0){chain.valid=false;return;}
    int status=post_json(rpc_url(),NULL,request,rpc_body,BN_RPC_RESPONSE_MAX+1,&len);
    bn_parse_t parsed=status==200&&len>0?bn_parse_rpc_bill(rpc_body,(size_t)len,bill_scratch,&bill):BN_PARSE_MALFORMED;
    if(parsed!=BN_PARSE_OK){
        chain.valid=false;if(!pin_rpc[0]&&(status!=200||len<=0))rpc_index++; /* try the next node next time */
        ESP_LOGW(TAG,"NEAR_CHAIN unreadable status=%d parse=%d",status,(int)parsed);return;
    }
    chain.show=bn_decide(&bill,view.merchant,view.bill,have_key?pk_hex:"");chain.state=bill.state;chain.valid=true;
    chain.terminal=bill.state==BN_STATE_SETTLED||bill.state==BN_STATE_REFUNDED||bill.state==BN_STATE_VOID;
}
/* Sends this device's public key to the server (first registration wins). Returns the HTTP status or -1. */
static int register_key(void){
    char json[96],url[URL_MAX+ID_MAX+48];
    if(!have_key)return -1;
    snprintf(json,sizeof(json),"{\"pk\":\"%s\"}",pk_hex);snprintf(url,sizeof(url),"%s/near/device/register?d=%s",near_url,near_device);
    int status=post_json(url,near_key,json,NULL,0,NULL);
    ESP_LOGI(TAG,"NEAR_REGISTER status=%d",status);
    return status;
}
/* Signs the witness line for the bill on screen and posts it. True on a 2xx answer. */
static bool send_witness(void){
    char message[BN_ACK_MESSAGE_MAX],sig_hex[2*BITPOS_NEAR_SIG_BYTES+1],json[420],url[URL_MAX+ID_MAX+40];uint8_t sig[BITPOS_NEAR_SIG_BYTES];
    int n=bn_ack_message(message,sizeof(message),view.contract,view.merchant,view.bill);
    if(n<0||!have_key||bitpos_near_ed25519_sign(sig,(const uint8_t *)message,(size_t)n,device_seed,device_pk))return false;
    bn_hex_encode(sig_hex,sig,sizeof(sig));
    snprintf(json,sizeof(json),"{\"bill\":\"%s\",\"sig\":\"%s\",\"pk\":\"%s\"}",view.bill,sig_hex,pk_hex);
    snprintf(url,sizeof(url),"%s/near/device/ack?d=%s",near_url,near_device);
    int status=post_json(url,near_key,json,NULL,0,NULL);
    ESP_LOGI(TAG,"NEAR_WITNESS bill=%s status=%d",view.bill,status);
    return status>=200&&status<300;
}

/* Which scene the device may show now: the server's wish, corrected by what the chain says. */
static scene_t decide(bool online){
    shown.witness=false;shown.note[0]=0;
    if(!online)return SC_OFFLINE;
    if(view.reg){
        /* No key registered for this device yet: nothing else is shown until the server has it. */
        snprintf(shown.note,sizeof(shown.note),"%s",reg_state==2?TR("Another key is already registered for this device","เครื่องนี้มีกุญแจอื่นลงทะเบียนอยู่แล้ว"):
            reg_state==1?TR("Key sent - waiting for the shop","ส่งกุญแจแล้ว - รอร้านยืนยัน"):TR("Sending this key to the shop...","กำลังส่งกุญแจให้ร้าน..."));
        return SC_SETUP;
    }
    if(!strcmp(view.screen,"setup"))return SC_SETUP;
    if(!strcmp(view.screen,"offline"))return SC_OFFLINE;
    if(!strcmp(view.screen,"refunded"))return SC_REFUNDED;
    if(!strcmp(view.screen,"qr"))return view.qr[0]?SC_QR:SC_IDLE;
    if(strcmp(view.screen,"checking")&&strcmp(view.screen,"paid"))return SC_IDLE;
    if(!view.has_bill)return SC_CHECKING; /* "paid" without a bill to check is never shown */
    if(pin_contract[0]&&strcmp(pin_contract,view.contract)){snprintf(shown.note,sizeof(shown.note),"%s",TR("This bill is not from the shop's contract","บิลนี้ไม่ได้มาจากสัญญาของร้าน"));return SC_CHECKING;}
    check_chain();
    if(!chain.valid){snprintf(shown.note,sizeof(shown.note),"%s",TR("Waiting for a NEAR node...","กำลังรอคำตอบจาก NEAR..."));return SC_CHECKING;}
    switch(chain.show){
    case BN_SHOW_QR:return view.qr[0]?SC_QR:SC_CHECKING;
    case BN_SHOW_PAID_WITNESS:shown.witness=true;return SC_PAID;
    case BN_SHOW_PAID:shown.witness=!strcmp(acked,view.bill);return SC_PAID;
    case BN_SHOW_REFUNDED:return SC_REFUNDED;
    case BN_SHOW_IDLE:return SC_IDLE;
    default:
        if(chain.state==BN_STATE_ESCROW)snprintf(shown.note,sizeof(shown.note),"%s",TR("Paid into the bill - another witness is set","เงินเข้าบิลแล้ว - พยานเป็นเครื่องอื่น"));
        else if(chain.state==BN_STATE_PAYOUT_FAILED)snprintf(shown.note,sizeof(shown.note),"%s",TR("Payout is being retried","กำลังลองแบ่งจ่ายใหม่"));
        return SC_CHECKING;
    }
}
static const struct {const char *name;scene_t scene;const char *screen,*big,*qr;} DEMOS[]={
    {"setup",SC_SETUP,"setup","",""},{"idle",SC_IDLE,"idle","",""},{"qr",SC_QR,"qr","4.50 tUSD","https://near-pay.cashlessthailand.com/pay/demo"},
    {"checking",SC_CHECKING,"checking","4.50 tUSD",""},{"paid",SC_PAID,"paid","4.50 tUSD",""},{"refunded",SC_REFUNDED,"refunded","4.50 tUSD",""},{"offline",SC_OFFLINE,"offline","",""}};
/* Shows one sample screen for 30 s, marked DEMO. Runs on the poller task when it exists, so real data is never
 * touched mid-request; sample data has no bill, so nothing can be signed or toned from it. */
static void apply_demo(int i){
    demo_until_us=esp_timer_get_time()+30000000;
    memset(&view,0,sizeof(view));memset(&chain,0,sizeof(chain));
    snprintf(view.screen,sizeof(view.screen),"%s",DEMOS[i].screen);snprintf(view.big,sizeof(view.big),"%s",DEMOS[i].big);
    snprintf(view.qr,sizeof(view.qr),"%s",DEMOS[i].qr);snprintf(view.table,sizeof(view.table),"%s",TR("Table 2","โต๊ะ 2"));
    if(DEMOS[i].scene==SC_QR)snprintf(view.line1,sizeof(view.line1),"Latte x1, Croissant x1");
    if(DEMOS[i].scene==SC_PAID){
        const char *labels[]={TR("Shop","ร้าน"),TR("Barista Mai","บาริสต้า ใหม่"),TR("Tax pot","กองภาษี"),TR("Milk supplier","ค่านม")},*amounts[]={"3.24","0.45","0.31","0.50"};
        for(view.split_count=0;view.split_count<4;view.split_count++){split_t *s=&view.splits[view.split_count];snprintf(s->label,sizeof(s->label),"%s",labels[view.split_count]);snprintf(s->amount,sizeof(s->amount),"%s",amounts[view.split_count]);}
    }
    shown.scene=DEMOS[i].scene;shown.online=DEMOS[i].scene!=SC_OFFLINE;shown.demo=true;shown.witness=DEMOS[i].scene==SC_PAID;shown.note[0]=0;
    draw();printf("NEAR_DEMO %s (sample data, nothing is signed)\n",DEMOS[i].name);
}
static void apply_lang(void){
    int r=lang_request;lang_request=0;bool th=r==1?!lang_th:r==3;
    if(th!=lang_th){lang_th=th;nvs_handle_t h;if(nvs_open_from_partition("bitpos_nvs","near",NVS_READWRITE,&h)==ESP_OK){nvs_set_u8(h,"lang",lang_th);nvs_commit(h);nvs_close(h);}}
    ESP_LOGI(TAG,"NEAR_LANG %s",lang_th?"th":"en");
}
static void poller(void *arg){
    (void)arg;uint32_t last=0;bool rendered=false;int failures=0,ack_failures=0;int64_t ack_retry_us=0,reg_retry_us=0;scene_t real=SC_IDLE;
    for(;;){
        if(demo_request>=0){int d=demo_request;demo_request=-1;apply_demo(d);}
        if(esp_timer_get_time()<demo_until_us){rendered=false;ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(500));continue;}
        if(shown.demo){
            /* A sample screen was up: forget its data so nothing of it can be mistaken for a real bill. */
            shown.demo=false;memset(&view,0,sizeof(view));memset(&chain,0,sizeof(chain));real=SC_IDLE;
            snprintf(view.screen,sizeof(view.screen),"idle");snprintf(view.line1,sizeof(view.line1),"%s",TR("Connecting...","กำลังเชื่อมต่อ..."));
        }
        if(lang_request){apply_lang();rendered=false;}
        if(!poll_active){
            if(!rendered){memset(&view,0,sizeof(view));shown.scene=SC_SETUP;shown.online=true;rendered=draw();}
            ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(1000));continue;
        }
        bool ok=wifi_up&&fetch_view();
        failures=ok?0:failures+1;bool online=failures<3;
        if(ok&&view.reg){
            if(esp_timer_get_time()>=reg_retry_us){
                int status=register_key();reg_state=status>=200&&status<300?1:status==409?2:3;
                reg_retry_us=esp_timer_get_time()+(reg_state==1?5:reg_state==2?60:10)*1000000LL; /* ask again only if the server still wants it */
            }
        } else if(ok){reg_state=0;reg_retry_us=0;}
        scene_t scene=ok||!online?decide(online):real; /* one missed poll keeps the last decided scene */
        real=scene;
        /* Re-render only when what the screen shows changed (FNV-1a over the fields). */
        uint32_t sig=2166136261u;const char *fields[]={view.screen,view.title,view.line1,view.line2,view.big,view.qr,view.table,view.bill,shown.note};
        for(size_t f=0;f<sizeof(fields)/sizeof(fields[0]);f++)for(const char *p=fields[f];;p++){sig=(sig^(uint8_t)*p)*16777619u;if(!*p)break;}
        for(int k=0;k<view.split_count;k++){for(const char *p=view.splits[k].label;*p;p++)sig=(sig^(uint8_t)*p)*16777619u;for(const char *p=view.splits[k].amount;*p;p++)sig=(sig^(uint8_t)*p)*16777619u;}
        sig=(sig^(uint32_t)scene^((uint32_t)view.reg<<3)^((uint32_t)online<<4)^((uint32_t)shown.witness<<5)^((uint32_t)lang_th<<6)^((uint32_t)have_key<<7))*16777619u;
        if(sig!=last||!rendered){
            shown.scene=scene;shown.online=online;
            bool flushed=draw();rendered=flushed;if(flushed)last=sig;
            /* The paid frame for this bill reached the panel: only now may the device witness it. */
            if(flushed&&scene==SC_PAID&&view.has_bill)snprintf(flushed_paid,sizeof(flushed_paid),"%s",view.bill);
        }
        if(shown.scene==SC_PAID&&rendered&&view.has_bill&&chain.valid&&!strcmp(chain.bill,view.bill)&&!strcmp(flushed_paid,view.bill)){
            /* Paid cue once per bill, after the frame is on the panel; the claim is stored first so a restart never replays it. */
            if(strcmp(toned,view.bill)){snprintf(toned,sizeof(toned),"%s",view.bill);store_string("toned",toned);bitpos_audio_play_success(view.bill,1);}
            /* Witness: chain says Escrow with this device's key, the frame is flushed, and this bill was not acked before. */
            if(chain.show==BN_SHOW_PAID_WITNESS&&strcmp(acked,view.bill)&&esp_timer_get_time()>=ack_retry_us){
                if(send_witness()){snprintf(acked,sizeof(acked),"%s",view.bill);store_string("acked",acked);ack_failures=0;ack_retry_us=0;}
                else{int wait=2<<(ack_failures<4?ack_failures:4);ack_failures++;ack_retry_us=esp_timer_get_time()+(int64_t)wait*1000000;} /* 2,4,8,16,32 s */
            }
        }
        bool busy=view.has_bill&&(!strcmp(view.screen,"checking")||!strcmp(view.screen,"paid"))&&!(chain.valid&&chain.terminal);
        ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(!ok?3000:busy?1500:view.poll_ms)); /* a button press wakes the poller at once */
    }
}

static void wifi_event(void *arg,esp_event_base_t base,int32_t id,void *data){
    (void)arg;(void)data;
    if(base==WIFI_EVENT&&(id==WIFI_EVENT_STA_START||id==WIFI_EVENT_STA_DISCONNECTED)){wifi_up=false;if(wifi_wanted)esp_wifi_connect();}
    if(base==IP_EVENT&&id==IP_EVENT_STA_GOT_IP)wifi_up=true;
}

/* ---- USB ---------------------------------------------------------------------------------------------------- */
static bool safe(const char *s,size_t max,bool url){
    size_t n=strlen(s);if(!n||n>=max)return false;
    for(size_t i=0;i<n;i++){unsigned char c=(unsigned char)s[i];if(!(isalnum(c)||c=='-'||c=='_'||(url&&(c==':'||c=='/'||c=='.'))))return false;}
    return true;
}
static void selftest(void){
    static const uint8_t seed[32]={0x9d,0x61,0xb1,0x9d,0xef,0xfd,0x5a,0x60,0xba,0x84,0x4a,0xf4,0x92,0xec,0x2c,0xc4,0x44,0x49,0xc5,0x69,0x7b,0x32,0x69,0x19,0x70,0x3b,0xac,0x03,0x1c,0xae,0x7f,0x60};
    static const char want[]="e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
    uint8_t pk[32],sig[64];char hex[129];int64_t started=esp_timer_get_time();
    bitpos_near_ed25519_public(pk,seed);bitpos_near_ed25519_sign(sig,(const uint8_t *)"",0,seed,pk);bn_hex_encode(hex,sig,64);
    bool rfc=!strcmp(hex,want)&&bitpos_near_ed25519_verify(sig,(const uint8_t *)"",0,pk)==0,own=false;
    if(have_key){const char *m="bitpos-near-selftest";own=bitpos_near_ed25519_sign(sig,(const uint8_t *)m,strlen(m),device_seed,device_pk)==0&&bitpos_near_ed25519_verify(sig,(const uint8_t *)m,strlen(m),device_pk)==0;}
    printf("NEAR_SELFTEST rfc8032=%s device_key=%s ms=%d\n",rfc?"ok":"FAILED",have_key?(own?"ok":"FAILED"):"missing",(int)((esp_timer_get_time()-started)/1000));
}
static void usb(void *arg){
    (void)arg;usb_serial_jtag_driver_config_t cfg=USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();usb_serial_jtag_driver_install(&cfg);
    char line[320];size_t n=0;uint8_t ch;
    for(;;){
        if(usb_serial_jtag_read_bytes(&ch,1,portMAX_DELAY)!=1)continue;
        if(ch!='\n'&&ch!='\r'){if(n<sizeof(line)-1)line[n++]=(char)ch;continue;}
        line[n]=0;n=0;char cmd[24]={0},a[URL_MAX]={0},b[RPC_MAX]={0},k[KEY_MAX]={0};
        int parts=sscanf(line,"%23s %159s %95s %63s",cmd,a,b,k);memset(line,0,sizeof(line));
        if(!strcmp(cmd,"NEAR_LANG")){
            lang_request=!strcmp(a,"th")?3:!strcmp(a,"en")?2:1;
            if(poller_task)xTaskNotifyGive(poller_task);else{apply_lang();draw();}
            printf("NEAR_LANG requested\n");
        }
        else if(!strcmp(cmd,"NEAR_DEMO")){
            int found=-1;for(size_t i=0;i<sizeof(DEMOS)/sizeof(DEMOS[0]);i++)if(!strcmp(a,DEMOS[i].name))found=(int)i;
            if(found<0)printf("NEAR_ERROR unknown demo screen\n");
            else if(poller_task){demo_request=found;xTaskNotifyGive(poller_task);}
            else apply_demo(found);
        }
        else if(!strcmp(cmd,"NEAR_SELFTEST"))selftest();
        else if(!strcmp(cmd,"NEAR_SHOT")){
            /* Screenshot for layout checks: the RGB565 frame LVGL rendered, as hex rows. Shows only what is on screen. */
            uint16_t *frame=heap_caps_malloc(480*320*2,MALLOC_CAP_SPIRAM);
            if(frame&&display_engine_lock(2000)){lv_draw_buf_t *fb=lv_display_get_buf_active(NULL);bool ok=fb&&fb->data&&fb->header.w==480&&fb->header.h==320;
                if(ok)memcpy(frame,fb->data,480*320*2);
                display_engine_unlock();
                if(ok){printf("NEAR_SHOT_BEGIN 480 320\n");static char row[480*4+8];
                    for(int y=0;y<320;y++){for(int x=0;x<480;x++)sprintf(row+x*4,"%04x",frame[y*480+x]);printf("S%03d %s\n",y,row);if(y%16==0)vTaskDelay(1);}
                    printf("NEAR_SHOT_END\n");}
                else printf("NEAR_SHOT failed\n");}
            heap_caps_free(frame);
        }
        else if(!strcmp(cmd,"NEAR_STATUS")){
            bool configured=shown.configured;
            printf("NEAR_STATUS configured=%d device=%s version=%s pk=%s near_pk=%s%s contract_pin=%s rpc_pin=%s last_witnessed=%s\n",configured,near_device[0]?near_device:"-",
                esp_app_get_description()->version,have_key?pk_hex:"-",have_key?"ed25519:":"",have_key?pk_b58:"-",pin_contract[0]?pin_contract:"-",pin_rpc[0]?pin_rpc:"-",acked[0]?acked:"-");
        }
        else if(!strcmp(cmd,"NEAR_FORGET")){
            nvs_handle_t h;
            if(nvs_open_from_partition("bitpos_nvs","near",NVS_READWRITE,&h)==ESP_OK){
                if(!strcmp(a,"key"))nvs_erase_all(h);
                else{const char *keys[]={"url","device","key","contract","rpc","acked","toned","lang"};for(size_t i=0;i<sizeof(keys)/sizeof(keys[0]);i++)nvs_erase_key(h,keys[i]);}
                nvs_commit(h);nvs_close(h);}
            printf("NEAR_FORGET ok%s\n",!strcmp(a,"key")?" (witness key erased)":" (witness key kept)");vTaskDelay(pdMS_TO_TICKS(200));esp_restart();
        }
        else if(!strcmp(cmd,"NEAR_PIN")&&parts>=2){
            bool clear=!strcmp(a,"clear"),ok=clear||(bn_valid_account(a)&&(parts==2||(!strncmp(b,"https://",8)&&safe(b,sizeof(b),true))));
            if(ok){
                nvs_handle_t h;ok=nvs_open_from_partition("bitpos_nvs","near",NVS_READWRITE,&h)==ESP_OK;
                if(ok){
                    if(clear){nvs_erase_key(h,"contract");nvs_erase_key(h,"rpc");}
                    else{ok=nvs_set_str(h,"contract",a)==ESP_OK;if(parts>=3)ok=ok&&nvs_set_str(h,"rpc",b)==ESP_OK;else nvs_erase_key(h,"rpc");}
                    ok=ok&&nvs_commit(h)==ESP_OK;nvs_close(h);}
            }
            printf("NEAR_PIN %s\n",ok?"ok":"failed");
            if(ok){vTaskDelay(pdMS_TO_TICKS(200));esp_restart();}
        }
        else if(!strcmp(cmd,"NEAR_PROVISION")&&parts==4&&!strncmp(a,"https://",8)&&safe(a,sizeof(a),true)&&strlen(b)==36&&safe(b,sizeof(b),false)&&safe(k,sizeof(k),false)){
            nvs_handle_t h;bool ok=nvs_open_from_partition("bitpos_nvs","near",NVS_READWRITE,&h)==ESP_OK;
            if(ok){ok=nvs_set_str(h,"url",a)==ESP_OK&&nvs_set_str(h,"device",b)==ESP_OK&&nvs_set_str(h,"key",k)==ESP_OK&&nvs_commit(h)==ESP_OK;nvs_close(h);}
            memset(k,0,sizeof(k));printf("NEAR_PROVISION %s\n",ok?"ok":"failed");
            if(ok){vTaskDelay(pdMS_TO_TICKS(200));esp_restart();}
        } else if(cmd[0])printf("NEAR_ERROR unknown or invalid command\n");
        memset(k,0,sizeof(k));
    }
}
static void audio_start(void *arg){(void)arg;bitpos_audio_init();vTaskDelete(NULL);}

void bitpos_near_main(void){
    esp_log_level_set("display",ESP_LOG_WARN); /* LCD transfer errors only; no request data */
    ESP_LOGI(TAG,"BOOT product=bitpos_terminal_near version=%s",esp_app_get_description()->version);
    bool configured=load();shown.configured=configured;shown.online=true;shown.scene=SC_SETUP;
    xTaskCreate(usb,"near_usb",12288,NULL,4,NULL);
    draw(); /* "making key..." until the RNG may be used */
    rpc_body=heap_caps_malloc(BN_RPC_RESPONSE_MAX+1,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);bill_scratch=heap_caps_malloc(BN_BILL_JSON_MAX,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    /* WiFi is started even without credentials: the RF subsystem must be on before the witness key is made. */
    char ssid[33]={0},password[65]={0};nvs_handle_t n;
    if(nvs_open_from_partition("bitpos_nvs","config",NVS_READONLY,&n)==ESP_OK){
        size_t a=sizeof(ssid),b=sizeof(password);
        if(nvs_get_str(n,"ssid",ssid,&a)!=ESP_OK||nvs_get_str(n,"password",password,&b)!=ESP_OK)ssid[0]=0;
        nvs_close(n);
    }
    ESP_ERROR_CHECK(esp_netif_init());ESP_ERROR_CHECK(esp_event_loop_create_default());esp_netif_create_default_wifi_sta();
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();ESP_ERROR_CHECK(esp_wifi_init(&init));ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    if(ssid[0]){
        wifi_config_t cfg={0};memcpy(cfg.sta.ssid,ssid,strlen(ssid));memcpy(cfg.sta.password,password,strlen(password));
        cfg.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK;cfg.sta.pmf_cfg.capable=true;
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&cfg));wifi_wanted=configured;
    } else ESP_LOGW(TAG,"no WiFi credentials in bitpos_nvs/config");
    memset(password,0,sizeof(password));
    ESP_ERROR_CHECK(esp_wifi_start());ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    vTaskDelay(pdMS_TO_TICKS(300)); /* RF is up: the hardware RNG is now a true RNG */
    if(!ensure_key())ESP_LOGE(TAG,"NEAR_KEY unavailable");
    else ESP_LOGI(TAG,"NEAR_KEY pk=%s",pk_hex);
    draw();
    xTaskCreate(audio_start,"near_audio",8192,NULL,3,NULL);
    poll_active=configured&&ssid[0]&&have_key; /* otherwise it stays on the setup screen; USB commands and the language button still work */
    if(poll_active){snprintf(view.screen,sizeof(view.screen),"idle");snprintf(view.line1,sizeof(view.line1),"%s",TR("Connecting...","กำลังเชื่อมต่อ..."));}
    xTaskCreate(poller,"near_poll",16384,NULL,5,&poller_task);
}
#endif
