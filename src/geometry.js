/* Actual NanoVG wasm2js core; bounded retained geometry, glyph/image and metric
 * caches. Geometry changes do not require repainting a full RGBA image in JS. */
(function(g){
 'use strict';
 function decode(s){
  if(typeof s!=='string'||s.length>22369624||s.length%4||/[^A-Za-z0-9+/=]/.test(s)||s.slice(0,-2).indexOf('=')!==-1||(s.endsWith('=')?false:s.indexOf('=')!==-1))throw Error('Invalid native UI base64 asset');
  var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',padding=s.endsWith('==')?2:s.endsWith('=')?1:0,out=new Uint8Array(s.length/4*3-padding),at=0;
  for(var i=0;i<s.length;i+=4){var word=(alphabet.indexOf(s[i])<<18)|(alphabet.indexOf(s[i+1])<<12)|((s[i+2]==='='?0:alphabet.indexOf(s[i+2]))<<6)|(s[i+3]==='='?0:alphabet.indexOf(s[i+3]));out[at++]=word>>>16;if(at<out.length)out[at++]=word>>>8;if(at<out.length)out[at++]=word;}
  return out;
 }
 async function create(){
  var textures=new Map(),generation=0,textureLayout=0,totalTextureBytes=0,closed=false;
  var m=await g.CivNanoVGFactory({civTextures:textures,civTexture:function(op,id,w,h,type,pointer){
   var old=textures.get(id);
   // Retained geometry can still reference an earlier font atlas after NanoVG
   // grows it. Keep its immutable pixels within the same bounded texture budget.
   if(op===2){if(old)old.retired=true;generation++;return;}
   if(op===1){if(!old)throw Error('Unknown NanoVG texture');w=old.w;h=old.h;type=old.type;}
   var size=w*h*(type===1?1:4);if(!Number.isSafeInteger(size)||size<1||totalTextureBytes-(old?old.bytes.length:0)+size>16777216)throw Error('NanoVG texture budget exceeded');
   var same=old&&old.w===w&&old.h===h&&old.type===type&&old.bytes.length===size;
   totalTextureBytes+=size-(old?old.bytes.length:0);
   var texture=same?old:{w:w,h:h,type:type,bytes:new Uint8Array(size),packedRevision:-1};
   if(pointer)texture.bytes.set(m.HEAPU8.subarray(pointer,pointer+size));else texture.bytes.fill(0);
   texture.revision=++generation;if(!same)textureLayout++;textures.set(id,texture);
  }});
  if(!m._civ_init())throw Error('NanoVG initialization failed');
  function withBytes(bytes,fn){var p=m._malloc(bytes.length+1);if(!p)throw Error('NanoVG allocation failed');try{m.HEAPU8.set(bytes,p);m.HEAPU8[p+bytes.length]=0;return fn(p);}finally{m._free(p);}}
  function string(text,fn){var encoded=unescape(encodeURIComponent(text)),bytes=new Uint8Array(encoded.length);for(var i=0;i<encoded.length;i++)bytes[i]=encoded.charCodeAt(i);return withBytes(bytes,fn);}
  var fontData=[decode(g.CivNanoVGAssets['Roboto-Regular.ttf']),decode(g.CivNanoVGAssets['Roboto-Bold.ttf']),decode(g.CivNanoVGAssets['SourceCodePro-Regular.ttf'])],fontPointers=[],fonts=[];
  fontData.forEach(function(bytes,i){var p=m._malloc(bytes.length);if(!p)throw Error('NanoVG font allocation failed');fontPointers.push(p);m.HEAPU8.set(bytes,p);fonts.push(m._civ_font(p,bytes.length,i));if(fonts[i]<0)throw Error('NanoVG font rejected');});
  var images=new Map(),cache=new Map(),cacheBytes=0,measureCache=new Map(),metricCache=new Map(),packedLayout=-1,packedTextures=null,packedMeta=null;
  var arena=null,arenaGeneration=-1,revision=0,prepared=new Map(),preparedBytes=0;
  var stats={geometryHits:0,geometryMisses:0,geometryBytes:0,textureGeneration:0,texturePackedBytes:0,textureFullPacks:0};
  function measure(text,size,bold){var key=size+':'+bold+':'+text;if(measureCache.has(key))return measureCache.get(key);var value=string(text,function(p){return m._civ_measure(size,fonts[bold===2?2:bold?1:0],p);});if(measureCache.size>=4096)measureCache.clear();measureCache.set(key,value);return value;}
  // Fontstash normalizes vertical metrics to ascent-descent, while current STB
  // rasterization and CSS size glyphs in em units. Use the TTF's actual em
  // metrics for baseline alignment; do not squeeze or offset text by guesswork.
  function metrics(size,bold){var key=size+':'+bold;if(!metricCache.has(key))metricCache.set(key,g.CivNanoVGFontMetrics[bold===2?2:bold?1:0].map(function(v){return v*size;}));return metricCache.get(key);}
  function image(source){
   if(images.has(source))return images.get(source);if(images.size>=128)throw Error('NanoVG image cache limit');
   var base=source.slice(source.lastIndexOf('/')+1),encoded=g.CivNanoVGAssets[base];
   if(source.indexOf('data:image/png;base64,')===0)encoded=source.slice(22);
   if(!encoded)throw Error('Prototype image must be bundled or a PNG data URL: '+base);
   var decoded=decode(encoded),id=withBytes(decoded,function(p){return m._civ_image(p,decoded.length);});if(!id)throw Error('NanoVG PNG rejected');images.set(source,id);return id;
  }
  function pixels(width,height,initial){
   var length=width*height*4;
   if(closed||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1080||!(initial instanceof Uint8Array)||initial.length!==length)throw Error('Invalid RGBA image');
   var id=withBytes(initial,function(p){return m._civ_rgba(width,height,p);});
   if(!id)throw Error('NanoVG RGBA image rejected');var source='civapps-pixels:'+id;images.set(source,id);
   return {source:source,update:function(bytes){
    if(closed||!(bytes instanceof Uint8Array)||bytes.length!==length)throw Error('Invalid RGBA frame');
    // NanoVG keeps image dimensions/flags, while this backend owns the pixels.
    // Updating the retained JS buffer avoids a temporary C heap copy/callback.
    var texture=textures.get(id);if(!texture||texture.type!==3)throw Error('RGBA texture is unavailable');
    texture.bytes.set(bytes);texture.revision=++generation;
   }};
  }
  function packTextures(data,metaOffset,textureOffset,texels){
   var full=packedLayout!==textureLayout||arenaGeneration<0;stats.texturePackedBytes=0;
   if(full){
    packedMeta=new Uint32Array(256*4);packedTextures=new Uint32Array(texels);var offset=0;
    textures.forEach(function(t,id){t.wordOffset=offset;packedMeta.set([offset,t.w,t.h,t.type],id*4);t.packedRevision=-1;offset+=t.w*t.h;});
    packedLayout=textureLayout;data.set(packedMeta,metaOffset);stats.textureFullPacks++;
   }
   textures.forEach(function(t){
    if(t.packedRevision===t.revision)return;
    var offset=t.wordOffset,length=t.w*t.h;
    if(t.type===1)for(var i=0;i<length;i++)packedTextures[offset+i]=(0xffffff00|t.bytes[i])>>>0;
    else packedTextures.set(new Uint32Array(t.bytes.buffer,t.bytes.byteOffset,length),offset);
    data.set(packedTextures.subarray(offset,offset+length),textureOffset+offset);
    stats.texturePackedBytes+=length*4;t.packedRevision=t.revision;
   });arenaGeneration=generation;
  }
  function patches(textureOffset){return Array.from(textures.values(),function(t){return {revision:t.revision,offset:(textureOffset+t.wordOffset)*4,bytes:t.w*t.h*4};});}
  function buildCommand(c,width,height){
   m._civ_begin(width,height);m._civ_clip(c.clip[0],c.clip[1],Math.max(0,c.clip[2]-c.clip[0]),Math.max(0,c.clip[3]-c.clip[1]));
   if(c.color)m._civ_color.apply(null,c.color);
   var r=c.rect;
   if(c.kind==='rect')m._civ_rect(r[0],r[1],r[2]-r[0],r[3]-r[1],c.radius);
   else if(c.kind==='border')m._civ_border(r[0],r[1],r[2]-r[0],r[3]-r[1],c.radius,c.lineWidth);
   else if(c.kind==='triangle')m._civ_triangle.apply(null,c.points);
   else if(c.kind==='text')string(c.text,function(p){m._civ_text(c.x,c.baseline,c.size,fonts[c.font===2?2:c.bold?1:0],p);});
   else if(c.kind==='image')m._civ_picture(r[0],r[1],r[2]-r[0],r[3]-r[1],c.radius,image(c.source),c.alpha);
   else throw Error('Unknown NanoVG command');
   m._civ_end();if(m._civ_failed())throw Error('NanoVG geometry capacity exceeded');
   var d=m._civ_draws()/4,t=m._civ_tris()/4;
   var result={draws:new Float32Array(m.HEAPF32.subarray(d,d+m._civ_draw_count()*32)),tris:new Float32Array(m.HEAPF32.subarray(t,t+m._civ_tri_count()*16))};
   if(c.kind==='rect'){var inset=Math.max(0,c.radius)+1;for(var i=0;i<result.draws.length;i+=32){result.draws.set([r[0]+inset,r[1]+inset,r[2]-inset,r[3]-inset,1],i+25);}}
   return result;
  }
  function build(scene,retainOnly){
   if(closed)throw Error('NanoVG geometry is closed');stats.geometryHits=stats.geometryMisses=0;var parts=[],nd=0,nt=0;
   var sceneKey=scene.width+':'+scene.height+':'+(scene.__nanoHash||JSON.stringify(scene.commands)),retained=prepared.get(sceneKey),preparedHit=!!retained;
   if(retained&&retainOnly&&arena&&packedLayout===textureLayout&&retained.draws.byteLength+retained.tris.byteLength<=524288){
    stats.geometryHits=scene.commands.length;stats.geometryMisses=0;stats.preparedHit=true;prepared.delete(sceneKey);prepared.set(sceneKey,retained);
    packTextures(arena,arena[6],arena[7],packedTextures.length);
    return {data:arena,header:retained.header,width:scene.width,height:scene.height,draws:retained.draws.length/32,triangles:retained.tris.length/16,generation:generation,textureLayout:textureLayout,texturePatches:patches(arena[7]),revision:++revision,geometryId:retained,drawData:retained.draws,triData:retained.tris};
   }
   if(retained){parts=[retained];nd=retained.draws.length/32;nt=retained.tris.length/16;stats.geometryHits=scene.commands.length;prepared.delete(sceneKey);prepared.set(sceneKey,retained);}
   else for(var c of scene.commands){
    var local=c,translated=c.kind==='text'&&c.font===2,tx=Math.floor(c.x||0),ty=Math.floor(c.baseline||0);
    if(translated)local=Object.assign({},c,{x:c.x-tx,baseline:0,clip:[-100000,-100000,100000,100000],id:'text'});
    var key=scene.width+':'+scene.height+':'+JSON.stringify(local),part=cache.get(key);
    if(part){stats.geometryHits++;cache.delete(key);cache.set(key,part);}else{
     stats.geometryMisses++;part=buildCommand(local,scene.width,scene.height);var size=part.draws.byteLength+part.tris.byteLength;
     while(cache.size&&(cacheBytes+size>16777216||cache.size>=2048)){var oldest=cache.keys().next().value,a=cache.get(oldest);cacheBytes-=a.draws.byteLength+a.tris.byteLength;cache.delete(oldest);}
     if(size<=16777216){cache.set(key,part);cacheBytes+=size;}
    }
    if(translated){
     var placed=new Float32Array(part.draws);for(var j=0;j<placed.length;j+=32){placed[j]+=tx;placed[j+1]+=ty;placed[j+2]+=tx;placed[j+3]+=ty;placed.set(c.clip,j+12);placed[j+30]=tx;placed[j+31]=ty;}
     part={draws:placed,tris:part.tris};
    }
    parts.push(part);nd+=part.draws.length/32;nt+=part.tris.length/16;
   }
   if(nd>4096||nt>65536)throw Error('NanoVG scene geometry limit exceeded');
   var textureCount=Math.max.apply(null,[0].concat(Array.from(textures.keys())))+1;if(textureCount>256)throw Error('NanoVG texture IDs exhausted');
   // Stable section addresses let native output reuse untouched atlas bytes even
   // when a selection changes the number of geometry records.
   var drawOffset=16,triOffset=drawOffset+4096*32,metaOffset=triOffset+65536*16,textureOffset=metaOffset+256*4,texels=0;
   textures.forEach(function(t){texels+=t.w*t.h;});
   if(!arena||arena.length!==textureOffset+texels){arena=new Uint32Array(textureOffset+texels);arenaGeneration=-1;}
   var data=arena,floats=new Float32Array(data.buffer);if(data.byteLength>33554432)throw Error('NanoVG GPU input limit exceeded');
   data.set([scene.width,scene.height,nd,nt,drawOffset,triOffset,metaOffset,textureOffset,128,0,Math.ceil(scene.width/32),Math.ceil(scene.height/32),Math.ceil(scene.width/32)*Math.ceil(scene.height/32)*897]);
   var di=0,ti=0;
   if(!retained||!retainOnly||retained.draws.byteLength+retained.tris.byteLength>524288)for(var part of parts){floats.set(part.draws,drawOffset+di*32);floats.set(part.tris,triOffset+ti*16);for(var j=0;j<part.draws.length/32;j++)floats[drawOffset+(di+j)*32+8]+=ti;di+=part.draws.length/32;ti+=part.tris.length/16;}
   if(!retained){
    var saved={draws:new Float32Array(floats.subarray(drawOffset,drawOffset+nd*32)),tris:new Float32Array(floats.subarray(triOffset,triOffset+nt*16))},size=saved.draws.byteLength+saved.tris.byteLength;
    while(prepared.size&&(preparedBytes+size>8388608||prepared.size>=64)){var oldest=prepared.keys().next().value,old=prepared.get(oldest);preparedBytes-=old.draws.byteLength+old.tris.byteLength;prepared.delete(oldest);}
    if(size<=8388608){prepared.set(sceneKey,saved);preparedBytes+=size;}saved.header=new Uint8Array(data.buffer.slice(0,64));retained=saved;
   }
   packTextures(data,metaOffset,textureOffset,texels);
   stats.geometryBytes=cacheBytes;stats.preparedBytes=preparedBytes;stats.preparedHit=preparedHit;stats.textureGeneration=generation;stats.inputBytes=data.byteLength;
   return {data:data,width:scene.width,height:scene.height,draws:nd,triangles:nt,generation:generation,textureLayout:textureLayout,texturePatches:patches(arena[7]),revision:++revision,geometryId:retained,drawData:retained.draws,triData:retained.tris};
  }
  return {build:build,pixels:pixels,measure:measure,metrics:metrics,stats:stats,module:m,textures:textures,
   close:function(){if(closed)return;closed=true;m._civ_close();fontPointers.forEach(m._free);cache.clear();prepared.clear();arena=null;measureCache.clear();textures.clear();images.clear();}};
 }
 g.CivNanoVGGeometry={create:create,decode:decode};
})(typeof window!=='undefined'?window:globalThis);
