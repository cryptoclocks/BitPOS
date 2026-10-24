#include "bitpos_promotion.h"
#include "mbedtls/sha256.h"
#include <string.h>
#include <math.h>

static bool opaque(const char *s,size_t n) {
    if(strlen(s)!=n)return false;
    for(size_t i=0;i<n;i++)if(!((s[i]>='A'&&s[i]<='Z')||(s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')||s[i]=='-'||s[i]=='_'))return false;
    return true;
}
static bool lower_hash(const char *s) {
    if(strlen(s)!=64)return false;
    for(unsigned i=0;i<64;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;
    return true;
}
bool promotion_image_url(const char *origin,const char *url) {
    static const char path[]="/api/promotions/media/",suffix[]="/image.rgb565";
    size_t n=strlen(origin),p=sizeof(path)-1;
    if(strncmp(origin,"https://",8)||!origin[8]||strpbrk(origin+8,"/?#@\\\r\n ")||
       strncmp(url,origin,n)||strncmp(url+n,path,p)||strlen(url+n+p)!=43+sizeof(suffix)-1||strcmp(url+n+p+43,suffix))return false;
    char token[44];memcpy(token,url+n+p,43);token[43]=0;return opaque(token,43);
}
static bool id(cJSON *p,const char *key,char *out){return table_text(p,key,out,TABLE_UUID)&&table_uuid(out);}
typedef enum { PROMOTION_LEGACY, PROMOTION_PLAYLIST } promotion_mode_t;
static bool promotion_fields(const table_state_t *s,cJSON *payload,promotion_t *p,promotion_mode_t mode) {
    cJSON *percent=cJSON_GetObjectItemCaseSensitive(payload,"discountPercent");
    if(!id(payload,"targetId",p->target)||!id(payload,"campaignId",p->campaign)||!id(payload,"productId",p->product)||
       !table_text(payload,"headline",p->headline,sizeof(p->headline))||!p->headline[0]||!table_display_text(p->headline)||
       !table_text(payload,"copy",p->copy,sizeof(p->copy))||!p->copy[0]||!table_display_text(p->copy)||
       !cJSON_IsNumber(percent)||percent->valuedouble<1||percent->valuedouble>99||floor(percent->valuedouble)!=percent->valuedouble||
       !table_money(cJSON_GetObjectItemCaseSensitive(payload,"unitPrice"),&p->unit,false)||
       !table_money(cJSON_GetObjectItemCaseSensitive(payload,"basePrice"),&p->base,false)||
       strcmp(p->unit.currency,p->base.currency)||p->unit.decimals!=p->base.decimals||!p->unit.minor||p->unit.minor>=p->base.minor||
       !table_timestamp(payload,"expiresAt",&p->expires_ms))return false;
    p->percent=(unsigned)percent->valuedouble;
    uint64_t discount=p->base.minor/100*p->percent+(p->base.minor%100)*p->percent/100;
    cJSON *bundle=cJSON_GetObjectItemCaseSensitive(payload,"bundle");
    if(bundle&&!cJSON_IsBool(bundle))return false;
    p->bundle=cJSON_IsTrue(bundle);
    if(p->bundle){if(!table_text(payload,"discountLabel",p->discount_label,sizeof(p->discount_label))||!p->discount_label[0]||!table_display_text(p->discount_label))return false;}
    else if(p->unit.minor!=p->base.minor-discount)return false;
    if(strncmp(s->payment_origin,"https://",8))return false;
    if(mode==PROMOTION_PLAYLIST&&!s->table_id[0]&&!s->table_entry_url[0]){
        /* A counter daily ad has no ordering URL, not an empty/fake QR. */
        if(!cJSON_IsNull(cJSON_GetObjectItemCaseSensitive(payload,"menuUrl")))return false;
    }else{
        if(!table_text(payload,"menuUrl",p->menu_url,sizeof(p->menu_url)))return false;
        size_t entry=strlen(s->table_entry_url);
        if(!entry)return false;
        if(mode==PROMOTION_PLAYLIST){
            if(!s->table_id[0]||strcmp(p->menu_url,s->table_entry_url))return false;
        }else{
            if(strncmp(p->menu_url,s->table_entry_url,entry))return false;
            const char *suffix=p->menu_url+entry;
            /* Historical PROMOTION retains its opaque offer suffix. */
            if(*suffix){
                if(strncmp(suffix,"?offer=",7)||!opaque(suffix+7,43))return false;
                strcpy(p->offer,suffix+7);
            }
        }
    }
    cJSON *image=cJSON_GetObjectItemCaseSensitive(payload,"image");
    if(!cJSON_IsNull(image)) {
        char format[16];cJSON *bytes=cJSON_GetObjectItemCaseSensitive(image,"bytes"),*width=cJSON_GetObjectItemCaseSensitive(image,"width"),*height=cJSON_GetObjectItemCaseSensitive(image,"height");
        if(!table_text(image,"url",p->image_url,sizeof(p->image_url))||!promotion_image_url(s->payment_origin,p->image_url)||
           !table_text(image,"sha256",p->sha256,sizeof(p->sha256))||!lower_hash(p->sha256)||
           !table_text(image,"format",format,sizeof(format))||strcmp(format,"rgb565le")||
           !cJSON_IsNumber(bytes)||bytes->valuedouble!=PROMOTION_BYTES||!cJSON_IsNumber(width)||width->valuedouble!=280||
           !cJSON_IsNumber(height)||height->valuedouble!=200)return false;
        p->has_image=true;
    }
    return true;
}
bool promotion_parse(const table_state_t *s,cJSON *j,promotion_t *out) {
    promotion_t p={0};char state[16],device[TABLE_UUID],type[32];uint64_t connection,seq;
    cJSON *payload=cJSON_GetObjectItemCaseSensitive(j,"payload");
    if(!s->configured||!s->auth||!table_text(j,"type",type,sizeof(type))||strcmp(type,"PROMOTION")||
       !id(j,"deviceId",device)||strcmp(device,s->device)||
       !table_integer(j,"connectionGeneration",&connection)||connection!=s->connection||
       !table_integer(j,"deviceSeq",&seq)||!seq||seq<s->seq||
       !table_integer(j,"screenGeneration",&p.screen)||p.screen!=s->screen||
       !table_integer(j,"assignmentGeneration",&p.assignment)||p.assignment!=s->assignment||
       !table_integer(j,"authGeneration",&p.auth)||p.auth!=s->auth||
       !table_text(payload,"state",state,sizeof(state))||(strcmp(state,"READY")&&strcmp(state,"CANCELED"))||
       !promotion_fields(s,payload,&p,PROMOTION_LEGACY)||!p.offer[0])return false;
    p.canceled=!strcmp(state,"CANCELED");p.active=!p.canceled;*out=p;return true;
}
bool promotion_playlist_parse(const table_state_t *s,cJSON *payload,uint64_t screen,promotion_playlist_t *out) {
    promotion_playlist_t p={0};char state[16];
    cJSON *items=cJSON_GetObjectItemCaseSensitive(payload,"items"),*occupancy=cJSON_GetObjectItemCaseSensitive(payload,"occupancyGeneration"),
          *table_id=cJSON_GetObjectItemCaseSensitive(payload,"tableId");
    if(!s->configured||!s->auth||!screen||screen<s->screen||
       !table_integer(payload,"generation",&p.generation)||!p.generation||
       !table_text(payload,"state",state,sizeof(state))||strcmp(state,"CURRENT")||
       !cJSON_IsArray(items)||cJSON_GetArraySize(items)>PROMOTION_PLAYLIST_ITEMS)return false;
    if(!cJSON_IsNull(table_id)&&!id(payload,"tableId",p.table_id))return false;
    if(strcmp(p.table_id,s->table_id))return false;
    if(!cJSON_IsNull(occupancy)&&(!table_integer(payload,"occupancyGeneration",&p.occupancy)||!p.occupancy||!p.table_id[0]))return false;
    p.screen=screen;p.assignment=s->assignment;p.auth=s->auth;
    unsigned daily=0,personal=0;cJSON *item;
    for(item=items->child;item;item=item->next){
        promotion_t *v=&p.items[p.count];char audience[16];cJSON *version=cJSON_GetObjectItemCaseSensitive(item,"campaignVersion");
        if(!table_text(item,"audience",audience,sizeof(audience))||
           (strcmp(audience,"daily")&&strcmp(audience,"personal"))||
           !cJSON_IsNumber(version)||version->valuedouble<1||version->valuedouble>INT32_MAX||floor(version->valuedouble)!=version->valuedouble||
           !promotion_fields(s,item,v,PROMOTION_PLAYLIST)||
           !table_timestamp(item,"startsAt",&v->starts_ms)||v->expires_ms<=v->starts_ms||
           v->expires_ms-v->starts_ms>604800000)return false;
        v->personal=!strcmp(audience,"personal");
        if(v->personal){if(++personal>1||!p.occupancy||!p.table_id[0]||v->expires_ms-v->starts_ms>600000)return false;}
        else if(++daily>3)return false;
        for(unsigned i=0;i<p.count;i++)if(!strcmp(p.items[i].target,v->target))return false;
        v->campaign_version=(unsigned)version->valuedouble;v->active=true;
        v->playlist_generation=p.generation;v->occupancy=p.occupancy;strcpy(v->table_id,p.table_id);
        v->screen=screen;v->assignment=p.assignment;v->auth=p.auth;p.count++;
    }
    *out=p;return true;
}
bool promotion_playlist_event(const table_state_t *s,cJSON *j,promotion_playlist_t *out) {
    char type[32],device[TABLE_UUID];uint64_t connection,seq,screen,assignment,auth;
    if(!table_text(j,"type",type,sizeof(type))||strcmp(type,"PROMOTION_PLAYLIST")||
       !id(j,"deviceId",device)||strcmp(device,s->device)||
       !table_integer(j,"connectionGeneration",&connection)||connection!=s->connection||
       !table_integer(j,"deviceSeq",&seq)||!seq||seq<s->seq||
       !table_integer(j,"screenGeneration",&screen)||screen!=s->screen||
       !table_integer(j,"assignmentGeneration",&assignment)||assignment!=s->assignment||
       !table_integer(j,"authGeneration",&auth)||auth!=s->auth)return false;
    return promotion_playlist_parse(s,cJSON_GetObjectItemCaseSensitive(j,"payload"),screen,out);
}
bool promotion_item_current(const promotion_t *p,int64_t now){return p->active&&now>=p->starts_ms&&now<p->expires_ms;}
int promotion_playlist_select(const promotion_playlist_t *p,int64_t now,unsigned phase,unsigned daily_index) {
    int daily[PROMOTION_PLAYLIST_ITEMS],personal=-1;unsigned count=0;
    for(unsigned i=0;i<p->count;i++)if(promotion_item_current(&p->items[i],now)){
        if(p->items[i].personal)personal=(int)i;else daily[count++]=(int)i;
    }
    if(phase%3==1&&personal>=0)return personal;
    return count?daily[daily_index%count]:personal;
}
bool promotion_hash(const uint8_t *pixels,size_t length,const char *expected) {
    if(length!=PROMOTION_BYTES||!lower_hash(expected))return false;
    uint8_t digest[32];if(mbedtls_sha256(pixels,length,digest,0))return false;
    static const char hex[]="0123456789abcdef";
    for(unsigned i=0;i<32;i++)if(expected[2*i]!=hex[digest[i]>>4]||expected[2*i+1]!=hex[digest[i]&15])return false;
    return true;
}
/* Two buffers are persistent; only a worker writes FREE/LOADING, never PINNED.
 * The slot state is also the publication barrier for descriptor/hash/target. */
enum { FREE,LOADING,READY,PINNED };
static struct { atomic_uint state;char target[TABLE_UUID],hash[65];uint64_t generation,occupancy,assignment,auth;lv_image_dsc_t image; } slots[PROMOTION_SLOTS];
static promotion_image_ops_t image_ops;
static atomic_uint image_serial,image_revision;
static atomic_bool image_supported;
static atomic_uint fallback;
static int pinned=-1;
enum { FALLBACK_MISSING,FALLBACK_LOADING,FALLBACK_STORAGE,FALLBACK_NETWORK,FALLBACK_HASH,FALLBACK_BUSY,FALLBACK_NONE };
bool promotion_images_init(uint8_t *a,uint8_t *b,const promotion_image_ops_t *ops) {
    if(atomic_load(&image_supported))return true;
    if(!a||!b||!ops||!ops->read||!ops->write||!ops->download||!ops->enqueue)return false;
    image_ops=*ops;uint8_t *data[]={a,b};
    for(unsigned i=0;i<PROMOTION_SLOTS;i++)slots[i].image=(lv_image_dsc_t){.header={.magic=LV_IMAGE_HEADER_MAGIC,.cf=LV_COLOR_FORMAT_RGB565,.w=280,.h=200,.stride=560},.data_size=PROMOTION_BYTES,.data=data[i]};
    atomic_store(&image_supported,true);return true;
}
bool promotion_images_supported(void){return atomic_load(&image_supported);}
unsigned promotion_image_request(const promotion_t *p) {
    unsigned serial=atomic_fetch_add(&image_serial,1)+1;
    atomic_store(&fallback,p->has_image?FALLBACK_LOADING:FALLBACK_MISSING);
    atomic_fetch_add(&image_revision,1);
    if(p->has_image&&(!promotion_images_supported()||!image_ops.enqueue(p,serial))){atomic_store(&fallback,FALLBACK_BUSY);atomic_fetch_add(&image_revision,1);}
    return serial;
}
void promotion_image_cancel(void){atomic_fetch_add(&image_serial,1);}
bool promotion_image_canceled(unsigned serial){return serial!=atomic_load(&image_serial);}
static void failure(unsigned slot,unsigned serial,unsigned reason) {
    atomic_store(&slots[slot].state,FREE);
    if(!promotion_image_canceled(serial)){atomic_store(&fallback,reason);atomic_fetch_add(&image_revision,1);}
}
void promotion_image_work(const promotion_t *job,unsigned serial) {
    if(!promotion_images_supported()||promotion_image_canceled(serial))return;
    int slot=-1;
    for(unsigned i=0;i<PROMOTION_SLOTS;i++){
        unsigned state=atomic_load(&slots[i].state);
        if((state==FREE||state==READY)&&atomic_compare_exchange_strong(&slots[i].state,&state,LOADING)){slot=(int)i;break;}
    }
    if(slot<0){atomic_store(&fallback,FALLBACK_BUSY);atomic_fetch_add(&image_revision,1);return;}
    uint8_t *pixels=(uint8_t *)slots[slot].image.data;
    bool cached=false;
    for(unsigned i=0;i<PROMOTION_SLOTS&&!cached&&!promotion_image_canceled(serial);i++)
        cached=image_ops.read(i,job->sha256,pixels)&&promotion_hash(pixels,PROMOTION_BYTES,job->sha256);
    if(!cached) {
        if(promotion_image_canceled(serial)||!image_ops.download(job,pixels,serial)){failure((unsigned)slot,serial,FALLBACK_NETWORK);return;}
        if(!promotion_hash(pixels,PROMOTION_BYTES,job->sha256)){failure((unsigned)slot,serial,FALLBACK_HASH);return;}
        if(promotion_image_canceled(serial)||!image_ops.write((unsigned)slot,job->sha256,pixels)||
           !image_ops.read((unsigned)slot,job->sha256,pixels)||!promotion_hash(pixels,PROMOTION_BYTES,job->sha256)){
            failure((unsigned)slot,serial,FALLBACK_STORAGE);return;
        }
    }
    if(promotion_image_canceled(serial)){failure((unsigned)slot,serial,FALLBACK_NETWORK);return;}
    strcpy(slots[slot].target,job->target);strcpy(slots[slot].hash,job->sha256);
    slots[slot].generation=job->playlist_generation;slots[slot].occupancy=job->occupancy;
    slots[slot].assignment=job->assignment;slots[slot].auth=job->auth;
    atomic_store_explicit(&slots[slot].state,READY,memory_order_release);
    atomic_store(&fallback,FALLBACK_NONE);atomic_fetch_add(&image_revision,1);
}
const lv_image_dsc_t *promotion_image_acquire(const promotion_t *job) {
    for(unsigned i=0;i<PROMOTION_SLOTS;i++) {
        unsigned state=READY;
        if(atomic_compare_exchange_strong_explicit(&slots[i].state,&state,PINNED,memory_order_acquire,memory_order_relaxed)){
            if(!strcmp(slots[i].target,job->target)&&!strcmp(slots[i].hash,job->sha256)&&
               slots[i].generation==job->playlist_generation&&slots[i].occupancy==job->occupancy&&
               slots[i].assignment==job->assignment&&slots[i].auth==job->auth){pinned=(int)i;return &slots[i].image;}
            atomic_store(&slots[i].state,READY);
        }
    }
    return NULL;
}
void promotion_image_release(void){if(pinned>=0){atomic_store(&slots[pinned].state,READY);pinned=-1;}}
unsigned promotion_image_revision(void){return atomic_load(&image_revision);}
const char *promotion_image_fallback(void) {
    static const char *reasons[]={"Photo unavailable","Loading photo...","Photo storage unavailable","Photo network unavailable","Photo integrity failed","Photo unavailable - busy","Photo unavailable"};
    return reasons[atomic_load(&fallback)];
}
