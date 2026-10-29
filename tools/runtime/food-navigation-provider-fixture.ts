import http from 'node:http';
import {deflateSync} from 'node:zlib';
// Original synthetic coordinate grid, NOT street data or actual navigation advice.
function crc32(data:Buffer){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(kind:string,data:Buffer){const type=Buffer.from(kind),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,data])),8+data.length);return out;}
const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;
const raster=Buffer.alloc(256*(1+256*3));for(let y=0;y<256;y++)for(let x=0;x<256;x++){const at=y*769+1+x*3,grid=x%32===0||y%32===0;raster[at]=grid?180:245;raster[at+1]=grid?150:235;raster[at+2]=grid?205:250;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raster)),chunk('IEND',Buffer.alloc(0))]);
function polyline(points:{lat:number;lon:number}[]){let lastLat=0,lastLon=0,result='';const delta=(value:number)=>{let unsigned=value<0?-value*2-1:value*2,out='';while(unsigned>=32){out+=String.fromCharCode((unsigned%32)+95);unsigned=Math.floor(unsigned/32);}return out+String.fromCharCode(unsigned+63);};for(const point of points){const lat=Math.round(point.lat*1e6),lon=Math.round(point.lon*1e6);result+=delta(lat-lastLat)+delta(lon-lastLon);lastLat=lat;lastLon=lon;}return result;}
const server=http.createServer(async(req,res)=>{try{
 if(req.method==='GET'&&/^\/tiles\/\d+\/\d+\/\d+\.png$/.test(req.url??'')){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(png);return;}
 if(req.method!=='POST'||req.url!=='/route'){res.writeHead(404);res.end();return;}
 let body='';for await(const data of req){body+=data;if(body.length>4096)throw Error('Fixture body budget');}
 const input=JSON.parse(body),points=input.locations;if(!Array.isArray(points)||points.length!==2||!points.every(p=>typeof p.lat==='number'&&typeof p.lon==='number'))throw Error('Fixture coordinates');
 const summary={time:120,length:.5};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({trip:{status:0,units:'kilometers',summary,legs:[{summary,shape:polyline(points)}]}}));
 }catch{res.writeHead(400);res.end();}});
server.listen(3998,'127.0.0.1',()=>console.log('SYNTHETIC navigation fixture ready 3998; grid/straight line NOT real roads, ETA or GPS'));
