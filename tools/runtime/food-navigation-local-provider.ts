import {createServer} from 'node:http';
import {deflateSync} from 'node:zlib';

// Explicit deterministic local-only Valhalla/XYZ fixture. This emits no real
// roads, traffic, GPS or travel estimates and must never be used in production.
const port=Number(process.env.BITPOS_LOCAL_NAV_PROVIDER_PORT??3043);
function crc32(data:Buffer){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,checksum]);}
function tile(){const header=Buffer.alloc(13);header.writeUInt32BE(256,0);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((256*4+1)*256);for(let y=0;y<256;y++){const row=y*(256*4+1);rows[row]=0;for(let x=0;x<256;x++){const road=x%64<3||y%64<3,at=row+1+x*4;rows[at]=road?255:244;rows[at+1]=road?255:239;rows[at+2]=road?255:250;rows[at+3]=255;}}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
function encodeDelta(delta:number){let value=delta<0?~(delta<<1):(delta<<1),out='';while(value>=0x20){out+=String.fromCharCode((0x20|(value&0x1f))+63);value>>=5;}return out+String.fromCharCode(value+63);}
function polyline(points:{latitudeE7:number;longitudeE7:number}[]){let lat=0,lon=0,result='';for(const point of points){const nextLat=Math.round(point.latitudeE7/10),nextLon=Math.round(point.longitudeE7/10);result+=encodeDelta(nextLat-lat)+encodeDelta(nextLon-lon);lat=nextLat;lon=nextLon;}return result;}
const png=tile();
const server=createServer(async(req,res)=>{const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);if(req.method==='POST'&&url.pathname==='/route'){let body='';for await(const part of req)body+=part;const input=JSON.parse(body),start=input.locations[0],end=input.locations.at(-1),shape=polyline([{latitudeE7:Math.round(start.lat*1e7),longitudeE7:Math.round(start.lon*1e7)},{latitudeE7:Math.round(end.lat*1e7),longitudeE7:Math.round(end.lon*1e7)}]);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({trip:{status:0,units:'kilometers',summary:{time:120,length:0.5},legs:[{summary:{time:120,length:0.5},shape}]}}));return;}if(req.method==='GET'&&/^\/tiles\/\d+\/\d+\/\d+\.png$/.test(url.pathname)){res.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length});res.end(png);return;}res.writeHead(404);res.end();});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic navigation provider listening on 127.0.0.1:${port}`));
