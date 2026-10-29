/* Mutate an actual published daily CATALOG_PAGE; run the production boundary. */
static void transport_daily_catalog_guards(cJSON *catalog) {
    assert(cJSON_IsObject(catalog));table_state_t original=table;
    uint64_t financial=transport_financial_digest();unsigned writes=host_writes,cases=0;
    const char *keys[]={"campaignId","campaignVersion","discountPercent","startsAt","expiresAt"};
    for(unsigned i=0;i<5;i++) {
        table=original;cJSON *copy=cJSON_Duplicate(catalog,true);
        cJSON *daily=cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0),"dailyPromotion");assert(daily);
        cJSON_DeleteItemFromObject(daily,keys[i]);assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    }
    for(unsigned i=0;i<12;i++) {
        table=original;cJSON *copy=cJSON_Duplicate(catalog,true),*row=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0);
        cJSON *daily=cJSON_GetObjectItem(row,"dailyPromotion"),*unit=cJSON_GetObjectItem(row,"unitPrice"),*base=cJSON_GetObjectItem(row,"basePrice");
        if(i==0)cJSON_ReplaceItemInObject(daily,"campaignId",cJSON_CreateString("not-a-campaign"));
        if(i==1)cJSON_ReplaceItemInObject(daily,"campaignVersion",cJSON_CreateNumber(0));
        if(i==2)cJSON_ReplaceItemInObject(daily,"campaignVersion",cJSON_CreateNumber(1.5));
        if(i==3)cJSON_ReplaceItemInObject(daily,"discountPercent",cJSON_CreateNumber(0));
        if(i==4)cJSON_ReplaceItemInObject(daily,"discountPercent",cJSON_CreateNumber(100));
        if(i==5)cJSON_ReplaceItemInObject(daily,"startsAt",cJSON_CreateString("2099-01-01T00:00:00.000Z"));
        if(i==6)cJSON_ReplaceItemInObject(daily,"expiresAt",cJSON_CreateString("2020-01-01T00:00:00.000Z"));
        if(i==7)cJSON_ReplaceItemInObject(unit,"amountMinor",cJSON_CreateString("229"));
        if(i==8)cJSON_ReplaceItemInObject(base,"currency",cJSON_CreateString("USDG"));
        if(i==9)cJSON_ReplaceItemInObject(base,"decimals",cJSON_CreateNumber(6));
        if(i==10)cJSON_ReplaceItemInObject(row,"promotion",cJSON_CreateObject());
        if(i==11)cJSON_DeleteItemFromObject(row,"dailyPromotion");
        assert(!table_catalog(&table,copy));cJSON_Delete(copy);cases++;
    }
    table=original;assert(apply_catalog(catalog)&&table.rows[0].daily_promotion&&
        !table.rows[0].promotion&&!table.rows[0].scoped_promotion&&table.rows[0].discount==40&&table.rows[0].percent==15);cases++;
    table=original;atomic_store(&clock_synced,false);assert(!apply_catalog(catalog));atomic_store(&clock_synced,true);cases++;
    /* Syntactically valid lease already elapsed: consumer must reject discounted replay. */
    table=original;cJSON *copy=cJSON_Duplicate(catalog,true);time_t past=time(NULL)-10;struct tm utc;char stamp[32];
    gmtime_r(&past,&utc);strftime(stamp,sizeof(stamp),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_ReplaceItemInObject(copy,"generatedAt",cJSON_CreateString(stamp));
    past=time(NULL)-1;gmtime_r(&past,&utc);strftime(stamp,sizeof(stamp),"%Y-%m-%dT%H:%M:%S.000Z",&utc);cJSON_ReplaceItemInObject(copy,"validUntil",cJSON_CreateString(stamp));
    cJSON *row=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0),*daily=cJSON_GetObjectItem(row,"dailyPromotion");
    cJSON_ReplaceItemInObject(daily,"startsAt",cJSON_CreateString("2020-01-01T00:00:00.000Z"));
    assert(!apply_catalog(copy));cJSON_Delete(copy);cases++;
    /* A public daily catalog works without a claimed private session, and can contain multiple daily products. */
    table=original;table.observed_cart=false;table.catalog_session[0]=0;table.auth=0;assert(table_catalog(&table,catalog));cases++;
    table=original;copy=cJSON_Duplicate(catalog,true);cJSON *products=cJSON_GetObjectItem(copy,"products");row=cJSON_GetArrayItem(products,0);
    cJSON *second=cJSON_Duplicate(row,true);cJSON_ReplaceItemInObject(second,"productId",cJSON_CreateString(fixture_order));cJSON_AddItemToArray(products,second);
    assert(table_catalog(&table,copy)&&table.rows_count==2&&table.rows[1].daily_promotion);cJSON_Delete(copy);cases++;
    /* No metadata cannot justify a discount; private-looking metadata cannot masquerade as public evidence. */
    table=original;copy=cJSON_Duplicate(catalog,true);row=cJSON_GetArrayItem(cJSON_GetObjectItem(copy,"products"),0);
    cJSON *evidence=cJSON_DetachItemFromObject(row,"dailyPromotion");cJSON_AddItemToObject(row,"personalPromotion",evidence);
    assert(!table_catalog(&table,copy));cases++;
    cJSON_DeleteItemFromObject(row,"personalPromotion");cJSON_ReplaceItemInObject(row,"unitPrice",cJSON_Duplicate(cJSON_GetObjectItem(row,"basePrice"),true));
    table=original;assert(table_catalog(&table,copy)&&!table.rows[0].daily_promotion&&!table.rows[0].promotion&&!table.rows[0].scoped_promotion);cases++;
    /* Existing canonical global amount and percent paths retain their own identity. */
    cJSON *offer=cJSON_CreateObject(),*discount=cJSON_AddObjectToObject(offer,"discount");
    cJSON_AddStringToObject(offer,"revision","1");cJSON_AddStringToObject(offer,"priceVersion",original.price);
    char expiry[32];assert(table_text(cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(catalog,"products"),0),"dailyPromotion"),"expiresAt",expiry,sizeof(expiry)));
    cJSON_AddStringToObject(offer,"expiresAt",expiry);cJSON_AddStringToObject(discount,"kind","percent");cJSON_AddNumberToObject(discount,"percent",15);
    cJSON_ReplaceItemInObject(row,"promotion",offer);cJSON_ReplaceItemInObject(cJSON_GetObjectItem(row,"unitPrice"),"amountMinor",cJSON_CreateString("230"));
    table=original;assert(table_catalog(&table,copy)&&table.rows[0].promotion&&!table.rows[0].daily_promotion&&!table.rows[0].scoped_promotion);cases++;
    cJSON_ReplaceItemInObject(discount,"kind",cJSON_CreateString("amount"));cJSON_DeleteItemFromObject(discount,"percent");cJSON_AddStringToObject(discount,"amountMinor","40");
    table=original;assert(table_catalog(&table,copy)&&table.rows[0].promotion&&table.rows[0].discount==40);cases++;
    cJSON_Delete(copy);table=original;
    assert(financial==transport_financial_digest()&&writes==host_writes);
    fprintf(stderr,"{\"origin\":\"production_daily_catalog_guards\",\"cases\":%u,\"financial_journal_unchanged\":true,\"physical_proof\":false}\n",cases);
}
