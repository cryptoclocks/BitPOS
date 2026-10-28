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
 * The key is never logged. Text must stay within the device font (ASCII and Thai); the server keeps to that. "META_STATUS" prints whether settings exist; "META_FORGET" erases the meta namespace. */
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
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "lvgl.h"
#include "display_engine.h"
#include "bitpos_meta.h"

LV_FONT_DECLARE(bitpos_font_20);
static const char *TAG="BitPOSMeta";
#define URL_MAX 160
#define ID_MAX 40
#define KEY_MAX 64
#define BODY_MAX 2048
static char meta_url[URL_MAX],meta_device[ID_MAX],meta_key[KEY_MAX];
static volatile bool wifi_up;
static struct {char screen[16],tone[10],table[40],title[96],line1[128],line2[128],big[24],qr[200];int countdown;int poll_ms;int64_t fetched_us;bool online;} view;
static lv_obj_t *countdown_label;

static uint32_t tone_bg(const char *t){
    if(!strcmp(t,"green"))return 0x1E8E3E;
    if(!strcmp(t,"red"))return 0xD3203A;
    if(!strcmp(t,"violet"))return 0x7A3FF2;
    if(!strcmp(t,"blue"))return 0x0866FF;
    if(!strcmp(t,"amber"))return 0xFFF4D6;
    return 0xFFFFFF;
}
static bool dark(const char *t){return !strcmp(t,"green")||!strcmp(t,"red")||!strcmp(t,"violet")||!strcmp(t,"blue");}

static lv_obj_t *text(lv_obj_t *parent,const char *s,int x,int y,int w,const lv_font_t *font,uint32_t color,lv_text_align_t align){
    lv_obj_t *l=lv_label_create(parent);lv_label_set_text(l,s);lv_obj_set_style_text_font(l,font,0);lv_obj_set_style_text_color(l,lv_color_hex(color),0);
    lv_obj_set_width(l,w);lv_label_set_long_mode(l,LV_LABEL_LONG_WRAP);lv_obj_set_style_text_align(l,align,0);lv_obj_set_pos(l,x,y);return l;
}

