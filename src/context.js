/* Civ VII 1.0.0 / Switch 2: checked local native context.
 * Module discovery and owned-stack ABI adapted from NS2-Doom (GPL-2.0-or-later).
 * No socket or PC RPC: the async plan interface executes entirely on console. */
(function(g){
 "use strict";
 function create(){
  if(!g.CivNanoVGStack)throw Error("Native stack helper missing");
  var stack=g.CivNanoVGStack.create({driver:true});
  var queryInfo=malloc(80),moduleCache=Object.create(null),allocations=new Map(),closed=false;
  var verified=new Set(),verifiedFunctions=new Map(),graphics=null,modInfo=null;
  var B=g.CivNanoVGBuffer;
  if(!queryInfo){stack.close();throw Error("Native query allocation failed");}
        function query(address){
            if(typeof address!=="bigint"||address<0n||address>=0x8000000000n)throw Error("Native address rejected");
            if(read32(sdk_base+0x168b10n)!==0xd40000c1n)throw Error("Native QueryMemory ABI changed");
            var rc=call_rop(sdk_base+0x168b0cn,queryInfo,queryInfo+64n,address);
            if(rc!==0n)throw Error("Native memory query failed");
            var r={base:read64(queryInfo),size:read64(queryInfo+8n),type:Number(read32(queryInfo+16n)),permissions:Number(read32(queryInfo+24n))};
            if(r.size<=0n||r.base>address||r.base+r.size<=address)throw Error("Native memory mapping rejected");return r;
        }
        function range(address,bytes,permissions){
            var end=address+BigInt(bytes),at=address;
            for(var i=0;i<16&&at<end;i++){
                var r=query(at);if((r.permissions&permissions)!==permissions)throw Error("Native module permissions rejected");
                at=r.base+r.size;
            }
            if(at<end)throw Error("Native mapped range exceeded");
        }
        function module(base){
            var key=String(base);if(moduleCache[key])return moduleCache[key];
            range(base,8,1);var offset=Number(read32(base+4n));
            if(offset<8||offset>0x10000000)throw Error("Native module header rejected");
            var mod=base+BigInt(offset);range(mod,28,1);
            if(read32(mod)!==0x30444f4dn)throw Error("Native MOD0 missing");
            var size=offset+Number(BigInt.asIntN(32,read32(mod+12n)));
            if(size<offset||size>0x10000000)throw Error("Native module size rejected");
            function relative(off,n){if(!Number.isSafeInteger(off)||off<0||off+n>size)throw Error("Native symbol outside module");var address=base+BigInt(off);range(address,n,1);return address;}
            var dynamic=offset+Number(BigInt.asIntN(32,read32(mod+4n))),tags={};
            for(var i=0;i<256;i++){var at=relative(dynamic+i*16,16),tag=Number(read64(at));if(!tag)break;tags[tag]=Number(read64(at+8n));}
            if(tags[11]!==24||!tags[10]||tags[10]>0x800000)throw Error("Native symbol metadata rejected");
            var hash=relative(tags[4],8),buckets=Number(read32(hash)),count=Number(read32(hash+4n));
            if(!buckets||buckets>200000||!count||count>200000)throw Error("Native symbol bounds rejected");
            relative(tags[4],8+(buckets+count)*4);
            return moduleCache[key]={base:base,size:size,codeSize:offset&~4095,hash:hash,buckets:buckets,count:count,
                symbols:relative(tags[6],count*24),strings:relative(tags[5],tags[10]),stringSize:tags[10],tags:tags,relative:relative};
        }
        function symbol(m,name,imported){
            var hash=0;
            for(var i=0;i<name.length;i++){hash=((hash<<4)+name.charCodeAt(i))>>>0;var high=hash&0xf0000000;if(high)hash^=high>>>24;hash=(hash&~high)>>>0;}
            var index=Number(read32(m.hash+8n+BigInt((hash%m.buckets)*4)));
            for(var n=0;index&&n<m.count;n++){
                if(index>=m.count)throw Error("Native symbol chain rejected");
                var s=m.symbols+BigInt(index*24),nameAt=Number(read32(s)),actual="";
                if(nameAt+name.length<m.stringSize)for(var j=0;j<=name.length;j++){var c=Number(read8(m.strings+BigInt(nameAt+j)));if(!c)break;actual+=String.fromCharCode(c);}
                if(actual===name){
                    if(imported){if(read16(s+6n)!==0n)throw Error("Expected imported graphics bootstrap");return index;}
                    var offset=Number(read64(s+8n)),bytes=Number(read64(s+16n));
                    if((Number(read8(s+4n))&15)!==2||read16(s+6n)===0n||offset<16||bytes<8||offset+bytes>m.codeSize)throw Error("Native export is not a defined function: "+name);
                    return m.relative(offset,Math.min(32,bytes));
                }
                index=Number(read32(m.hash+8n+BigInt((m.buckets+index)*4)));
            }
            throw Error("Native export missing: "+name);
        }
        function discover(){
            // Resolve the live MAIN import, which Switch 2 interposes. Resolving
            // the SDK export instead would select the old Switch 1 driver.
            var main=module(main_base),index=symbol(main,"nvnBootstrapLoader",true),found=[];
            for(var pair of [[23,2],[7,8]]){
                var off=main.tags[pair[0]],size=main.tags[pair[1]];if(!off||!size)continue;
                if(size%24||size>9600000)throw Error("Native relocation bounds rejected");
                var table=main.relative(off,size);
                for(var at=0;at<size;at+=24){var r=table+BigInt(at),info=read64(r+8n);if(Number(info>>32n)!==index||![1025,1026].includes(Number(info&0xffffffffn)))continue;found.push(read64(main.relative(Number(read64(r)),8)));}
                if(found.length)break;
            }
            if(found.length!==1||found[0]===0n)throw Error("Live graphics import is not unique");
            var region=query(found[0]);if(region.permissions!==5||region.type!==3)throw Error("Graphics driver executable mapping rejected");
            return module(region.base);
        }

  function heapAddress(bytes){
   if(!(bytes instanceof Uint8Array)||bytes.byteOffset!==0||bytes.byteLength!==bytes.buffer.byteLength)throw Error("Expected whole external byte buffer");
   var object=addrof_compressed(bytes),external=read64_compressed(object+0x28n),base=read32_compressed(object+0x30n);
   if(base!==0n||external<0x100000000n||external>=0x8000000000n)throw Error("External buffer ABI rejected");
   for(var i=0;i<Math.min(32,bytes.length);i++)if(Number(read8(external+BigInt(i)))!==bytes[i])throw Error("External buffer verification failed");
   return external;
  }
  function readMemory(pointer,length){
   pointer=BigInt(pointer);range(pointer,length,1);var out=B.alloc(length);
   if(length)stack.call(memcpy_addr,[heapAddress(out),pointer,BigInt(length)]);return out;
  }
  function writeMemory(pointer,bytes){
   pointer=BigInt(pointer);range(pointer,bytes.length,3);if(!bytes.length)return;
   var full=B.from(bytes);stack.call(memcpy_addr,[pointer,heapAddress(full),BigInt(full.length)]);
  }
  function verify(pointer,hex){
   pointer=BigInt(pointer);var expected=B.from(hex,"hex");range(pointer,expected.length,5);
   if(!readMemory(pointer,expected.length).equals(expected))throw Error("Native ABI signature mismatch at "+pointer.toString(16));
   verified.add("0x"+pointer.toString(16));verifiedFunctions.set("0x"+pointer.toString(16),hex);return pointer;
  }
  function nativeCall(pointer,...args){
   pointer=BigInt(pointer);var key="0x"+pointer.toString(16),hex=verifiedFunctions.get(key);
   if(!hex)throw Error("Unverified native call");
   if(readMemory(pointer,Math.min(hex.length/2,8)).toString("hex")!==hex.slice(0,16))throw Error("Native function changed");
   return stack.call(pointer,args.map(BigInt));
  }
  function allocate(bytes,options){
   var align=(options&&options.align)||0x1000;
   if(!Number.isSafeInteger(bytes)||bytes<1||bytes>0x14000000||!Number.isSafeInteger(align)||align<8||align>0x10000||(align&(align-1)))throw Error("Native allocation bounds rejected");
   if(bytes>0x8000000&&(!options||options.purpose!=="av1-workspace"))throw Error("Large allocation is reserved for AV1 workspace");
   var raw=malloc(bytes+align);if(!raw)throw Error("Native allocation failed");
   var pointer=(raw+BigInt(align-1))&-BigInt(align);allocations.set(Number(pointer),{raw:raw,bytes:bytes});return Number(pointer);
  }
  function release(pointer){var a=allocations.get(Number(pointer));if(!a)throw Error("Unowned native allocation");free(a.raw);allocations.delete(Number(pointer));}
  function resolve(name){
   if(!graphics)graphics=discover();
   var pointer=symbol(graphics,name,false);range(pointer,8,5);
   var table=g.CivNanoVGModules&&g.CivNanoVGModules.compatTable;
   var entry=table&&(table.functions[name]||table.unnamed[name]);
   if(!entry||pointer!==graphics.base+BigInt(entry.offset))throw Error("Unknown native function: "+name);
   verify(pointer,entry.hex);return Number(pointer);
  }

  function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw Error("Native integer bounds rejected");return value;}
  function address(value){var p=BigInt(value);if(p<0x1000n||p>=0x8000000000n)throw Error("Native pointer rejected");return p;}
  var native={address:address,integer:integer,argument:function(v){return BigInt.asUintN(64,BigInt(v));},
   checkMemory:range,verified:verified,call:nativeCall,read32:read32,read64:read64,write32:write32,write64:write64,
   readMemory:readMemory,writeMemory:writeMemory,fromHex:function(hex){return B.from(hex,"hex");},toHex:function(bytes){return B.from(bytes).toString("hex");},
   now:function(){return g.performance&&g.performance.now?g.performance.now():Date.now();},query:query};
  var rpc={a:{sdk:Number(sdk_base),session:"local-"+Date.now()},connected:true,verifiedFunctions:verifiedFunctions,
   allocate:async function(bytes,options){return allocate(bytes,options);},release:async function(p){release(p);},
   read:async function(p,n){return readMemory(p,n);},write:async function(p,b){writeMemory(p,b);},
   callAddress:async function(p,args){return {result:nativeCall(BigInt(p),...(args||[]).map(BigInt))};},
   callPlan:async function(plan){return g.CivNanoVGModules.callPlan.runCallPlan(native,plan);},
   request:async function(r){
    if(r.command==="module-probe"){
     if(r.name!=="nnCompat")throw Error("Unsupported native module");
     if(!graphics)graphics=discover();
     if(!modInfo)modInfo=g.CivNanoVGModules.compat.moduleTables(function(off,n){return readMemory(graphics.base+BigInt(off),n);},g.CivNanoVGModules.ring.nativeChecksum);
     return Object.assign({base:"0x"+graphics.base.toString(16)},modInfo);
    }
    if(r.command==="verify-function"){verify(r.address,r.hex);return {verified:true};}
    if(r.command==="verify-functions"){
     for(var entry of r.functions)verify(BigInt(r.base)+BigInt(entry.offset),entry.hex);return {verified:r.functions.length};
    }
    if(r.command==="call-plan")return rpc.callPlan(r);
    if(r.command==="refresh-rate"){
     var state=g.__civNanoVGRefreshState||(g.__civNanoVGRefreshState={});
     return g.CivNanoVGModules.refreshRecord.refreshRateCommand({state:state,runPlan:function(plan){return g.CivNanoVGModules.callPlan.runCallPlan(native,plan);}},r);
    }
    if(r.command==="read")return {hex:readMemory(r.address,r.length).toString("hex")};
    if(r.command==="batch")return {replies:await Promise.all(r.commands.map(rpc.request))};
    throw Error("Unsupported local native command: "+r.command);
   }};
  var context={rpc:rpc,native:native,resolve:resolve,allocate:allocate,release:release,
   read:readMemory,write:writeMemory,call:nativeCall,heapAddress:heapAddress,
   rawCall:function(p,args){return stack.call(BigInt(p),args.map(BigInt));},
   inspect:async function(){var info=await rpc.request({command:"module-probe",name:"nnCompat"});var required=["vkCreateViSurfaceNN","vkCreateSwapchainKHR","vkCmdBeginRendering","vkCreateGraphicsPipelines","_ZN2nn2vi5Layer4OpenEPKNS0_21LayerCreationSettingsEPNS0_7DisplayEPKc"];for(var name of required)resolve(name);return {module:info,functions:required.length,viewport:{width:g.innerWidth,height:g.innerHeight},stack:stack.stack};},
   findSymbols:function(pattern){
    if(!graphics)graphics=discover();var found=[];
    for(var i=0;i<graphics.count;i++){
     var s=graphics.symbols+BigInt(i*24),at=Number(read32(s));if(at>=graphics.stringSize)continue;
     var name="";for(var j=at;j<graphics.stringSize&&j<at+512;j++){var c=Number(read8(graphics.strings+BigInt(j)));if(!c)break;name+=String.fromCharCode(c);}
     if(!pattern.test(name))continue;
     var offset=Number(read64(s+8n)),size=Number(read64(s+16n));
     if(read16(s+6n)!==0n&&offset>0&&size>=4)found.push({name:name,offset:offset,size:size,hex:readMemory(graphics.base+BigInt(offset),Math.min(size,64)).toString("hex")});
     if(found.length>=128)break;
    }return found;
   },
   close:function(){if(closed)return;if(allocations.size)throw Error("Native allocations remain owned");free(queryInfo);queryInfo=0n;stack.close();closed=true;rpc.connected=false;}};
  rpc.context=context;return context;
 }
 g.CivNanoVGNative={create:create};
})(typeof window!=="undefined"?window:globalThis);
