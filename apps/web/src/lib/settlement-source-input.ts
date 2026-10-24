/** Normalize operator-entered pairs together; never infer or change a source version. */
export function parseSettlementSourcePairs(text:string):{sourceIds:string[];sourceVersions:string[]} {
 const rows=text.trim().split(/\r?\n/).filter(line=>line.trim()).map(line=>line.trim().split(/\s+/));
 if(!text.trim()||rows.length>50)throw new Error('INVALID_SOURCE_PAIRS');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const seen=new Set<string>();
 const pairs=rows.map(row=>{
  if(row.length!==2||!uuid.test(row[0])||! /^[1-9][0-9]{0,18}$/.test(row[1]))throw new Error('INVALID_SOURCE_PAIRS');
  const id=row[0].toLowerCase();if(seen.has(id))throw new Error('INVALID_SOURCE_PAIRS');seen.add(id);
  return {id,version:row[1]};
 }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return {sourceIds:pairs.map(row=>row.id),sourceVersions:pairs.map(row=>row.version)};
}
