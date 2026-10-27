/* Derive every case from an actual server CATALOG_PAGE, not a handwritten wire fixture. */
static void transport_catalog_guards(cJSON *catalog) {
    assert(cJSON_IsObject(catalog));table_state_t original=table;
    uint64_t financial=transport_financial_digest();unsigned writes=host_writes,cases=0;
    const char *keys[]={"sessionId","targetId","campaignId","campaignVersion","expiresAt","discountPercent"};
    for(unsigned i=0;i<6;i++) {
        table=original;cJSON *copy=cJSON_Duplicate(catalog,true),*row=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0),*scoped=cJSON_GetObjectItem(row,"scopedPromotion");assert(scoped);
        cJSON_ReplaceItemInObject(scoped,keys[i],i==3||i==5?cJSON_CreateNumber(0):cJSON_CreateString(i==4?"2020-01-01T00:00:00.000Z":fixture_order));
        assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    }
    for(unsigned i=0;i<6;i++){
        table=original;cJSON *copy=cJSON_Duplicate(catalog,true),*scoped=cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0),"scopedPromotion");
        cJSON_DeleteItemFromObject(scoped,keys[i]);assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    }
    for(unsigned i=0;i<5;i++) {
        table=original;cJSON *copy=cJSON_Duplicate(catalog,true),*row=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0);
        if(i==0)table.auth=0;
        if(i==1)table.observed_cart=false;
        if(i==2)table.catalog_lease_ms=0;
        if(i==3)cJSON_ReplaceItemInObject(cJSON_GetObjectItem(row,"unitPrice"),"amountMinor",cJSON_CreateString("229"));
        if(i==4)cJSON_ReplaceItemInObject(row,"promotion",cJSON_CreateObject());
        assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    }
    table=original;cJSON *copy=cJSON_Duplicate(catalog,true),*products=cJSON_GetObjectItem(copy,"products"),*second=cJSON_Duplicate(cJSON_GetArrayItem(products,0),true);
    cJSON_ReplaceItemInObject(second,"productId",cJSON_CreateString(fixture_order));cJSON_AddItemToArray(products,second);
    assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    table=original;copy=cJSON_Duplicate(catalog,true);cJSON_ReplaceItemInObject(copy,"priceVersion",cJSON_CreateString("wrong-price"));
    assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    table=original;copy=cJSON_Duplicate(catalog,true);time_t past=time(NULL)-10;struct tm utc;char stamp[32];gmtime_r(&past,&utc);strftime(stamp,sizeof(stamp),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_ReplaceItemInObject(copy,"generatedAt",cJSON_CreateString(stamp));
    past=time(NULL)-1;gmtime_r(&past,&utc);strftime(stamp,sizeof(stamp),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_ReplaceItemInObject(copy,"validUntil",cJSON_CreateString(stamp));
    assert(!apply_catalog(copy));cJSON_Delete(copy);cases++;
    table=original;atomic_store(&clock_synced,false);assert(!apply_catalog(catalog));atomic_store(&clock_synced,true);cases++;
    table=original;copy=cJSON_Duplicate(catalog,true);cJSON *row=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0);
    cJSON_DeleteItemFromObject(row,"scopedPromotion");assert(!table_catalog(&table,copy));cases++;
    cJSON_ReplaceItemInObject(row,"unitPrice",cJSON_Duplicate(cJSON_GetObjectItem(row,"basePrice"),true));
    table=original;assert(table_catalog(&table,copy)&&!table.rows[0].promotion&&!table.rows[0].scoped_promotion);cases++;
    cJSON *offer=cJSON_CreateObject(),*discount=cJSON_AddObjectToObject(offer,"discount");cJSON_AddStringToObject(offer,"revision","1");cJSON_AddStringToObject(offer,"priceVersion",original.price);
    char expiry[32];assert(table_text(cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(catalog,"products"),0),"scopedPromotion"),"expiresAt",expiry,sizeof(expiry)));cJSON_AddStringToObject(offer,"expiresAt",expiry);
    cJSON_AddStringToObject(discount,"kind","percent");cJSON_AddNumberToObject(discount,"percent",15);cJSON_ReplaceItemInObject(row,"promotion",offer);
    cJSON_ReplaceItemInObject(cJSON_GetObjectItem(row,"unitPrice"),"amountMinor",cJSON_CreateString("230"));
    table=original;assert(table_catalog(&table,copy)&&table.rows[0].promotion&&!table.rows[0].scoped_promotion);cases++;
    cJSON_ReplaceItemInObject(offer,"priceVersion",cJSON_CreateString("wrong-price"));table=original;assert(!table_catalog(&table,copy));cases++;
    cJSON_ReplaceItemInObject(offer,"priceVersion",cJSON_CreateString(original.price));cJSON_ReplaceItemInObject(offer,"expiresAt",cJSON_CreateString("2020-01-01T00:00:00.000Z"));table=original;assert(!table_catalog(&table,copy));cases++;
    cJSON_ReplaceItemInObject(offer,"expiresAt",cJSON_CreateString(expiry));cJSON_ReplaceItemInObject(discount,"kind",cJSON_CreateString("amount"));cJSON_DeleteItemFromObject(discount,"percent");cJSON_AddStringToObject(discount,"amountMinor","40");
    table=original;assert(table_catalog(&table,copy)&&table.rows[0].promotion&&table.rows[0].discount==40);cases++;
    cJSON_Delete(copy);table=original;
    assert(financial==transport_financial_digest()&&writes==host_writes);
    fprintf(stderr,"{\"origin\":\"production_scoped_catalog_guards\",\"cases\":%u,\"financial_journal_unchanged\":true,\"physical_proof\":false}\n",cases);
}