/* One template for every screen; layout depends only on which fields the server sent. Call with the LVGL lock. */
static void render(void){
    lv_obj_t *scr=lv_screen_active();lv_obj_clean(scr);countdown_label=NULL;
    const char *tone=view.online?view.tone:"white";bool d=view.online&&dark(tone);
    uint32_t fg=d?0xFFFFFF:0x1C2B33,muted=d?0xFFFFFF:0x65676B;
    lv_obj_set_style_bg_color(scr,lv_color_hex(view.online?tone_bg(tone):0xFFF4D6),0);lv_obj_set_style_bg_opa(scr,LV_OPA_COVER,0);
    lv_obj_t *bar=lv_obj_create(scr);lv_obj_remove_style_all(bar);lv_obj_set_size(bar,480,34);lv_obj_set_style_bg_color(bar,lv_color_hex(d?0x000000:0xF0F2F5),0);
    lv_obj_set_style_bg_opa(bar,d?LV_OPA_20:LV_OPA_COVER,0);
    text(bar,view.table[0]?view.table:"BitPOS x Muse",12,7,230,&bitpos_font_20,fg,LV_TEXT_ALIGN_LEFT);
    text(bar,view.online?"ออนไลน์":"ออฟไลน์",340,7,128,&bitpos_font_20,view.online?(d?0xFFFFFF:0x1E8E3E):0x8A5A00,LV_TEXT_ALIGN_RIGHT);
    if(!view.online){
        text(scr,"กำลังเชื่อมต่อใหม่…",20,110,440,&bitpos_font_20,0x1C2B33,LV_TEXT_ALIGN_CENTER);
        text(scr,"ออเดอร์ที่ค้างจะไม่หาย - ไม่ตัดเงินซ้ำ",20,150,440,&bitpos_font_20,0x65676B,LV_TEXT_ALIGN_CENTER);return;
    }
    int x=20,w=440;
    if(view.qr[0]){
        lv_obj_t *qr=lv_qrcode_create(scr);lv_qrcode_set_size(qr,190);lv_qrcode_set_dark_color(qr,lv_color_hex(0x1C2B33));lv_qrcode_set_light_color(qr,lv_color_hex(0xFFFFFF));
        lv_qrcode_update(qr,view.qr,strlen(view.qr));lv_obj_set_pos(qr,16,62);lv_obj_set_style_border_color(qr,lv_color_hex(0xFFFFFF),0);lv_obj_set_style_border_width(qr,6,0);
        text(scr,"QR ของ Stripe (sandbox)",8,262,206,&bitpos_font_20,muted,LV_TEXT_ALIGN_CENTER);x=232;w=232;
    }
    int y=view.qr[0]?60:52;
    if(view.title[0]){lv_obj_t *t=text(scr,view.title,x,y,w,&bitpos_font_20,fg,view.qr[0]?LV_TEXT_ALIGN_LEFT:LV_TEXT_ALIGN_CENTER);lv_obj_update_layout(t);y+=lv_obj_get_height(t)+8;}
    if(view.big[0]){text(scr,view.big,x,y,w,&lv_font_montserrat_48,d?0xFFFFFF:0x0866FF,view.qr[0]?LV_TEXT_ALIGN_LEFT:LV_TEXT_ALIGN_CENTER);y+=62;}
    if(view.countdown>0){countdown_label=text(scr,"--:--",x,y,w,&lv_font_montserrat_48,fg,LV_TEXT_ALIGN_CENTER);y+=62;}
    if(view.line1[0]){lv_obj_t *t=text(scr,view.line1,x,y,w,&bitpos_font_20,muted,view.qr[0]?LV_TEXT_ALIGN_LEFT:LV_TEXT_ALIGN_CENTER);lv_obj_update_layout(t);y+=lv_obj_get_height(t)+4;}
    if(view.line2[0])text(scr,view.line2,x,y,w,&bitpos_font_20,muted,view.qr[0]?LV_TEXT_ALIGN_LEFT:LV_TEXT_ALIGN_CENTER);
}
static void tick(lv_timer_t *t){
    (void)t;if(!countdown_label||view.countdown<=0)return;
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
            cJSON *cd=cJSON_GetObjectItemCaseSensitive(j,"countdown_s"),*pm=cJSON_GetObjectItemCaseSensitive(j,"poll_ms");
            view.countdown=cJSON_IsNumber(cd)?cd->valueint:0;view.poll_ms=cJSON_IsNumber(pm)&&pm->valueint>=1000&&pm->valueint<=30000?pm->valueint:2000;
            view.fetched_us=esp_timer_get_time();ok=true;
        }
        cJSON_Delete(j);
    }
    esp_http_client_close(c);esp_http_client_cleanup(c);return ok;
}
static void poller(void *arg){
    (void)arg;uint32_t last=0;bool rendered=false;int failures=0;
    for(;;){
        bool ok=wifi_up&&fetch_view();
        failures=ok?0:failures+1;bool online=failures<3;
        /* Re-render only when what the screen shows changed (FNV-1a over the fields). */
        uint32_t sig=2166136261u;const char *fields[]={view.screen,view.tone,view.title,view.line1,view.line2,view.big,view.qr,view.table};
        for(size_t f=0;f<sizeof(fields)/sizeof(fields[0]);f++)for(const char *p=fields[f];;p++){sig=(sig^(uint8_t)*p)*16777619u;if(!*p)break;}
        sig=(sig^(uint32_t)online^((uint32_t)(view.countdown>0)<<1))*16777619u;
        if((sig!=last||!rendered)&&display_engine_lock(1000)){view.online=online;render();display_engine_unlock();last=sig;rendered=true;}
        vTaskDelay(pdMS_TO_TICKS(ok?view.poll_ms:3000));
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
        if(!strcmp(cmd,"META_STATUS")){printf("META_STATUS configured=%d device=%s version=%s\n",load(),meta_device[0]?meta_device:"-",esp_app_get_description()->version);}
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
    ESP_LOGI(TAG,"BOOT product=bitpos_terminal_meta version=%s",esp_app_get_description()->version);
    xTaskCreate(provisioning,"meta_usb",4096,NULL,4,NULL);
    bool configured=load();
    snprintf(view.tone,sizeof(view.tone),"white");
    if(display_engine_lock(2000)){
        view.online=true;
        if(!configured){snprintf(view.title,sizeof(view.title),"ตั้งค่าเครื่อง BitPOS Mini (Meta)");snprintf(view.line1,sizeof(view.line1),"ต่อ USB แล้วส่งคำสั่ง META_PROVISION");snprintf(view.line2,sizeof(view.line2),"ดู device/firmware/README.md");}
        else {snprintf(view.title,sizeof(view.title),"BitPOS x Muse");snprintf(view.line1,sizeof(view.line1),"กำลังเชื่อมต่อ…");}
        render();lv_timer_create(tick,250,NULL);display_engine_unlock();
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
    xTaskCreate(poller,"meta_poll",8192,NULL,5,NULL);
}
