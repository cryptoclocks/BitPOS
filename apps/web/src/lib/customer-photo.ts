/** Decode locally, strip metadata and bound storage to a small square raster. */
export async function customerPhoto(file:File):Promise<string>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10000000)throw Error('PHOTO_INVALID');
 const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx)throw Error('PHOTO_INVALID');const side=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);const result=canvas.toDataURL('image/webp',0.8);if(result.length>140000)throw Error('PHOTO_INVALID');return result;}finally{bitmap.close();}
}
