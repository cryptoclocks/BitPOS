/* Mutate a real authenticated playlist, never replace the production parser. */
static void transport_promotion_currency_guards(cJSON *payload) {
    assert(cJSON_IsObject(payload));
    uint64_t financial=transport_financial_digest();unsigned writes=host_writes,cases=0;
    promotion_playlist_t parsed;
    const char *currencies[]={"USD","USDG","USDC","USDT"};
    const char *formatted[]={"USD 2.30","USDG 2.295000","USDC 2.295000","USDT test 2.295000"};
    for(unsigned i=0;i<4;i++) {
        cJSON *copy=cJSON_Duplicate(payload,true),*item=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"items"),0);assert(item);
        cJSON *unit=cJSON_GetObjectItem(item,"unitPrice"),*base=cJSON_GetObjectItem(item,"basePrice");
        cJSON_ReplaceItemInObject(unit,"currency",cJSON_CreateString(currencies[i]));
        cJSON_ReplaceItemInObject(base,"currency",cJSON_CreateString(currencies[i]));
        cJSON_ReplaceItemInObject(unit,"decimals",cJSON_CreateNumber(i?6:2));
        cJSON_ReplaceItemInObject(base,"decimals",cJSON_CreateNumber(i?6:2));
        cJSON_ReplaceItemInObject(base,"amountMinor",cJSON_CreateString(i?"2700000":"270"));
        cJSON_ReplaceItemInObject(unit,"amountMinor",cJSON_CreateString(i?"2295000":"230"));
        cJSON_ReplaceItemInObject(item,"discountPercent",cJSON_CreateNumber(15));
        assert(promotion_playlist_parse(&table,copy,table.screen,&parsed));
        assert(parsed.count==1&&!strcmp(parsed.items[0].unit.currency,currencies[i])&&parsed.items[0].unit.decimals==(i?6:2));
        char price[64];table_format_money(&parsed.items[0].unit,price,sizeof(price));assert(!strcmp(price,formatted[i]));
        cJSON_Delete(copy);cases++;
    }
    for(unsigned i=0;i<10;i++) {
        cJSON *copy=cJSON_Duplicate(payload,true),*item=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"items"),0);assert(item);
        cJSON *unit=cJSON_GetObjectItem(item,"unitPrice"),*base=cJSON_GetObjectItem(item,"basePrice");
        /* Both money objects remain valid in case 0: equality is a separate invariant. */
        if(i==0){cJSON_ReplaceItemInObject(base,"currency",cJSON_CreateString("USD"));cJSON_ReplaceItemInObject(base,"decimals",cJSON_CreateNumber(2));}
        if(i==1)cJSON_ReplaceItemInObject(base,"currency",cJSON_CreateString("USDC"));
        if(i==2)cJSON_ReplaceItemInObject(base,"decimals",cJSON_CreateNumber(2));
        if(i==3)cJSON_ReplaceItemInObject(unit,"decimals",cJSON_CreateNumber(2));
        if(i==4)cJSON_ReplaceItemInObject(unit,"amountMinor",cJSON_CreateString("2294999"));
        if(i==5)cJSON_ReplaceItemInObject(unit,"amountMinor",cJSON_CreateString("0"));
        if(i==6)cJSON_ReplaceItemInObject(unit,"amountMinor",cJSON_CreateString("2700000"));
        if(i==7)cJSON_ReplaceItemInObject(unit,"amountMinor",cJSON_CreateString("2700001"));
        if(i==8){cJSON_ReplaceItemInObject(unit,"currency",cJSON_CreateString("THB"));cJSON_ReplaceItemInObject(base,"currency",cJSON_CreateString("THB"));cJSON_ReplaceItemInObject(unit,"decimals",cJSON_CreateNumber(2));cJSON_ReplaceItemInObject(base,"decimals",cJSON_CreateNumber(2));}
        if(i==9)cJSON_ReplaceItemInObject(base,"amountMinor",cJSON_CreateString("9999999999999999999"));
        assert(!promotion_playlist_parse(&table,copy,table.screen,&parsed));cJSON_Delete(copy);cases++;
    }
    for(unsigned i=0;i<4;i++) {
        cJSON *copy=cJSON_Duplicate(payload,true),*item=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"items"),0);
        cJSON_AddBoolToObject(item,"bundle",true);
        cJSON_AddStringToObject(item,"discountLabel","15% OFF");
        cJSON_ReplaceItemInObject(item,"discountPercent",cJSON_CreateNumber(1));
        if(i==1)cJSON_DeleteItemFromObject(item,"discountLabel");
        if(i==2)cJSON_ReplaceItemInObject(item,"bundle",cJSON_CreateString("true"));
        if(i==3)cJSON_ReplaceItemInObject(cJSON_GetObjectItem(item,"unitPrice"),"amountMinor",cJSON_CreateString("0"));
        assert(promotion_playlist_parse(&table,copy,table.screen,&parsed)==(i==0));
        if(i==0)assert(parsed.items[0].bundle&&!strcmp(parsed.items[0].discount_label,"15% OFF"));
        cJSON_Delete(copy);cases++;
    }
    assert(financial==transport_financial_digest()&&writes==host_writes);
    fprintf(stderr,"{\"origin\":\"production_promotion_currency_guards\",\"cases\":%u,\"financial_journal_unchanged\":true,\"physical_proof\":false}\n",cases);
}
