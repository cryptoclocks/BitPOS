import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const path='supabase/migrations/077_food_offer_lifecycle.sql',source=await readFile('supabase/migrations/074_food_dispatch_search.sql','utf8'),name='CREATE FUNCTION food_dispatch_search_command(',start=source.indexOf(name),end=source.indexOf('END $$;',start)+7;assert.ok(start>=0&&end>start);
let command=source.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
const guard=" IF EXISTS(SELECT 1 FROM food_dispatch_offers WHERE shipment_id=s.id AND state='OFFERED' AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'OFFER_PENDING';END IF;";
assert.equal(command.split(guard).length,2);command=command.replace(guard,guard.replace('IF EXISTS','IF action<>\'MANUAL\' AND EXISTS'));
const manual=" ELSIF action='MANUAL' THEN\n  IF t.shipment_id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;";assert.equal(command.split(manual).length,2);command=command.replace(manual,manual+"\n  PERFORM food_dispatch_close_offers_locked(s.id,'WITHDRAWN');");
const marker='-- Generated takeover wrapper from exact074; regenerate, do not hand-edit.\n',existing=await readFile(path,'utf8');await writeFile(path,existing.split(marker)[0]+marker+command+'\n');console.log('Generated root-serialized pending-offer withdrawal with original bounded search command/journal');
