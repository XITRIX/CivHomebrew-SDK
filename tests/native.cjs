const {readModule}=require('./library.cjs');
/* Native-call ownership/LP64 records, not a fake GPU correctness claim. Real
 * SPIR-V correctness is checked separately by vulkan-host.c. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function setup(){
 const g={console,setTimeout,clearTimeout};g.window=g;g.globalThis=g;const context=vm.createContext(g);
 for(const name of ['bytes','civ-vulkan','nanovg-shaders'])vm.runInContext(readModule(name),context);
 const mem=new Map(),calls=[],names=new Map(),buffers=new Map();let allocation=0x100000000n,handle=0x200000000n,fn=0x400000000n,timeout=false,overflow=false;
 const read=(at,n)=>Uint8Array.from({length:n},(_,i)=>mem.get(BigInt(at)+BigInt(i))||0);
 const write=(at,bytes)=>bytes.forEach((v,i)=>mem.set(BigInt(at)+BigInt(i),v));
 const put64=(at,value)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));write(at,b);};
 const read64=at=>Buffer.from(read(at,8)).readBigUInt64LE();
 const alloc=n=>{const p=allocation;allocation+=BigInt(n+4096);return Number(p);};
 const native={read64,read32:at=>BigInt(Buffer.from(read(at,4)).readUInt32LE()),write64:put64,write32:(at,n)=>{const b=Buffer.alloc(4);b.writeUInt32LE(Number(n));write(at,b);}};
 const c={allocate:alloc,write,read:(p,n)=>g.CivNanoVGBuffer.from(read(p,n)),native,resolve:name=>{for(const [p,n] of names)if(n===name)return Number(p);const p=fn;fn+=16n;names.set(p,name);return Number(p);},rpc:{request:async()=>({hash:g.CivNanoVGModules.compatTable.module.hash})},call:(p,...args)=>{
  const name=names.get(p);assert(name);assert(args.length<=6,'all calls must fit the verified native bridge');calls.push({name,args,info:name==='vkCreateImageView'?Buffer.from(read(args[1],80)):null});
  if(name==='vkGetPhysicalDeviceMemoryProperties'){const b=Buffer.alloc(520);b.writeUInt32LE(1);b.writeUInt32LE(6,4);write(args[1],b);}
  else if(name==='vkGetBufferMemoryRequirements'){put64(args[2],buffers.get(args[1])||4096n);put64(args[2]+8n,256n);native.write32(args[2]+16n,1n);}
  else if(name==='vkMapMemory2'){put64(args[2],alloc(Number(read64(args[1]+40n))));}
  else if(name.startsWith('vkCreate')||name==='vkAllocateMemory'||name==='vkAllocateDescriptorSets'||name==='vkAllocateCommandBuffers'){
   handle+=16n;put64(args.at(-1),handle);if(name==='vkCreateBuffer')buffers.set(handle,read64(args[1]+24n));
  }else if(name==='vkWaitForFences'&&timeout)return 2n;
  else if(name==='vkQueueSubmit'&&overflow)native.write32(BigInt(g.__civNanoVGVulkan.buffers.bins.mapped+60*34*897*8*4),1n);
  else if(name==='vkAcquireNextImage2KHR')native.write32(args[2],0n);
  return 0n;
 }};
 g.CivNanoVGNative={create:()=>c};g.CivNanoVGModules.display.createDisplay=async()=>({display:{physical:'9',device:'10',queue:'11',images:['12','13'],swapchain:'14',queueFamily:0,imageCount:2},objects:[]});
 vm.runInContext(readModule('vulkan'),context);
 const makePacket=()=>vm.runInContext('(()=>{var d=new Uint32Array(64);d.set([1920,1080,0,0,16,16,16,32,128,0,60,34]);return {width:1920,height:1080,draws:0,triangles:0,generation:1,data:d};})()',context);
 return {g,c,calls,read64,read,makePacket,setTimeout:()=>{timeout=true;},setOverflow:()=>{overflow=true;},get overflow(){return overflow;}};
}
test('Vulkan adapter uses owned pipelines and ABI-correct image views, retaining display at close',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({});
 const views=f.calls.filter(c=>c.name==='vkCreateImageView');assert.equal(views.length,2);
 assert.equal(views[0].info.readBigUInt64LE(24),12n);assert.equal(views[0].info.readUInt32LE(32),1);assert.equal(views[0].info.readUInt32LE(36),37);assert.equal(views[0].info.readUInt32LE(56),1);
 renderer.render(f.makePacket());assert.equal(renderer.owner.presentations,1);assert.equal(renderer.owner.recomputations,1);
 const uploads=renderer.owner.uploadedBytes;renderer.render(f.makePacket());assert(renderer.owner.uploadedBytes-uploads<uploads,'same generation reuses uploaded atlas data');
 renderer.close();assert.equal(renderer.owner.state,'retained');assert.equal(renderer.owner.requiresRestart,true);assert(!f.calls.some(c=>c.name.startsWith('vkDestroy')),'unqualified presentation destruction is never attempted');
 await assert.rejects(()=>f.g.CivNanoVGVulkan.create({}),/Restart Civ VII/);
});
test('a native fence timeout quarantines owners and never publishes or frees their memory',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({}),before=f.calls.filter(c=>c.name==='vkQueuePresentKHR').length;f.setTimeout();
 assert.throws(()=>renderer.render(f.makePacket()),/vkWaitForFences returned 2/);assert.equal(renderer.owner.state,'quarantined');assert.equal(renderer.owner.presentations,0);assert.equal(f.calls.filter(c=>c.name==='vkQueuePresentKHR').length,before);renderer.close();assert.equal(renderer.owner.state,'quarantined');assert(!f.calls.some(c=>c.name.startsWith('vkDestroy')));
});
test('GPU bin overflow rejects the frame before presentation',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({});f.setOverflow();assert.throws(()=>renderer.render(f.makePacket()),/tile-list capacity/);assert.equal(renderer.owner.presentations,0);assert.equal(renderer.owner.recomputations,0);assert.equal(renderer.owner.state,'quarantined');assert(!f.calls.some(c=>c.name==='vkQueuePresentKHR'));
});
test('cached presentation reuses native records and never reruns compute or uploads geometry',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({});renderer.render(f.makePacket());const before=f.calls.length,recomputations=renderer.owner.recomputations,uploaded=renderer.owner.uploadedBytes;
 renderer.presentCached();assert.equal(renderer.owner.recomputations,recomputations);assert.equal(renderer.owner.uploadedBytes,uploaded);assert.deepEqual(f.calls.slice(before).map(c=>c.name),['vkAcquireNextImage2KHR','vkQueueSubmit','vkQueuePresentKHR','vkQueueWaitIdle']);
 const submit=f.calls.slice(before).find(c=>c.name==='vkQueueSubmit');assert.equal(submit.args[2],BigInt(renderer.owner.frameMemory+0x300));await renderer.close();
});
test('checked refresh controller receives this owned display and restores before close',async()=>{
 const f=setup(),sequence=[];f.g.CivNanoVGModules.refresh.createRefreshRate=(rpc,options)=>({cleanup:async()=>sequence.push('cleanup'),set:async rate=>{sequence.push(rate);return {ok:true};},read:async()=>({flags:2n}),measured:async()=>{sequence.push('measured');return 'raised';},close:async()=>sequence.push('restore')});
 const renderer=await f.g.CivNanoVGVulkan.create({});await assert.rejects(()=>renderer.setRefresh(120),/Render a valid UI/);renderer.render(f.makePacket());await assert.rejects(()=>renderer.setRefresh(90),/60 or 120/);assert.deepEqual(await renderer.setRefresh(120),{ok:true});assert.equal(f.g.__civNanoVGFiles['vulkan-display.json'].displayResources.swapchain,'14');assert.deepEqual(await renderer.refreshStatus(),{flags:2n});await assert.rejects(()=>renderer.confirmRefresh({frames:0,elapsedMs:1}),/Invalid refresh/);assert.equal(await renderer.confirmRefresh({frames:30,elapsedMs:250}),'raised');await renderer.close();assert.deepEqual(sequence,['cleanup',120,'measured','restore']);assert.equal(renderer.owner.state,'retained');
});

test('full redraw reruns raster once, retaining uploads and triangle bins until revision changes',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({}),packet=f.makePacket();packet.revision=1;renderer.render(packet);
 const uploaded=renderer.owner.uploadedBytes,before=f.calls.length;renderer.render(packet);
 assert.equal(renderer.owner.uploadedBytes,uploaded);assert.equal(renderer.owner.recomputations,2);assert.equal(renderer.owner.lastTiming.binsRebuilt,false);
 assert.equal(f.calls.slice(before).filter(c=>c.name==='vkWaitForFences').length,0);assert.equal(renderer.owner.lastTiming.combinedRasterPresent,true);
 packet.revision=2;renderer.render(packet);assert(renderer.owner.uploadedBytes>uploaded);assert.equal(renderer.owner.lastTiming.binsRebuilt,true);await renderer.close();
});
test('GPU scene slots restore compact geometry without reuploading it and evict the oldest slot',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({}),packets=[];
 for(let i=0;i<9;i++){
  const p=f.makePacket();p.revision=i+1;p.geometryId={};p.drawData=new Float32Array(32);p.triData=new Float32Array(16);p.draws=1;p.triangles=1;packets.push(p);
 }
 renderer.render(packets[0]);const input=renderer.owner.buffers.input.mapped;
 assert.equal(Buffer.from(f.read(input+16,4)).readUInt32LE(),16);
 assert.equal(Buffer.from(f.read(input+20,4)).readUInt32LE(),48);
 renderer.render(packets[1]);let uploaded=renderer.owner.uploadedBytes;renderer.render(packets[0]);
 assert.equal(renderer.owner.uploadedBytes-uploaded,64,'cached scene changes only the global header');assert.equal(renderer.owner.lastTiming.gpuSceneHit,true);
 assert.equal(Buffer.from(f.read(input+16,4)).readUInt32LE(),16,'switching scenes restores its GPU geometry address');
 for(let i=2;i<9;i++)renderer.render(packets[i]);
 renderer.render(packets[1]);assert.equal(renderer.owner.lastTiming.gpuSceneHit,false,'evicted geometry is uploaded again');await renderer.close();
});

test('a video surface receives completed GPU output without another UI swapchain presentation',async()=>{
 const f=setup(),renderer=await f.g.CivNanoVGVulkan.create({}),frames=[],lease=renderer.bindSurface(frame=>frames.push(frame)),packet=f.makePacket();packet.revision=1;
 assert.throws(()=>renderer.bindSurface(()=>{}),/unavailable/);renderer.render(packet);renderer.render(packet);
 assert.equal(frames.length,2);assert.equal(frames[0].pointer,renderer.owner.buffers.output.mapped);assert.equal(frames[0].bytes,1920*1080*4);
 assert.equal(f.calls.filter(c=>c.name==='vkQueuePresentKHR').length,0);assert.equal(f.calls.filter(c=>c.name==='vkWaitForFences').length,2,'both new and retained geometry complete before output is lent');
 lease.close();const next=renderer.bindSurface(frame=>frames.push(frame));lease.close();renderer.render(packet);assert.equal(frames.length,3,'an old lease cannot remove the new surface');next.close();renderer.render(packet);assert.equal(f.calls.filter(c=>c.name==='vkQueuePresentKHR').length,1);await renderer.close();
});
