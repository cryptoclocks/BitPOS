#include "bitpos_table.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <inttypes.h>
#include "bitpos_menu_assets.generated.h"

bool table_text(cJSON *o,const char *key,char *out,size_t cap) {
    cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);
    if(!cJSON_IsString(v)||strlen(v->valuestring)>=cap)return false;
    strcpy(out,v->valuestring);return true;
}
bool table_integer(cJSON *o,const char *key,uint64_t *out) {
    cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);
    if(!cJSON_IsString(v)||!v->valuestring[0])return false;
    const char *s=v->valuestring;if(s[0]=='0'&&s[1])return false;
    uint64_t n=0;
    for(;*s;s++){if(*s<'0'||*s>'9'||n>(UINT64_MAX-(unsigned)(*s-'0'))/10)return false;n=n*10+(unsigned)(*s-'0');}
    *out=n;return true;
}
bool table_uuid(const char *s) {
    if(strlen(s)!=36)return false;
    for(unsigned i=0;i<36;i++) {
        if(i==8||i==13||i==18||i==23){if(s[i]!='-')return false;}
        else if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;
    }return true;
}
static bool uuid_field(cJSON *j,const char *key,char *out){return table_text(j,key,out,TABLE_UUID)&&table_uuid(out);}
static bool number(cJSON *j,const char *key,unsigned max,unsigned *out) {
    cJSON *v=cJSON_GetObjectItemCaseSensitive(j,key);
    if(!cJSON_IsNumber(v)||v->valuedouble<0||v->valuedouble>max||floor(v->valuedouble)!=v->valuedouble)return false;
    *out=(unsigned)v->valuedouble;return true;
}
/* Device display aliases support the baked printable ASCII and Thai range only. */
bool table_display_text(const char *s) {
    const unsigned char *p=(const unsigned char *)s;
    while(*p) {
        if(*p>=32&&*p<=126){p++;continue;}
        if(p[0]==0xe0&&p[1]&&p[2]&&(p[1]&0xc0)==0x80&&(p[2]&0xc0)==0x80) {
            unsigned cp=((p[0]&15)<<12)|((p[1]&63)<<6)|(p[2]&63);
            if(cp>=0x0e01&&cp<=0x0e5b&&!(cp>=0x0e3b&&cp<=0x0e3e)){p+=3;continue;}
        }
        return false;
    }return true;
}
bool table_money(cJSON *j,table_money_t *m,bool legacy) {
    unsigned decimals;
    if(!table_text(j,"currency",m->currency,sizeof(m->currency))||!number(j,"decimals",6,&decimals)||
       !table_integer(j,"amountMinor",&m->minor)||m->minor>999999999999999999ULL)return false;
    m->decimals=(uint8_t)decimals;
    return (!strcmp(m->currency,"USD")&&decimals==2)||(!strcmp(m->currency,"USDG")&&decimals==6)||
           (legacy&&!strcmp(m->currency,"THB")&&decimals==2);
}
void table_format_money(const table_money_t *m,char *out,size_t cap) {
    uint64_t scale=m->decimals==6?1000000:100;
    snprintf(out,cap,"%s %" PRIu64 ".%0*" PRIu64,m->currency,m->minor/scale,m->decimals,m->minor%scale);
}
bool table_items(cJSON *j,table_item_t *items,uint8_t *count) {
    if(!cJSON_IsArray(j)||cJSON_GetArraySize(j)>TABLE_LINES)return false;
    unsigned n=0;cJSON *v;
    cJSON_ArrayForEach(v,j) {
        unsigned qty;if(!uuid_field(v,"productId",items[n].product)||!number(v,"qty",100,&qty)||!qty)return false;
        for(unsigned k=0;k<n;k++)if(!strcmp(items[k].product,items[n].product))return false;
        items[n++].qty=(uint8_t)qty;
    }*count=(uint8_t)n;return true;
}
bool table_rows(cJSON *j,table_row_t *rows,unsigned *count,bool review) {
    if(!cJSON_IsArray(j)||cJSON_GetArraySize(j)>TABLE_PAGE_ROWS)return false;
    unsigned n=0;cJSON *v;
    cJSON_ArrayForEach(v,j) {
        table_row_t *r=&rows[n];memset(r,0,sizeof(*r));r->asset=-1;
        if(!uuid_field(v,"productId",r->product)||!table_text(v,"nameEn",r->name,sizeof(r->name))||
           !table_display_text(r->name)||!r->name[0]||!table_money(cJSON_GetObjectItemCaseSensitive(v,"unitPrice"),&r->unit,false))return false;
        for(unsigned i=0;i<n;i++)if(!strcmp(rows[i].product,r->product))return false;
        if(review){unsigned qty;if(!number(v,"qty",100,&qty)||!qty)return false;r->qty=(uint8_t)qty;}
        else {
            unsigned available;if(!number(v,"available",UINT32_MAX,&available))return false;r->available=available>0;
            cJSON *category=cJSON_GetObjectItemCaseSensitive(v,"category");
            if(!cJSON_IsNull(category)&&(!table_text(v,"category",r->category,sizeof(r->category))||!table_display_text(r->category)))return false;
            cJSON *asset=cJSON_GetObjectItemCaseSensitive(v,"assetId");
            if(!cJSON_IsNull(asset)){unsigned id;if(!number(v,"assetId",11,&id))return false;r->asset=(int8_t)id;}
            if(r->asset>=0){char key[96],expected[96];const char *file=bitpos_menu_assets[r->asset].file;
                snprintf(expected,sizeof(expected),"cafe.%.*s",(int)strlen(file)-7,file);
                if(!table_text(v,"catalogKey",key,sizeof(key))||strcmp(key,expected))return false;}
            table_money_t base;
            if(!table_money(cJSON_GetObjectItemCaseSensitive(v,"basePrice"),&base,false)||!r->unit.minor||
               base.minor<r->unit.minor||strcmp(base.currency,r->unit.currency)||base.decimals!=r->unit.decimals)return false;
            cJSON *promotion=cJSON_GetObjectItemCaseSensitive(v,"promotion");
            if(cJSON_IsNull(promotion)){if(base.minor!=r->unit.minor)return false;}
            else {
                cJSON *discount=cJSON_GetObjectItemCaseSensitive(promotion,"discount");char kind[16];uint64_t revision;
                if(!table_text(discount,"kind",kind,sizeof(kind))||!table_integer(promotion,"revision",&revision)||!revision)return false;
                if(!strcmp(kind,"percent")){unsigned percent;if(!number(discount,"percent",99,&percent)||!percent)return false;r->percent=(uint8_t)percent;r->discount=base.minor/100*percent+(base.minor%100)*percent/100;}
                else if(!strcmp(kind,"amount")){if(!table_integer(discount,"amountMinor",&r->discount))return false;}
                else return false;
                if(!r->discount||r->discount>=base.minor||r->unit.minor!=base.minor-r->discount)return false;
                r->promotion=true;
            }
        }n++;
    }*count=n;return true;
}
bool table_config(table_state_t *s,cJSON *j) {
    char device[TABLE_UUID],origin[192],entry[256]="";uint64_t assignment,pairing=0;
    if(!table_text(j,"paymentOrigin",origin,sizeof(origin)))return false;
    if(strcmp(origin,"http://192.168.1.34:4321")) {
        const char *host=origin+8;
        if(strncmp(origin,"https://",8)||!*host||strpbrk(host,"/?#@\\\r\n "))return false;
    }
    cJSON *entry_value=cJSON_GetObjectItemCaseSensitive(j,"tableEntryUrl");
    if(!cJSON_IsNull(entry_value)){
        if(!table_text(j,"tableEntryUrl",entry,sizeof(entry)))return false;
        size_t prefix=strlen(origin);
        if(strncmp(entry,origin,prefix)||strncmp(entry+prefix,"/table/",7))return false;
        const char *token=entry+prefix+7;
        if(strlen(token)!=43)return false;
        for(unsigned i=0;i<43;i++)if(!((token[i]>='A'&&token[i]<='Z')||(token[i]>='a'&&token[i]<='z')||(token[i]>='0'&&token[i]<='9')||token[i]=='-'||token[i]=='_'))return false;
    }
    if(!uuid_field(j,"deviceId",device)||strcmp(device,s->device)||!table_integer(j,"assignmentGeneration",&assignment)||!assignment||
       !table_text(j,"label",s->label,sizeof(s->label))||!table_display_text(s->label))return false;
    cJSON *t=cJSON_GetObjectItemCaseSensitive(j,"tableLabel");
    if(cJSON_IsNull(t))s->serving[0]=0;
    else if(!table_text(j,"tableLabel",s->serving,sizeof(s->serving))||!table_display_text(s->serving))return false;
    cJSON *p=cJSON_GetObjectItemCaseSensitive(j,"pairingGeneration");
    if(!cJSON_IsNull(p)&&!table_integer(j,"pairingGeneration",&pairing))return false;
    cJSON *ready=cJSON_GetObjectItemCaseSensitive(j,"pricingReady");if(!cJSON_IsBool(ready))return false;
    if(cJSON_IsTrue(ready)){char price[TABLE_VERSION];if(!table_text(j,"priceVersion",price,sizeof(price))||!table_version(price))return false;
        if(strcmp(price,s->price)){s->quote_ready=false;s->cart_label_count=0;s->menu[0]=0;}strcpy(s->price,price);}
    else{s->price[0]=0;strcpy(s->notice,"Pricing setup required");}
    strcpy(s->payment_origin,origin);strcpy(s->table_entry_url,entry);
    if(s->assignment&&s->assignment!=assignment)s->quote_ready=false;
    s->assignment=assignment;s->pairing=pairing;s->configured=true;return true;
}
bool table_envelope(table_state_t *s,cJSON *j,const char *device,bool *event) {
    unsigned schema;char type[32];uint64_t connection;
    if(!number(j,"schemaVersion",2,&schema)||schema!=2||!table_text(j,"type",type,sizeof(type))||!table_integer(j,"connectionGeneration",&connection)||!connection)return false;
    *event=strcmp(type,"COMMAND_RESULT")!=0;
    if(!*event)return s->configured&&connection==s->connection;
    char id[TABLE_UUID],event_id[TABLE_UUID];uint64_t seq,screen;
    if(!uuid_field(j,"deviceId",id)||!uuid_field(j,"eventId",event_id)||!table_integer(j,"deviceSeq",&seq)||!seq||!table_integer(j,"screenGeneration",&screen)||!screen)return false;
    bool config=!strcmp(type,"CONFIG");
    if(device[0]&&strcmp(device,id))return false;
    if(config) {
        if(connection<s->connection)return false;
        if(connection>s->connection){s->connection=connection;s->seq=0;s->configured=false;s->synchronized=false;s->online=false;}
        strcpy(s->device,id);
    }else if(!s->configured||connection!=s->connection)return false;
    if(seq<s->seq||screen<s->screen)return false;
    return true;
}
bool table_catalog(table_state_t *s,cJSON *j) {
    char menu[TABLE_VERSION],price[TABLE_VERSION];unsigned index,pages,count,rows;
    if(cJSON_IsNull(cJSON_GetObjectItemCaseSensitive(j,"priceVersion"))) {
        cJSON *products=cJSON_GetObjectItemCaseSensitive(j,"products");
        if(!cJSON_IsArray(products)||cJSON_GetArraySize(products))return false;
        s->price[0]=0;s->rows_count=0;s->quote_ready=false;strcpy(s->notice,"Pricing setup required");return true;
    }
    if(!table_text(j,"menuVersion",menu,sizeof(menu))||!table_text(j,"priceVersion",price,sizeof(price))||
       !number(j,"pageIndex",65535,&index)||!number(j,"pageCount",65535,&pages)||!pages||index>=pages||
       !number(j,"productCount",262140,&count)||!table_rows(cJSON_GetObjectItemCaseSensitive(j,"products"),s->rows,&rows,false))return false;
    if(!table_version(menu)||!table_version(price))return false;
    char currency[5],manifest[32];unsigned decimals;
    if(!table_text(j,"currency",currency,sizeof(currency))||!number(j,"decimals",6,&decimals)||
       !table_text(j,"assetManifestVersion",manifest,sizeof(manifest))||strcmp(manifest,"bitpos-menu-v1")||
       !table_timestamp(j,"generatedAt",&s->menu_generated_ms)||!table_timestamp(j,"validUntil",&s->menu_until_ms)||
       s->menu_until_ms<=s->menu_generated_ms||s->menu_until_ms-s->menu_generated_ms>60000)return false;
    for(unsigned i=0;i<rows;i++)if(strcmp(s->rows[i].unit.currency,currency)||s->rows[i].unit.decimals!=decimals)return false;
    cJSON *product;unsigned row_index=0;
    cJSON_ArrayForEach(product,cJSON_GetObjectItemCaseSensitive(j,"products")) {
        cJSON *promotion=cJSON_GetObjectItemCaseSensitive(product,"promotion");
        if(s->rows[row_index++].promotion){char pinned[TABLE_VERSION];int64_t expiry;
            if(!table_text(promotion,"priceVersion",pinned,sizeof(pinned))||strcmp(pinned,price)||
               !table_timestamp(promotion,"expiresAt",&expiry)||expiry<s->menu_until_ms)return false;}
    }
    if(index&&strcmp(s->menu,menu)){strcpy(s->notice,"Menu changed. Open Menu again");return false;}
    if(strcmp(price,s->price)){s->quote_ready=false;s->cart_label_count=0;}
    if(s->menu[0]&&strcmp(s->menu,menu))s->quote_ready=false;
    strcpy(s->menu,menu);strcpy(s->price,price);s->menu_page=index;s->menu_pages=pages;s->menu_count=count;s->rows_count=rows;s->category_cycle=0;return true;
}
bool table_quote(table_state_t *s,cJSON *j) {
    unsigned lines,pages;char quote[TABLE_UUID],price[TABLE_VERSION],until[32];uint64_t cart;
    table_money_t total,settlement;
    if(!uuid_field(j,"quoteId",quote)||!table_text(j,"priceVersion",price,sizeof(price))||!table_integer(j,"cartVersion",&cart)||
       !table_text(j,"validUntil",until,sizeof(until))||!number(j,"lineCount",TABLE_LINES,&lines)||!lines||
       !number(j,"pageCount",13,&pages)||pages!=(lines+3)/4||!table_money(cJSON_GetObjectItemCaseSensitive(j,"total"),&total,false)||
       !table_settlement(cJSON_GetObjectItemCaseSensitive(j,"settlement"),&settlement))return false;
    if(cart!=s->saved.cart||strcmp(price,s->price))return false;
    int64_t expiry;if(!table_timestamp(j,"validUntil",&expiry)||lines!=s->saved.count)return false;
    if((!strcmp(total.currency,"USD")&&(total.minor>99999999999999ULL||settlement.minor!=total.minor*10000))||
       (!strcmp(total.currency,"USDG")&&settlement.minor!=total.minor))return false;
    strcpy(s->quote,quote);strcpy(s->quote_price,price);strcpy(s->quote_until,until);s->quote_cart=cart;
    s->quote_until_ms=expiry;s->scroll=0;
    s->total=total;s->settlement=settlement;s->review_count=lines;s->review_pages=pages;s->loaded_pages=0;s->quote_ready=false;s->quote_loading=true;return true;
}
bool table_quote_page(table_state_t *s,cJSON *j) {
    char quote[TABLE_UUID];unsigned index,pages,lines,n;
    if(!uuid_field(j,"quoteId",quote)||strcmp(quote,s->quote)||!number(j,"pageIndex",12,&index)||index!=s->loaded_pages||
       !number(j,"pageCount",13,&pages)||pages!=s->review_pages||index>=pages||!number(j,"lineCount",TABLE_LINES,&lines)||lines!=s->review_count||index*4>=lines||
       !table_rows(cJSON_GetObjectItemCaseSensitive(j,"lines"),s->review+index*4,&n,true)||n!=(lines-index*4>4?4:lines-index*4))return false;
    cJSON *line;cJSON_ArrayForEach(line,cJSON_GetObjectItemCaseSensitive(j,"lines")) {
        char version[TABLE_VERSION];if(!table_text(line,"priceVersion",version,sizeof(version))||!table_version(version))return false;
        if(!s->quote_price[0])strcpy(s->quote_price,version);
        else if(strcmp(version,s->quote_price))return false;
    }
    for(unsigned i=index*4;i<index*4+n;i++) {
        table_row_t *r=&s->review[i];
        if(strcmp(r->unit.currency,s->total.currency)||r->unit.decimals!=s->total.decimals)return false;
        for(unsigned k=0;k<i;k++)if(!strcmp(r->product,s->review[k].product))return false;
        if(!s->order_owner){bool matched=false;for(unsigned k=0;k<s->saved.count;k++)if(!strcmp(r->product,s->saved.acknowledged[k].product)&&r->qty==s->saved.acknowledged[k].qty)matched=true;if(!matched)return false;}
    }
    s->loaded_pages++;
    if(s->loaded_pages==s->review_pages) {
        uint64_t total=0;
        for(unsigned i=0;i<lines;i++){table_row_t *r=&s->review[i];if(r->unit.minor>(UINT64_MAX-total)/r->qty)return false;total+=r->unit.minor*r->qty;}
        if(total!=s->total.minor)return false;
        s->quote_loading=false;s->quote_ready=!s->order_owner;
    }return true;
}
bool table_cart(table_state_t *s,cJSON *j) {
    table_item_t items[TABLE_LINES];uint8_t count;char session[TABLE_UUID];uint64_t cart,screen;
    if(!uuid_field(j,"sessionId",session)||!table_integer(j,"cartVersion",&cart)||!table_integer(j,"screenGeneration",&screen)||screen<s->screen||
       !table_items(cJSON_GetObjectItemCaseSensitive(j,"items"),items,&count))return false;
    /* Observing a server phone cart never grants edit/lease ownership or overwrites a pending journal. */
    s->screen=screen;s->observed_cart=true;s->cart_owner=false;s->order_owner=false;s->quote_ready=false;s->needs_resume=false;
    return true;
}
static const char *command_name(table_command_t kind) {
    static const char *names[]={"","CART_OPEN","CART_SET","CART_REVIEW","ORDER_SUBMIT","CART_RELEASE","ORDER_DISMISS","ORDER_CANCEL"};
    return names[kind];
}
size_t table_command_json(const table_state_t *s,char *out,size_t cap) {
    const table_pending_t *p=&s->saved.pending;if(p->kind<=TC_NONE||p->kind>TC_CANCEL)return 0;
    int n=snprintf(out,cap,"{\"schemaVersion\":2,\"type\":\"%s\",\"requestId\":\"%s\",\"connectionGeneration\":\"%" PRIu64 "\",",command_name(p->kind),p->request,s->connection);
    if(n<0||(size_t)n>=cap)return 0;
    size_t used=(size_t)n;
#define APPEND(...) do{n=snprintf(out+used,cap-used,__VA_ARGS__);if(n<0||(size_t)n>=cap-used)return 0;used+=(size_t)n;}while(0)
    if(p->kind==TC_DISMISS||p->kind==TC_CANCEL){APPEND("\"orderId\":\"%s\",\"orderVersion\":%lu,\"screenGeneration\":\"%" PRIu64 "\"",p->order,(unsigned long)p->order_version,p->screen);}
    else {
        APPEND("\"sessionId\":\"%s\",\"expectedScreenGeneration\":\"%" PRIu64 "\"",p->session,p->screen);
        if(p->kind==TC_OPEN){APPEND(",\"expectedAssignmentGeneration\":\"%" PRIu64 "\",\"recoverSessionId\":",p->assignment);if(p->recover[0])APPEND("\"%s\"",p->recover);else APPEND("null");}
        if(p->kind==TC_SET){APPEND(",\"expectedAssignmentGeneration\":\"%" PRIu64 "\",\"expectedCartVersion\":\"%" PRIu64 "\",\"items\":[",p->assignment,p->cart);
            for(unsigned i=0;i<s->saved.desired_count;i++){APPEND("%s{\"productId\":\"%s\",\"qty\":%u}",i?",":"",s->saved.desired[i].product,s->saved.desired[i].qty);}APPEND("]");}
        if(p->kind==TC_REVIEW||p->kind==TC_SUBMIT||p->kind==TC_RELEASE)APPEND(",\"cartVersion\":\"%" PRIu64 "\"",p->cart);
        if(p->kind==TC_REVIEW)APPEND(",\"expectedPriceVersion\":\"%s\"",p->price);
        if(p->kind==TC_SUBMIT)APPEND(",\"quoteId\":\"%s\",\"priceVersion\":\"%s\",\"idempotencyKey\":\"%s\"",p->quote,p->price,p->key);
    }
    APPEND("}");
#undef APPEND
    return used<=TABLE_SEND_MAX?used:0;
}
/* Wire-independent fixed journal: no pointers, padding, URLs or credential material. */
static uint32_t crc(const uint8_t *data,size_t n){uint32_t c=~0u;for(size_t i=0;i<n;i++){c^=(i>=12&&i<16)?0:data[i];for(unsigned k=0;k<8;k++)c=(c>>1)^(0xedb88320u&-(c&1));}return ~c;}
static void put64(uint8_t *p,uint64_t n){for(unsigned i=0;i<8;i++)p[i]=(uint8_t)(n>>(i*8));}
static uint64_t get64(const uint8_t *p){uint64_t n=0;for(unsigned i=0;i<8;i++)n|=(uint64_t)p[i]<<(i*8);return n;}
static unsigned hex(char c){return c<='9'?(unsigned)(c-'0'):(unsigned)(c-'a'+10);}
static void pack_uuid(const char *s,uint8_t *out){unsigned k=0;memset(out,0,16);if(!s[0])return;for(unsigned i=0;i<36;){if(s[i]=='-'){i++;continue;}out[k++]=(uint8_t)((hex(s[i])<<4)|hex(s[i+1]));i+=2;}}
static void unpack_uuid(const uint8_t *in,char *s){static const char h[]="0123456789abcdef";bool any=false;for(unsigned i=0;i<16;i++)any|=in[i]!=0;if(!any){s[0]=0;return;}unsigned k=0;for(unsigned i=0;i<36;i++){if(i==8||i==13||i==18||i==23)s[i]='-';else {s[i]=h[(k&1)?in[k/2]&15:in[k/2]>>4];k++;}}s[36]=0;}
size_t table_journal_encode(const table_durable_t *s,uint64_t seq,uint8_t *out,size_t cap) {
    const size_t length=16+16*8+65*2+8*6+4+3+17*(s->count+s->desired_count);
    if(s->count>50||s->desired_count>50||cap<length)return 0;
    memset(out,0,length);memcpy(out,"BPT2",4);put64(out+4,seq);size_t at=16;
#define UUID(v) do{pack_uuid(v,out+at);at+=16;}while(0)
#define U64(v) do{put64(out+at,v);at+=8;}while(0)
    UUID(s->session);UUID(s->locked_order);UUID(s->pending.request);UUID(s->pending.session);UUID(s->pending.quote);UUID(s->pending.key);UUID(s->pending.order);
    UUID(s->pending.recover);
    memcpy(out+at,s->price,65);at+=65;memcpy(out+at,s->pending.price,65);at+=65;
    U64(s->cart);U64(s->screen);U64(s->assignment);U64(s->pending.screen);U64(s->pending.assignment);U64(s->pending.cart);
    uint32_t v=s->pending.order_version;for(unsigned i=0;i<4;i++)out[at++]=(uint8_t)(v>>(8*i));
    out[at++]=(uint8_t)s->pending.kind|(s->paused_desired?128:0);out[at++]=s->count;out[at++]=s->desired_count;
    for(unsigned which=0;which<2;which++){const table_item_t *items=which?s->desired:s->acknowledged;unsigned n=which?s->desired_count:s->count;for(unsigned i=0;i<n;i++){UUID(items[i].product);out[at++]=items[i].qty;}}
#undef UUID
#undef U64
    uint32_t c=crc(out,length);for(unsigned i=0;i<4;i++)out[12+i]=(uint8_t)(c>>(i*8));return length;
}
bool table_journal_decode(const uint8_t *in,size_t n,table_durable_t *s,uint64_t *seq) {
    const size_t base=16+16*8+65*2+8*6+4+3;
    if(n<base||n>4096||memcmp(in,"BPT2",4))return false;
    uint32_t expected=0;for(unsigned i=0;i<4;i++)expected|=(uint32_t)in[12+i]<<(i*8);if(crc(in,n)!=expected)return false;
    memset(s,0,sizeof(*s));*seq=get64(in+4);size_t at=16;
#define UUID(v) do{unpack_uuid(in+at,v);at+=16;}while(0)
#define U64(v) do{v=get64(in+at);at+=8;}while(0)
    UUID(s->session);UUID(s->locked_order);UUID(s->pending.request);UUID(s->pending.session);UUID(s->pending.quote);UUID(s->pending.key);UUID(s->pending.order);
    UUID(s->pending.recover);
    memcpy(s->price,in+at,65);at+=65;memcpy(s->pending.price,in+at,65);at+=65;if(!memchr(s->price,0,65)||!memchr(s->pending.price,0,65))return false;
    U64(s->cart);U64(s->screen);U64(s->assignment);U64(s->pending.screen);U64(s->pending.assignment);U64(s->pending.cart);
    for(unsigned i=0;i<4;i++)s->pending.order_version|=(uint32_t)in[at++]<<(i*8);
    uint8_t kind=in[at++];s->paused_desired=(kind&128)!=0;s->pending.kind=(table_command_t)(kind&127);s->count=in[at++];s->desired_count=in[at++];
    if(s->pending.kind>TC_CANCEL||s->count>50||s->desired_count>50||n!=base+17*(s->count+s->desired_count))return false;
    for(unsigned which=0;which<2;which++){table_item_t *items=which?s->desired:s->acknowledged;unsigned count=which?s->desired_count:s->count;for(unsigned i=0;i<count;i++){UUID(items[i].product);items[i].qty=in[at++];if(!items[i].qty||items[i].qty>100||!table_uuid(items[i].product))return false;for(unsigned k=0;k<i;k++)if(!strcmp(items[k].product,items[i].product))return false;}}
#undef UUID
#undef U64
    return !s->pending.kind||table_uuid(s->pending.request);
}

