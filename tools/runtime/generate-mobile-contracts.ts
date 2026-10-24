import {readFile,writeFile} from 'node:fs/promises';
import {z} from 'zod';
type Field={type:'string'|'integer'|'boolean';pattern?:string;format?:'uuid'|'date-time';minLength?:number;maxLength?:number;minimum?:number;maximum?:number;enum?:(string|number|boolean)[]}|{$ref:string}|{type:'array';items:Field;minItems?:number;maxItems?:number}|{type:'null'}|{anyOf:[Field,{type:'null'}]};
const field:z.ZodType<Field>=z.lazy(()=>z.union([
 z.object({type:z.enum(['string','integer','boolean']),pattern:z.string().optional(),format:z.enum(['uuid','date-time']).optional(),minLength:z.number().int().nonnegative().optional(),maxLength:z.number().int().nonnegative().optional(),minimum:z.number().optional(),maximum:z.number().optional(),enum:z.array(z.union([z.string(),z.number(),z.boolean()])).optional()}).strict(),
 z.object({type:z.literal('null')}).strict(),
 z.object({$ref:z.string().regex(/^#\/components\/schemas\/[A-Z][A-Za-z0-9]*$/)}).strict(),
 z.object({type:z.literal('array'),items:field,minItems:z.number().int().nonnegative().optional(),maxItems:z.number().int().nonnegative().optional()}).strict(),
 z.object({anyOf:z.tuple([field,z.object({type:z.literal('null')}).strict()])}).strict()
]));
const model=z.object({type:z.literal('object'),additionalProperties:z.literal(false),required:z.array(z.string()),properties:z.record(z.string(),field),'x-bitpos-money':z.literal(true).optional()}).strict();
const taggedUnion=z.object({oneOf:z.array(z.object({$ref:z.string().regex(/^#\/components\/schemas\/[A-Z][A-Za-z0-9]*$/)}).strict()).min(2),discriminator:z.object({propertyName:z.string()}).strict()}).strict();
const document=z.object({components:z.object({schemas:z.record(z.string(),z.union([model,taggedUnion]))}).passthrough()}).passthrough().parse(JSON.parse(await readFile('packages/openapi/mobile-v1.json','utf8')));
const schemas=document.components.schemas;
const unionParents=new Map<string,{parent:string;key:string;tag:string}>();
for(const [parent,schema] of Object.entries(schemas)){
 if(!('oneOf' in schema))continue;
 const tags=new Set<string>();
 for(const reference of schema.oneOf){
  const member=reference.$ref.slice('#/components/schemas/'.length),child=schemas[member],key=schema.discriminator.propertyName;
  if(!child||'oneOf' in child)throw Error('Tagged union member must be an object: '+member);
  const tag=child.properties[key];
  if(!tag||!('type' in tag)||tag.type!=='string'||!('enum' in tag)||tag.enum?.length!==1||typeof tag.enum[0]!=='string'||tags.has(tag.enum[0])||unionParents.has(member))throw Error('Unique singleton discriminator required: '+member);
  tags.add(tag.enum[0]);unionParents.set(member,{parent,key,tag:tag.enum[0]});
 }
}
function refName(value:string){const name=value.slice('#/components/schemas/'.length);if(!schemas[name])throw Error('Unknown model '+name);return name;}
function dependencies(value:Field):string[]{if('$ref' in value)return [refName(value.$ref)];if('anyOf' in value)return dependencies(value.anyOf[0]);return value.type==='array'?dependencies(value.items):[];}
const ordered:string[]=[],visiting=new Set<string>(),visited=new Set<string>();
function visit(name:string){
 if(visited.has(name))return;if(visiting.has(name))throw Error('Recursive mobile model unsupported: '+name);
 visiting.add(name);const schema=schemas[name];for(const f of 'oneOf' in schema?schema.oneOf:Object.values(schema.properties))for(const dependency of dependencies(f))visit(dependency);
 visiting.delete(name);visited.add(name);ordered.push(name);
}
for(const name of Object.keys(schemas))visit(name);
const quoted=(v:unknown)=>JSON.stringify(v);
function compile(value:Field,path:string):{type:string;validator:string;read:string;write:(key:string)=>string}{
 if('$ref' in value){const name=refName(value.$ref);return {type:name,validator:name+'Schema',read:`${name}.fromJson(_object(value, path))`,write:key=>`${key}.toJson()`};}
 if('type' in value&&value.type==='null')return {type:'Null',validator:'z.null()',read:`value == null ? null : (throw FormatException('Invalid $path'))`,write:key=>key};
 if('anyOf' in value){
  const inner=compile(value.anyOf[0],path);
  if(inner.type.endsWith('?'))throw Error('Nested nullable field: '+path);
  return {type:inner.type+'?',validator:inner.validator+'.nullable()',read:`value == null ? null : (${inner.read})`,write:key=>{const result=inner.write(key);return result===key?key:key+'?'+result.slice(key.length);}};
 }
 if(value.type==='array'){
  const inner=compile(value.items,path+'[]');
  let validator=`z.array(${inner.validator})`;if(value.minItems!==undefined)validator+=`.min(${value.minItems})`;if(value.maxItems!==undefined)validator+=`.max(${value.maxItems})`;
  return {type:`List<${inner.type}>`,validator,read:`List<${inner.type}>.unmodifiable(_list(value, path, ${value.minItems??0}, ${value.maxItems??'null'}).map((value) => ${inner.read}))`,write:key=>`${key}.map((value) => ${inner.write('value')}).toList()`};
 }
 let validator={string:'z.string()',integer:'z.number().int().safe()',boolean:'z.boolean()'}[value.type];
 if(value.pattern)validator+=`.regex(new RegExp(${quoted(value.pattern)}))`;
 if(value.format==='uuid')validator+='.uuid()';if(value.format==='date-time')validator+='.datetime({offset:true}).regex(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/)';
 if(value.minLength!==undefined)validator+=`.min(${value.minLength})`;if(value.maxLength!==undefined)validator+=`.max(${value.maxLength})`;
 if(value.minimum!==undefined)validator+=`.min(${value.minimum})`;if(value.maximum!==undefined)validator+=`.max(${value.maximum})`;
 if(value.enum)validator+=`.refine(value => ${quoted(value.enum)}.includes(value))`;
 const args=value.type==='string'?`, pattern: ${value.pattern?quoted(value.pattern).replaceAll('$','\\$'):'null'}, format: ${value.format?quoted(value.format):'null'}, min: ${value.minLength??0}, max: ${value.maxLength??'null'}`:value.type==='integer'?`, min: ${value.minimum??'null'}, max: ${value.maximum??'null'}`:'';
 let read=`_${value.type}(value, path${args})`;
 if(value.enum)read=`_enum(${read}, ${quoted(value.enum)}, path)`;
 return {type:{string:'String',integer:'int',boolean:'bool'}[value.type],validator,read,write:key=>key};
}
let ts="// Generated by tools/runtime/generate-mobile-contracts.ts; edit OpenAPI, not this file.\nimport {z} from 'zod';\n";
let dart=`// Generated by tools/runtime/generate-mobile-contracts.ts; edit OpenAPI, not this file.
Map<String,dynamic> _object(dynamic value, String path) {
 if (value is! Map<String,dynamic>) throw FormatException('Invalid $path');
 return value;
}
List<dynamic> _list(dynamic value, String path, int min, int? max) {
 if (value is! List || value.length < min || (max != null && value.length > max)) throw FormatException('Invalid $path');
 return value;
}
T _enum<T>(T value, List<dynamic> choices, String path) {
 if (!choices.contains(value)) throw FormatException('Invalid $path');
 return value;
}
String _string(dynamic value, String path, {String? pattern, String? format, int min=0, int? max}) {
 if (value is! String || value.length < min || (max != null && value.length > max) || (pattern != null && !RegExp(pattern).hasMatch(value))) throw FormatException('Invalid $path');
 if (format == 'uuid' && !RegExp(r'^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$').hasMatch(value)) throw FormatException('Invalid $path');
 if (format == 'date-time' && !_dateTime(value)) throw FormatException('Invalid $path');
 return value;
}
bool _dateTime(String value) {
 final m=RegExp(r'^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$').firstMatch(value);
 if (m == null || DateTime.tryParse(value) == null) return false;
 final y=int.parse(m[1]!), month=int.parse(m[2]!), day=int.parse(m[3]!);
 if (month<1 || month>12 || day<1 || day>DateTime.utc(y,month+1,0).day || int.parse(m[4]!)>23 || int.parse(m[5]!)>59 || int.parse(m[6]!)>59) return false;
 final zone=m[7]!;
 return zone=='Z' || (int.parse(zone.substring(1,3))<24 && int.parse(zone.substring(4,6))<60);
}
int _integer(dynamic value, String path, {num? min, num? max}) {
 if (value is! num || !value.isFinite || value.truncateToDouble()!=value || value.abs()>9007199254740991 || (min != null && value<min) || (max != null && value>max)) throw FormatException('Invalid $path');
 return value.toInt();
}
bool _boolean(dynamic value, String path) {
 if (value is! bool) throw FormatException('Invalid $path');
 return value;
}
`;
for(const name of ordered){
 const schema=schemas[name];
 if(!/^[A-Z][A-Za-z0-9]*$/.test(name))throw Error('Invalid model name');
 if('oneOf' in schema){
  const members=schema.oneOf.map(reference=>refName(reference.$ref));
  ts+=`export const ${name}Schema=z.union([${members.map(member=>member+'Schema').join(',')}]);\nexport type ${name}=z.infer<typeof ${name}Schema>;\n`;
  dart+=`\nsealed class ${name} {\n const ${name}();\n factory ${name}.fromJson(Map<String,dynamic> json)=>switch(json[${quoted(schema.discriminator.propertyName)}]){\n${members.map(member=>`${quoted(unionParents.get(member)!.tag)}=>${member}.fromJson(json),`).join('\n')}\n _=>throw const FormatException('Invalid ${name} discriminator'),\n };\n Map<String,dynamic> toJson();\n}\n`;
  continue;
 }
 if(schema.required.length!==Object.keys(schema.properties).length||new Set(schema.required).size!==schema.required.length)throw Error('All model fields must be required; use explicit nullable fields');
 const dartKeywords=new Set('assert break case catch class const continue default do else enum extends false final finally for if in is new null rethrow return super switch this throw true try var void while with'.split(' '));
 const entries=Object.entries(schema.properties).map(([key,value])=>{
  if(!/^[a-z][A-Za-z0-9]*$/.test(key)||!schema.required.includes(key))throw Error('Invalid model field');
  const compiled=compile(value,name+'.'+key),parent=unionParents.get(name);
  return {key,dartKey:dartKeywords.has(key)?key+'Value':key,...compiled,...(parent?.key===key?{validator:`z.literal(${quoted(parent.tag)})`}:{})};
 });
 if(new Set(entries.map(f=>f.dartKey)).size!==entries.length)throw Error('Dart field name collision in '+name);
 if(schema['x-bitpos-money'])ts+=`type ${name}Base={currency:'USD'|'THB'|'USDG'|'USDC'|'USDT';decimals:number;amountMinor:string};\n`;
 ts+=`export const ${name}Schema=z.object({\n${entries.map(f=>` ${f.key}:${f.validator},`).join('\n')}\n}).strict()`;
 if(schema['x-bitpos-money'])ts+=`.pipe(z.custom<${name}Base>().refine(v => BigInt(v.amountMinor)<=9223372036854775807n && (v.currency==='USD'?[2,4].includes(v.decimals):v.currency==='THB'?v.decimals===2:v.decimals===6), 'Invalid canonical money'))`;
 ts+=`;\nexport type ${name}=z.infer<typeof ${name}Schema>;\n`;
 dart+=`\nclass ${name}${unionParents.has(name)?' extends '+unionParents.get(name)!.parent:''} {\n${entries.map(f=>` final ${f.type} ${f.dartKey};`).join('\n')}\n`;
 dart+=` const ${name}._({${entries.map(f=>`required this.${f.dartKey}`).join(', ')}});\n`;
 dart+=` factory ${name}({${entries.map(f=>`required ${f.type} ${f.dartKey}`).join(', ')}}) => ${name}.fromJson({${entries.map(f=>`${quoted(f.key)}: ${f.write(f.dartKey)}`).join(', ')}});\n`;
 dart+=` factory ${name}.fromJson(Map<String,dynamic> json) {\n`;
 dart+=`  if (json.length != ${entries.length} || !json.keys.every(${quoted(entries.map(f=>f.key))}.contains)) throw const FormatException('Invalid ${name} fields');\n`;
 for(const f of entries)dart+=`  final ${f.dartKey}=(() { final value=json[${quoted(f.key)}]; const path=${quoted(name+'.'+f.key)}; return ${f.read}; })();\n`;
 if(schema['x-bitpos-money'])dart+=`  if (BigInt.parse(amountMinor)>BigInt.parse('9223372036854775807') || !(currency=='USD'?[2,4].contains(decimals):currency=='THB'?decimals==2:decimals==6)) throw const FormatException('Invalid canonical money');\n`;
 dart+=`  return ${name}._(${entries.map(f=>`${f.dartKey}: ${f.dartKey}`).join(', ')});\n }\n${unionParents.has(name)?' @override\n':''} Map<String,dynamic> toJson() => {${entries.map(f=>`${quoted(f.key)}: ${f.write(f.dartKey)}`).join(', ')}};\n}\n`;
}
const outputs=[['packages/contracts/src/mobile-v1.generated.ts',ts],['packages/mobile_shared/lib/mobile_v1.generated.dart',dart]];
for(const [path,content] of outputs){
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error('Generated contract drift: '+path);}
 else await writeFile(path,content);
}
console.log(process.argv.includes('--check')?'Mobile contracts match OpenAPI':'Generated TypeScript and Dart mobile contracts');
