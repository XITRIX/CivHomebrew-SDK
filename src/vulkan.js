/* Opt-in Switch 2 prototype. Owns its device/display; never borrows Civ VII's
 * queue. All native calls use the copied exact-build guards and <=6 arguments.
 * Retains presentation owners until process exit: return to the layout engine is unsolved. */
(function(g){
 'use strict';
 async function create(o){
  if(g.__civNanoVGVulkan)throw Error('Restart Civ VII before another native UI prototype');
  o=o||{};
  var c=g.CivNanoVGNative.create(),B=g.CivNanoVGBuffer,H=g.CivNanoVGModules.pipelineHelpers,resources=[],allocations=[],failed=false,closed=false,submitted=false,refreshController=null,functions=new Map();
  function now(){return g.performance&&g.performance.now?g.performance.now():Date.now();}
  var owner={state:'preparing',context:c,resources:resources,allocations:allocations};g.__civNanoVGVulkan=owner;
  async function mark(stage){owner.phase=stage;if(o.report)await o.report({stage:stage});}
  function alloc(n){var p=c.allocate(n);allocations.push(p);return p;}
  var scratch=alloc(0x20000),next=0;
  function bytes(b){var at=scratch+next;next=(next+b.length+15)&~15;if(next>0x20000)throw Error('NanoVG native scratch overflow');c.write(at,b);return at;}
  function struct(n,type,words,pointers){return bytes(H.struct(n,type,words,pointers));}
  function call(name,args,check){if(!functions.has(name))functions.set(name,BigInt(c.resolve(name)));var result=c.call(functions.get(name),...args.map(BigInt));if(check&&BigInt.asIntN(32,result)!==0n)throw Error(name+' returned '+BigInt.asIntN(32,result));return result;}
  function read64(at){return c.native.read64(BigInt(at));}
  function make(name,args,kind,out){call(name,args,true);var handle=read64(out);if(!handle)throw Error('Null '+kind);resources.push({kind:kind,handle:handle.toString()});return handle;}
  try{
   var module=await c.rpc.request({command:'module-probe',name:'nnCompat'});if(module.hash!==g.CivNanoVGModules.compatTable.module.hash)throw Error('Unsupported native UI graphics build');
   await mark('display-creating');
   var displayStage=await g.CivNanoVGModules.display.createDisplay(c.rpc,{resolve:c.resolve,size:{width:1920,height:1080}});
   owner.displayStage=displayStage;var d=displayStage.display,device=BigInt(d.device);owner.display=d;
   await mark('buffers-creating');
   var out=alloc(256),props=alloc(520);call('vkGetPhysicalDeviceMemoryProperties',[d.physical,props]);var properties=c.read(props,520);
   function buffer(label,size){
    next=0;var info=struct(56,12,{32:0x20},{24:size}),handle=make('vkCreateBuffer',[device,info,0,out],'buffer',out);
    call('vkGetBufferMemoryRequirements',[device,handle,out+32]);var choice=H.chooseMemory(properties,c.read(out+32,24),[6],'No coherent storage memory');
    var memory=make('vkAllocateMemory',[device,struct(32,5,{24:choice.type},{16:choice.size}),0,out],'memory',out);call('vkBindBufferMemory',[device,handle,memory,0],true);
    call('vkMapMemory2',[device,struct(48,1000271000,{}, {24:memory,40:choice.size}),out],true);var mapped=read64(out);if(!mapped)throw Error('Null mapping');return {handle:handle,memory:memory,mapped:Number(mapped),bytes:size,label:label};
   }
   var input=buffer('geometry/atlases',32*1024*1024),output=buffer('RGBA',1920*1080*4),cols=60,rows=34,binWords=cols*rows*897,bins=buffer('GPU tile lists',(binWords*8+1)*4);
   owner.buffers={input:input,output:output,bins:bins};
   await mark('descriptors-creating');
   next=0;
   var bindings=B.alloc(72);for(var i=0;i<3;i++){bindings.writeUInt32LE(i,i*24);bindings.writeUInt32LE(7,i*24+4);bindings.writeUInt32LE(1,i*24+8);bindings.writeUInt32LE(0x30,i*24+12);}
   var setLayout=make('vkCreateDescriptorSetLayout',[device,struct(32,32,{20:3},{24:bytes(bindings)}),0,out],'descriptorSetLayout',out);
   var sets=bytes(H.u32s(0,0));c.native.write64(BigInt(sets),setLayout);
   var layout=make('vkCreatePipelineLayout',[device,struct(48,30,{20:1},{24:sets}),0,out],'pipelineLayout',out);
   var pool=make('vkCreateDescriptorPool',[device,struct(40,33,{20:1,24:1},{32:bytes(H.u32s(7,3))}),0,out],'descriptorPool',out);
   var descriptor=make('vkAllocateDescriptorSets',[device,struct(40,34,{24:1},{16:pool,32:sets}),out],'descriptorSet',out);
   var writes=B.alloc(64*3);[input,output,bins].forEach(function(b,i){var start=i*64,info=bytes(B.concat([H.u32s(0,0,0,0),H.u32s(b.bytes,0)]));c.native.write64(BigInt(info),b.handle);var write=H.struct(64,35,{24:i,32:1,36:7},{16:descriptor,48:info});writes.set(write,start);});
   call('vkUpdateDescriptorSets',[device,3,bytes(writes),0,0]);
   await mark('shader-modules-creating');
   var modules={};for(var name of Object.keys(g.CivNanoVGShaders.spirv)){
    next=0;var code=B.from(g.CivNanoVGShaders.spirv[name],'hex'),staging=alloc(code.length);c.write(staging,code);
    modules[name]=make('vkCreateShaderModule',[device,struct(40,16,{}, {24:code.length,32:staging}),0,out],'shaderModule',out);
   }
   function compute(name){next=0;var entry=bytes(B.from('main\0')),info=H.struct(96,29,{88:0xffffffff},{72:layout});info.set(H.shaderStage(0x20,entry),24);info.writeBigUInt64LE(modules[name],48);return make('vkCreateComputePipelines',[device,0,1,bytes(info),0,out],'pipeline',out);}
   await mark('bin-pipeline-creating');var binPipeline=compute('bin.comp');await mark('raster-pipeline-creating');var rasterPipeline=compute('raster.comp');
   await mark('graphics-pipeline-creating');
   next=0;var entry=bytes(B.from('main\0')),stages=B.concat([H.shaderStage(1,entry),H.shaderStage(16,entry)]);stages.writeBigUInt64LE(modules['present.vert'],24);stages.writeBigUInt64LE(modules['present.frag'],72);
   var vertex=struct(48,19),assembly=struct(32,20,{20:3}),vp=B.alloc(24);[0,0,1920,1080,0,1].forEach(function(n,i){vp.writeFloatLE(n,i*4);});
   var viewport=struct(48,22,{20:1,32:1},{24:bytes(vp),40:bytes(H.u32s(0,0,1920,1080))}),rasterBytes=H.struct(64,23);rasterBytes.writeFloatLE(1,56);
   var raster=bytes(rasterBytes),multi=struct(48,24,{20:1}),blend=struct(56,26,{28:1},{32:bytes(H.u32s(0,0,0,0,0,0,0,15))});
   var rendering=struct(40,1000044002,{20:1},{24:bytes(H.u32s(37))});
   var graphics=make('vkCreateGraphicsPipelines',[device,0,1,struct(144,28,{20:2,136:0xffffffff},{8:rendering,24:bytes(stages),32:vertex,40:assembly,56:viewport,64:raster,72:multi,88:blend,104:layout}),0,out],'pipeline',out);
   var commandPool=make('vkCreateCommandPool',[device,struct(24,39,{20:d.queueFamily}),0,out],'commandPool',out),commands=[],views=[],semaphores=[];
   function barrier(command,srcStage,srcAccess,dstStage,dstAccess){next=0;var memory=struct(48,1000314000,{}, {16:srcStage,24:srcAccess,32:dstStage,40:dstAccess});call('vkCmdPipelineBarrier2',[command,struct(64,1000314003,{20:1},{24:memory})]);}
   function imageBarrier(command,image,oldLayout,newLayout,srcStage,srcAccess,dstStage,dstAccess){next=0;var b=struct(96,1000314002,{48:oldLayout,52:newLayout,56:0xffffffff,60:0xffffffff,72:1,80:1,88:1},{16:srcStage,24:srcAccess,32:dstStage,40:dstAccess,64:image});call('vkCmdPipelineBarrier2',[command,struct(64,1000314003,{48:1},{56:b})]);}
   var computeCommands=[];
   await mark('compute-commands-recording');
   // Separate compute from publication: an overflow/fence failure cannot publish
   // an incomplete UI. Host writes wait for the preceding owned queue work.
   for(var phase=0;phase<2;phase++){
    next=0;call('vkAllocateCommandBuffers',[device,struct(32,40,{24:0,28:1},{16:commandPool}),out],true);var command=read64(out);computeCommands.push(command);
    call('vkBeginCommandBuffer',[command,struct(32,42)],true);
    var descArray=bytes(B.alloc(8));c.native.write64(BigInt(descArray),descriptor);call('vkCmdBindDescriptorSets2',[command,struct(64,1000545003,{16:0x20,36:1},{24:layout,40:descArray})]);
    barrier(command,0x4000,0x4000,0x800,0x60);
    if(phase===0){call('vkCmdBindPipeline',[command,1,binPipeline]);call('vkCmdDispatch',[command,Math.ceil(cols*rows/64),1,1]);barrier(command,0x800,0x40,0x800,0x20);}
    call('vkCmdBindPipeline',[command,1,rasterPipeline]);call('vkCmdDispatch',[command,240,135,1]);barrier(command,0x800,0x40,0x4000|0x80|0x800,0x2000|0x20);call('vkEndCommandBuffer',[command],true);
   }
   await mark('presentation-commands-recording');
   for(var i=0;i<d.imageCount;i++){
    next=0;var image=BigInt(d.images[i]),view=make('vkCreateImageView',[device,struct(80,15,{32:1,36:37,56:1,64:1,72:1},{24:image}),0,out],'imageView',out);views.push(view);
    var semaphore=make('vkCreateSemaphore',[device,struct(24,9),0,out],'semaphore',out);semaphores.push(semaphore);
    call('vkAllocateCommandBuffers',[device,struct(32,40,{24:0,28:1},{16:commandPool}),out],true);var command=read64(out);commands.push(command);call('vkBeginCommandBuffer',[command,struct(32,42)],true);
    barrier(command,0x800,0x40,0x80,0x20);imageBarrier(command,image,0,2,0,0,0x400,0x100);
    var attachment=struct(72,1000044001,{24:2,44:1},{16:view});call('vkCmdBeginRendering',[command,struct(72,1000044000,{28:1920,32:1080,36:1,44:1},{48:attachment})]);
    call('vkCmdBindPipeline',[command,0,graphics]);var descArray=bytes(B.alloc(8));c.native.write64(BigInt(descArray),descriptor);call('vkCmdBindDescriptorSets2',[command,struct(64,1000545003,{16:0x10,36:1},{24:layout,40:descArray})]);call('vkCmdDraw',[command,3,1,0,0]);call('vkCmdEndRendering',[command]);imageBarrier(command,image,2,1000001002,0x400,0x100,0,0);call('vkEndCommandBuffer',[command],true);
   }
   next=0;var acquired=make('vkCreateSemaphore',[device,struct(24,9),0,out],'semaphore',out),fence=make('vkCreateFence',[device,struct(24,8),0,out],'fence',out);
   // Persistent submit/present records remove per-frame struct creation and
   // native memcpy. Only the selected command/semaphore and index change.
   var frameMemory=alloc(4096),frame=B.alloc(4096);
   function fw(at,value){frame.writeUInt32LE(value,at);}
   function fp(at,value){frame.writeBigUInt64LE(BigInt(value),at);}
   fw(0x100,1000060010);fp(0x110,d.swapchain);fp(0x118,1000000000n);fp(0x120,acquired);fw(0x130,1);
   fp(0x200,acquired);fw(0x220,0x400);fp(0x228,d.swapchain);
   fw(0x300,4);fw(0x310,1);fp(0x318,frameMemory+0x200);fp(0x320,frameMemory+0x220);fw(0x328,1);fp(0x330,frameMemory+0x208);fw(0x338,1);fp(0x340,frameMemory+0x210);
   fw(0x400,1000001001);fw(0x410,1);fp(0x418,frameMemory+0x210);fw(0x420,1);fp(0x428,frameMemory+0x228);fp(0x430,frameMemory);
   fw(0x500,4);fw(0x528,1);fp(0x530,frameMemory+0x600);fp(0x608,fence);
   frame.set(frame.subarray(0x300,0x348),0x800);fw(0x828,2);fp(0x830,frameMemory+0x680);fp(0x680,computeCommands[1]);c.write(frameMemory,frame);
   owner.frameMemory=frameMemory;
   var uploadedTextureLayout=null,uploadedGeneration=-1,uploadedPacket=null,uploadedRevision=-1,gpuScenes=new Map(),slotBytes=524288,slotCount=8,header=B.alloc(64),surface=null;
   function submit(command){
    c.native.write64(BigInt(frameMemory+0x600),command);
    call('vkQueueSubmit',[d.queue,1,frameMemory+0x500,fence],true);submitted=true;
    call('vkWaitForFences',[device,1,frameMemory+0x608,1,2000000000n],true);submitted=false;call('vkResetFences',[device,1,frameMemory+0x608],true);
   }
   function drain(){if(submitted)try{call('vkQueueWaitIdle',[d.queue],true);submitted=false;owner.inFlight=false;}catch(e){failed=true;owner.state='quarantined';owner.error=String(e.message);throw e;}}
   function present(rasterize,deferWait){
    drain();
    call('vkAcquireNextImage2KHR',[device,frameMemory+0x100,frameMemory],true);var index=Number(c.native.read32(BigInt(frameMemory)));if(index>=commands.length)throw Error('Native UI acquire index');
    c.native.write64(BigInt(frameMemory+0x208),commands[index]);c.native.write64(BigInt(frameMemory+0x210),semaphores[index]);
    if(rasterize)c.native.write64(BigInt(frameMemory+0x688),commands[index]);
    call('vkQueueSubmit',[d.queue,1,frameMemory+(rasterize?0x800:0x300),0],true);submitted=true;
    call('vkQueuePresentKHR',[d.queue,frameMemory+0x400],true);owner.inFlight=true;if(!deferWait)drain();
   }
   owner.state='ready';owner.presentations=0;owner.recomputations=0;owner.uploadedBytes=0;
   owner.refreshEvents=[];await mark('ready');
   return {owner:owner,render:function(packet,presentation){
    if(closed||failed)throw Error('Native UI session unavailable');if(packet.width!==1920||packet.height!==1080||packet.data.byteLength>input.bytes)throw Error('Native UI packet dimensions/bounds');
    try{
     var begun=now();drain();var gpuWaitMs=now()-begun,uploadStart=now();
     // Bulk geometry writes, with atlas upload only on a glyph/image change.
     // No JS byte-by-byte comparison or per-pixel loop on ordinary navigation.
     var raw=new Uint8Array(packet.data.buffer,packet.data.byteOffset,packet.data.byteLength);
     function upload(start,bytes){if(bytes){c.write(input.mapped+start,raw.subarray(start,start+bytes));owner.uploadedBytes+=bytes;}}
     var changed=uploadedPacket!==packet||uploadedRevision!==packet.revision||packet.revision===undefined,slot=null,cacheHit=false;
     if(changed&&packet.geometryId&&packet.drawData.byteLength+packet.triData.byteLength<=slotBytes){
      slot=gpuScenes.get(packet.geometryId);cacheHit=slot!==undefined;
      if(cacheHit){gpuScenes.delete(packet.geometryId);gpuScenes.set(packet.geometryId,slot);}
      else{slot=gpuScenes.size;if(slot>=slotCount){var oldest=gpuScenes.keys().next().value;slot=gpuScenes.get(oldest);gpuScenes.delete(oldest);}gpuScenes.set(packet.geometryId,slot);}
      var drawAt=64+slot*slotBytes,triAt=drawAt+packet.drawData.byteLength;
      if(!cacheHit){c.write(input.mapped+drawAt,new Uint8Array(packet.drawData.buffer));c.write(input.mapped+triAt,new Uint8Array(packet.triData.buffer));owner.uploadedBytes+=packet.drawData.byteLength+packet.triData.byteLength;}
      header.set(packet.header||raw.subarray(0,64));header.writeUInt32LE(drawAt/4,16);header.writeUInt32LE(triAt/4,20);header.writeUInt32LE(slot*binWords,36);header.writeUInt32LE(binWords*8,48);c.write(input.mapped,header);owner.uploadedBytes+=64;
     }else if(changed){gpuScenes.clear();header.set(raw.subarray(0,64));header.writeUInt32LE(0,36);header.writeUInt32LE(binWords*8,48);c.write(input.mapped,header);owner.uploadedBytes+=64;upload(packet.data[4]*4,packet.draws*128);upload(packet.data[5]*4,packet.triangles*64);}
     if(uploadedGeneration!==packet.generation){
      if(Number.isSafeInteger(packet.textureLayout)&&packet.textureLayout===uploadedTextureLayout&&packet.generation>=uploadedGeneration&&Array.isArray(packet.texturePatches)){
       if(packet.texturePatches.length>256)throw Error('Native UI texture patch count');
       for(var patch of packet.texturePatches){
        if(!Number.isSafeInteger(patch.revision)||patch.revision<0||patch.revision>packet.generation||!Number.isSafeInteger(patch.offset)||!Number.isSafeInteger(patch.bytes)||patch.offset<packet.data[7]*4||patch.bytes<1||patch.offset+patch.bytes>raw.length)throw Error('Native UI texture patch bounds');
        if(patch.revision>uploadedGeneration)upload(patch.offset,patch.bytes);
       }
      }else upload(packet.data[6]*4,raw.length-packet.data[6]*4);
      uploadedTextureLayout=packet.textureLayout;uploadedGeneration=packet.generation;
     }
     var uploadMs=now()-uploadStart,binStart=now(),needsBins=changed&&!cacheHit;
     if(needsBins){
      c.native.write32(BigInt(bins.mapped+binWords*8*4),0n);submit(computeCommands[0]);
      if(c.native.read32(BigInt(bins.mapped+binWords*8*4))!==0n)throw Error('Native UI GPU tile-list capacity exceeded');
     }
     // A child video surface shares this device/swapchain. Complete UI compute
     // before lending its mapped RGBA result; no second display or JS pixel copy.
     if(surface&&!needsBins)submit(computeCommands[1]);
     var computeMs=now()-binStart;uploadedPacket=packet;uploadedRevision=packet.revision;owner.recomputations++;var presentStart=now();
     if(surface)surface.present({pointer:output.mapped,bytes:output.bytes,width:1920,height:1080});else present(!needsBins,!!(presentation&&presentation.deferPresentWait));owner.presentations++;
     owner.lastTiming={gpuWaitMs:gpuWaitMs,deferredWait:!!owner.inFlight,uploadMs:uploadMs,computeFenceMs:computeMs,binsRebuilt:needsBins,gpuSceneHit:cacheHit,combinedRasterPresent:!needsBins,rasterPresentMs:now()-presentStart,totalMs:now()-begun};
    }catch(e){failed=true;owner.state='quarantined';owner.error=String(e.message);throw e;}
   },bindSurface:function(publish){
    if(closed||failed||surface||typeof publish!=='function')throw Error('Native UI surface is unavailable');drain();
    var entry={present:publish};surface=entry;
    return {close:function(){if(surface===entry)surface=null;}};
   },presentCached:function(){if(closed||failed||surface||!owner.recomputations)throw Error('Native UI cached presentation unavailable');try{var t=now();present();owner.presentations++;return now()-t;}catch(e){failed=true;owner.state='quarantined';throw e;}},
   setRefresh:async function(rate){
    if(closed||failed||!owner.recomputations)throw Error('Render a valid UI before changing refresh');drain();if(rate!==60&&rate!==120)throw Error('Native UI refresh must be 60 or 120 Hz');
    if(!refreshController){g.__civNanoVGFiles={'compatibility-module.json':module,'vulkan-display.json':{displayResources:d}};refreshController=g.CivNanoVGModules.refresh.createRefreshRate(c.rpc,{directory:'local',present:async function(){for(var i=0;i<4;i++)present();return 4;},log:function(event){if(owner.refreshEvents.length<48)owner.refreshEvents.push(event);}});await refreshController.cleanup();}
    var result=await refreshController.set(rate);owner.requestedRefresh=rate;owner.refreshResult=result;return result;
   },refreshStatus:function(){return refreshController?refreshController.read():Promise.resolve(null);},
   confirmRefresh:async function(measurement){
    if(closed||failed||!refreshController)throw Error('No active native UI refresh request');drain();
    if(!measurement||!Number.isInteger(measurement.frames)||measurement.frames<1||measurement.frames>240||!Number.isFinite(measurement.elapsedMs)||measurement.elapsedMs<=0)throw Error('Invalid refresh measurement');
    var state=await refreshController.measured(measurement);owner.refreshState=state;return state;
   },
   sample:function(points){
    if(closed||failed||!owner.recomputations)throw Error('Native UI sample unavailable');drain();
    if(!Array.isArray(points)||points.length>64)throw Error('Native UI sample bound');
    return points.map(function(p){if(!Array.isArray(p)||p.length!==2||!Number.isInteger(p[0])||!Number.isInteger(p[1])||p[0]<0||p[0]>=1920||p[1]<0||p[1]>=1080)throw Error('Native UI sample coordinate');var v=Number(c.native.read32(BigInt(output.mapped+(p[1]*1920+p[0])*4)));return [v&255,(v>>>8)&255,(v>>>16)&255,v>>>24];});
   },read:function(){if(closed||failed)throw Error('Native UI readback unavailable');drain();return c.read(output.mapped,output.bytes);},
   close:async function(){if(closed)return;closed=true;try{if(!failed){drain();if(refreshController)await refreshController.close();call('vkQueueWaitIdle',[d.queue],true);owner.state='retained';}}finally{owner.requiresRestart=true;}}};
  }catch(e){owner.state='quarantined';owner.error=String(e.message);owner.requiresRestart=true;throw e;}
 }
 g.CivNanoVGVulkan={create:create};
})(typeof window!=='undefined'?window:globalThis);