bool table_timestamp(cJSON *o,const char *key,int64_t *out) {
    char s[25];if(!table_text(o,key,s,sizeof(s))||strlen(s)!=24)return false;
    for(unsigned i=0;i<24;i++){
        char separator=i==4||i==7?'-':i==10?'T':i==13||i==16?':':i==19?'.':i==23?'Z':0;
        if(separator?s[i]!=separator:s[i]<'0'||s[i]>'9')return false;
    }
    int y,mo,d,h,mi,se,ms;
    if(sscanf(s,"%4d-%2d-%2dT%2d:%2d:%2d.%3dZ",&y,&mo,&d,&h,&mi,&se,&ms)!=7||y<2024||y>2099||mo<1||mo>12||h>23||mi>59||se>59)return false;
    static const unsigned days[]={31,28,31,30,31,30,31,31,30,31,30,31};
    if(d<1||d>(int)(days[mo-1]+(mo==2&&y%4==0)))return false;
    int64_t n=0;for(int year=1970;year<y;year++)n+=365+(year%4==0&&(year%100!=0||year%400==0));
    for(int month=1;month<mo;month++)n+=days[month-1]+(month==2&&y%4==0);
    *out=(((n+d-1)*24+h)*60+mi)*60000+(int64_t)se*1000+ms;return true;
}
bool table_settlement(cJSON *j,table_money_t *out) {
    char network[32],mint[48],program[48],genesis[48];cJSON *test=cJSON_GetObjectItemCaseSensitive(j,"testToken");
    return table_money(j,out,false)&&!strcmp(out->currency,"USDG")&&cJSON_IsTrue(test)&&
        table_text(j,"network",network,sizeof(network))&&!strcmp(network,"solana:devnet")&&
        table_text(j,"mint",mint,sizeof(mint))&&!strcmp(mint,"4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7")&&
        table_text(j,"tokenProgram",program,sizeof(program))&&!strcmp(program,"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")&&
        table_text(j,"genesisHash",genesis,sizeof(genesis))&&!strcmp(genesis,"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
}

int table_fragment(table_fragment_t *s,char buffer[8192],uint8_t opcode,bool fin,int frame_length,int offset,const char *data,int length) {
    if(opcode>=8)return 0;
    if((opcode!=0&&opcode!=1)||frame_length<0||offset<0||length<0||offset>frame_length||
       length>frame_length-offset||(!data&&length))goto bad;
    if(!offset) {
        if(opcode==1){if(s->active)goto bad;memset(s,0,sizeof(*s));s->active=true;}
        else if(!s->active||s->offset!=s->frame_length)goto bad;
        if(++s->frames>32||s->used+(unsigned)frame_length>8191)goto bad;
        s->offset=0;s->frame_length=(unsigned)frame_length;s->frame_fin=fin;s->opcode=opcode;
    }else if(!s->active||s->frame_length!=(unsigned)frame_length||s->frame_fin!=fin||s->opcode!=opcode)goto bad;
    if(s->offset!=(unsigned)offset||++s->chunks>128||s->used+(unsigned)length>8191)goto bad;
    if(length){if(memchr(data,0,(size_t)length))goto bad;memcpy(buffer+s->used,data,(size_t)length);}
    s->used+=(unsigned)length;s->offset+=(unsigned)length;
    if(s->offset==s->frame_length&&fin){buffer[s->used]=0;s->active=false;return s->used?1:-1;}
    return 0;
bad:
    memset(s,0,sizeof(*s));return -1;
}
bool table_json_bounded(const char *data,size_t length) {
    if(!length||length>8191||memchr(data,0,length))return false;
    unsigned depth=0;bool string=false,escaped=false;
    for(size_t i=0;i<length;i++){char c=data[i];
        if(string){if(escaped)escaped=false;else if(c=='\\')escaped=true;else if(c=='\"')string=false;continue;}
        if(c=='\"')string=true;
        else if(c=='{'||c=='['){if(++depth>16)return false;}
        else if(c=='}'||c==']'){if(!depth)return false;depth--;}
    }return !depth&&!string;
}

bool table_version(const char *s) {
    if(!*s||strlen(s)>64)return false;
    for(;*s;s++)if(!((*s>='a'&&*s<='z')||(*s>='A'&&*s<='Z')||(*s>='0'&&*s<='9')||*s=='-'||*s=='_'||*s=='.'))return false;
    return true;
}
