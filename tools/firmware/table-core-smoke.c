/* Actual firmware core; all data below are explicit host fixtures, not configuration. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "bitpos_table.h"
static const char *session="10000000-0000-4000-8000-000000000001";
static const char *quote="20000000-0000-4000-8000-000000000001";
static void id(char out[37],unsigned n){snprintf(out,37,"30000000-0000-4000-8000-%012u",n);}
static cJSON *money(const char *currency,unsigned decimals,unsigned long long amount){cJSON *j=cJSON_CreateObject();char s[32];snprintf(s,sizeof(s),"%llu",amount);cJSON_AddStringToObject(j,"currency",currency);cJSON_AddNumberToObject(j,"decimals",decimals);cJSON_AddStringToObject(j,"amountMinor",s);return j;}
static cJSON *settlement(unsigned long long amount){cJSON *j=money("USDG",6,amount);cJSON_AddBoolToObject(j,"testToken",true);cJSON_AddStringToObject(j,"network","solana:devnet");cJSON_AddStringToObject(j,"mint","4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7");cJSON_AddStringToObject(j,"tokenProgram","TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");cJSON_AddStringToObject(j,"genesisHash","EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");return j;}
static cJSON *items(unsigned count,unsigned quantity){cJSON *array=cJSON_CreateArray();for(unsigned i=0;i<count;i++){cJSON *j=cJSON_CreateObject();char product[37];id(product,i+1);cJSON_AddStringToObject(j,"productId",product);cJSON_AddNumberToObject(j,"qty",quantity);cJSON_AddItemToArray(array,j);}return array;}
static cJSON *line(unsigned i){cJSON *j=cJSON_CreateObject();char product[37];id(product,i+1);cJSON_AddStringToObject(j,"productId",product);cJSON_AddStringToObject(j,"nameEn","Host fixture coffee");cJSON_AddStringToObject(j,"name","Host fixture coffee");cJSON_AddStringToObject(j,"priceVersion","fixture-price");cJSON_AddNumberToObject(j,"qty",1);cJSON_AddItemToObject(j,"unitPrice",money("USD",2,270));cJSON_AddItemToObject(j,"basePrice",money("USD",2,270));cJSON_AddNullToObject(j,"promotion");return j;}
static cJSON *page(unsigned index,unsigned count){cJSON *j=cJSON_CreateObject();cJSON_AddStringToObject(j,"quoteId",quote);cJSON_AddNumberToObject(j,"pageIndex",index);cJSON_AddNumberToObject(j,"lineCount",count);cJSON_AddNumberToObject(j,"pageCount",(count+3)/4);cJSON *rows=cJSON_AddArrayToObject(j,"lines");for(unsigned i=index*4;i<count&&i<index*4+4;i++)cJSON_AddItemToArray(rows,line(i));return j;}
static cJSON *quote_header(unsigned count){cJSON *j=cJSON_CreateObject();cJSON_AddStringToObject(j,"quoteId",quote);cJSON_AddStringToObject(j,"priceVersion","fixture-price");cJSON_AddStringToObject(j,"cartVersion","1");cJSON_AddStringToObject(j,"validUntil","2026-10-08T00:01:00.000Z");cJSON_AddNumberToObject(j,"lineCount",count);cJSON_AddNumberToObject(j,"pageCount",(count+3)/4);cJSON_AddItemToObject(j,"total",money("USD",2,270*count));cJSON_AddItemToObject(j,"settlement",settlement(2700000ULL*count));return j;}
int main(void){
 table_state_t s={0};table_money_t m;uint64_t n;uint8_t count;
 cJSON *j=money("USD",2,270);assert(table_money(j,&m,false));char formatted[64];table_format_money(&m,formatted,sizeof(formatted));assert(!strcmp(formatted,"USD 2.70"));cJSON_ReplaceItemInObjectCaseSensitive(j,"amountMinor",cJSON_CreateString("02"));assert(!table_money(j,&m,false));cJSON_Delete(j);
 j=money("THB",2,9500);assert(!table_money(j,&m,false)&&table_money(j,&m,true));cJSON_Delete(j);
 j=settlement(2700000);assert(table_settlement(j,&m));cJSON_ReplaceItemInObjectCaseSensitive(j,"network",cJSON_CreateString("solana:mainnet"));assert(!table_settlement(j,&m));cJSON_Delete(j);puts("integer_USD2_USDG6_legacy_only_and_devnet_pin");
 table_state_t trusted={0};strcpy(trusted.device,session);
 j=cJSON_Parse("{\"deviceId\":\"10000000-0000-4000-8000-000000000001\",\"assignmentGeneration\":\"1\",\"label\":\"Explicit host fixture\",\"tableLabel\":null,\"pairingGeneration\":null,\"pricingReady\":true,\"priceVersion\":\"fixture-price\",\"paymentOrigin\":\"http://192.168.1.34:4321\"}");
 cJSON_AddNullToObject(j,"tableEntryUrl");
 assert(table_config(&trusted,j)&&!strcmp(trusted.payment_origin,"http://192.168.1.34:4321"));
 const char *bad_origins[]={"http://127.0.0.1:4321","http://192.168.1.34:3001","http://192.168.1.35:4321","https://example.invalid/pay/x","https://example.invalid?x=1","https://user@example.invalid"};
 for(unsigned i=0;i<sizeof(bad_origins)/sizeof(bad_origins[0]);i++){cJSON_ReplaceItemInObjectCaseSensitive(j,"paymentOrigin",cJSON_CreateString(bad_origins[i]));assert(!table_config(&trusted,j));}
 cJSON_ReplaceItemInObjectCaseSensitive(j,"paymentOrigin",cJSON_CreateString("https://example.invalid"));assert(table_config(&trusted,j));cJSON_Delete(j);
 j=cJSON_Parse("{\"deviceId\":\"10000000-0000-4000-8000-000000000001\",\"assignmentGeneration\":\"2\",\"label\":\"Table QR host fixture\",\"tableLabel\":\"Table 4\",\"pairingGeneration\":null,\"pricingReady\":true,\"priceVersion\":\"fixture-price\",\"paymentOrigin\":\"http://192.168.1.34:4321\",\"tableEntryUrl\":\"http://192.168.1.34:4321/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}");
 assert(table_config(&trusted,j)&&trusted.table_entry_url[0]&&trusted.assignment==2);
 cJSON_ReplaceItemInObjectCaseSensitive(j,"tableEntryUrl",cJSON_CreateString("http://evil.invalid/table/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));assert(!table_config(&trusted,j));
 cJSON_ReplaceItemInObjectCaseSensitive(j,"tableEntryUrl",cJSON_CreateString("http://192.168.1.34:4321/pay/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));assert(!table_config(&trusted,j));
 cJSON_ReplaceItemInObjectCaseSensitive(j,"tableEntryUrl",cJSON_CreateNull());assert(table_config(&trusted,j)&&!trusted.table_entry_url[0]);cJSON_Delete(j);
 puts("exact_reachable_demo_web_origin_and_https_only_no_loopback_api_port_or_executable_path");
 j=cJSON_Parse("{\"generation\":\"4294967297\"}");assert(table_integer(j,"generation",&n)&&n==4294967297ULL);cJSON_ReplaceItemInObjectCaseSensitive(j,"generation",cJSON_CreateString("18446744073709551616"));assert(!table_integer(j,"generation",&n));cJSON_Delete(j);
 j=items(50,100);assert(table_items(j,s.saved.acknowledged,&count)&&count==50);cJSON_Delete(j);j=items(51,1);assert(!table_items(j,s.saved.acknowledged,&count));cJSON_Delete(j);j=items(1,101);assert(!table_items(j,s.saved.acknowledged,&count));cJSON_Delete(j);j=items(2,1);cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(j,1),"productId",cJSON_CreateString(cJSON_GetObjectItem(cJSON_GetArrayItem(j,0),"productId")->valuestring));assert(!table_items(j,s.saved.acknowledged,&count));cJSON_Delete(j);puts("all50_quantity100_duplicates51_101_refused");
 s.saved.count=s.saved.desired_count=50;for(unsigned i=0;i<50;i++){id(s.saved.acknowledged[i].product,i+1);s.saved.acknowledged[i].qty=1;s.saved.desired[i]=s.saved.acknowledged[i];s.saved.desired[i].qty=100;}
 strcpy(s.saved.session,session);s.saved.cart=1;s.connection=9;s.saved.pending.kind=TC_SET;strcpy(s.saved.pending.request,quote);strcpy(s.saved.pending.session,session);s.saved.pending.cart=1;s.saved.pending.screen=2;s.saved.pending.assignment=3;
 char sent[4096],retry[4096];size_t sent_length=table_command_json(&s,sent,sizeof(sent));assert(sent_length&&sent_length<sizeof(sent));s.connection=10;assert(table_command_json(&s,retry,sizeof(retry)));
 cJSON *a=cJSON_Parse(sent),*b=cJSON_Parse(retry);assert(cJSON_GetArraySize(cJSON_GetObjectItem(a,"items"))==50);
 cJSON_DeleteItemFromObjectCaseSensitive(a,"connectionGeneration");cJSON_DeleteItemFromObjectCaseSensitive(b,"connectionGeneration");assert(cJSON_Compare(a,b,true));cJSON_Delete(a);cJSON_Delete(b);
 s.saved.paused_desired=true;
 uint8_t record[4096];table_durable_t restored;uint64_t sequence;size_t bytes=table_journal_encode(&s.saved,73,record,sizeof(record));
 assert(bytes&&bytes<=2029&&table_journal_decode(record,bytes,&restored,&sequence)&&sequence==73);
 assert(restored.count==50&&restored.desired_count==50&&restored.desired[49].qty==100&&restored.paused_desired&&!strcmp(restored.pending.request,s.saved.pending.request));
 record[4]^=1;assert(!table_journal_decode(record,bytes,&restored,&sequence));record[4]^=1;record[bytes-1]^=1;
 assert(!table_journal_decode(record,bytes,&restored,&sequence));assert(!table_journal_decode(record,bytes-1,&restored,&sequence));
 puts("journal_absolute50_paused_desired_pending_before_send_crc_header_and_torn_record");
 s.saved.pending.kind=TC_SUBMIT;strcpy(s.saved.pending.key,quote);strcpy(s.saved.pending.quote,quote);strcpy(s.saved.pending.price,"fixture-price");assert(table_command_json(&s,sent,sizeof(sent)));assert(table_command_json(&s,retry,sizeof(retry))&&!strcmp(sent,retry));
 s.saved.pending.kind=TC_OPEN;strcpy(s.saved.pending.recover,session);s.needs_resume=true;assert(table_command_json(&s,sent,sizeof(sent)));s.needs_resume=false;strcpy(s.saved.session,quote);assert(table_command_json(&s,retry,sizeof(retry))&&!strcmp(sent,retry));puts("timeout_keeps_submit_key_and_exact_recover_semantics");
 table_fragment_t f={0};char buffer[8192];assert(table_fragment(&f,buffer,1,false,4,0,"{\"x\"",2)==0);assert(table_fragment(&f,buffer,1,false,4,2,"x\"",2)==0);assert(table_fragment(&f,buffer,9,true,1,0,"p",1)==0);assert(table_fragment(&f,buffer,0,true,3,0,":1}",3)==1&&!strcmp(buffer,"{\"x\":1}"));
 char payload[8192];memset(payload,'x',sizeof(payload));memset(&f,0,sizeof(f));assert(table_fragment(&f,buffer,1,true,8191,0,payload,8191)==1);
 memset(&f,0,sizeof(f));assert(table_fragment(&f,buffer,1,true,8192,0,payload,0)==-1);assert(table_fragment(&f,buffer,2,true,1,0,"x",1)==-1);
 assert(table_fragment(&f,buffer,1,true,4,0,"{}",2)==0);assert(table_fragment(&f,buffer,1,true,4,3,"}",1)==-1);
 const char *deep="[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]";
 assert(table_json_bounded("{\"x\":[{}]}",strlen("{\"x\":[{}]}")));assert(!table_json_bounded(deep,strlen(deep)));
 puts("SDK_chunks_RFC_fragments_controls_8191_overflow_gaps_binary_depth_resync");
 memset(&s,0,sizeof(s));strcpy(s.price,"fixture-price");strcpy(s.saved.session,session);s.saved.cart=1;s.saved.count=50;for(unsigned i=0;i<50;i++){id(s.saved.acknowledged[i].product,i+1);s.saved.acknowledged[i].qty=1;}
 j=quote_header(50);assert(table_quote(&s,j));cJSON_Delete(j);for(unsigned i=0;i<13;i++){j=page(i,50);assert(table_quote_page(&s,j));cJSON_Delete(j);assert(s.quote_ready==(i==12));}assert(s.review[49].qty==1&&s.total.minor==13500);puts("all50_canonical_review_full13_pages_before_confirm");
 j=quote_header(50);assert(table_quote(&s,j));cJSON_Delete(j);j=page(0,50);cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(cJSON_GetObjectItem(j,"lines"),0),"priceVersion",cJSON_CreateString("other-price"));assert(!table_quote_page(&s,j)&&!s.quote_ready);cJSON_Delete(j);
 j=quote_header(50);assert(table_quote(&s,j));cJSON_Delete(j);s.total.minor++;for(unsigned i=0;i<13;i++){j=page(i,50);bool accepted=table_quote_page(&s,j);cJSON_Delete(j);assert(accepted==(i<12));}assert(!s.quote_ready);puts("mixed_quote_versions_or_wrong_total_never_enable_confirm");
 memset(&s,0,sizeof(s));strcpy(s.device,session);j=cJSON_Parse("{\"schemaVersion\":2,\"type\":\"CONFIG\",\"deviceId\":\"10000000-0000-4000-8000-000000000001\",\"eventId\":\"20000000-0000-4000-8000-000000000001\",\"deviceSeq\":\"1\",\"connectionGeneration\":\"4294967297\",\"screenGeneration\":\"2\"}");bool event;assert(table_envelope(&s,j,s.device,&event)&&event&&s.connection==4294967297ULL);s.configured=true;s.screen=2;s.seq=1;cJSON_ReplaceItemInObjectCaseSensitive(j,"type",cJSON_CreateString("ORDER"));assert(table_envelope(&s,j,s.device,&event));cJSON_ReplaceItemInObjectCaseSensitive(j,"screenGeneration",cJSON_CreateString("1"));assert(!table_envelope(&s,j,s.device,&event));cJSON_ReplaceItemInObjectCaseSensitive(j,"screenGeneration",cJSON_CreateString("2"));cJSON_ReplaceItemInObjectCaseSensitive(j,"deviceId",cJSON_CreateString(quote));assert(!table_envelope(&s,j,s.device,&event));cJSON_Delete(j);puts("authenticated_identity_connection_screen_and_deviceSeq_fences");
 assert(sizeof(table_state_t)+4096<=32768);printf("fixed_state_bytes=%zu journal_max_fixture_bytes=%zu\n",sizeof(table_state_t)+4096,bytes);return 0;
}
