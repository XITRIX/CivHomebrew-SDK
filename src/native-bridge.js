/* Shared checked SDK exports and external-buffer copies. GPL-3.0-or-later. */
(function(g){"use strict";
    var available=typeof sdk_base==="bigint"&&typeof call_rop==="function";
    function create(options){
        if(!available)throw Error("CivSwitch native bridge unavailable");
        var cache=options&&options.cache||{},mod=sdk_base+read32(sdk_base+4n);
        if(read32(mod)!==0x30444f4dn)throw Error("Unsupported SDK module");
        var dynamic=mod+BigInt.asIntN(32,read32(mod+4n)),tags={};
        for(var i=0;i<128;i++){
            var tag=Number(read64(dynamic+BigInt(i*16)));if(!tag)break;
            var v=read64(dynamic+BigInt(i*16+8));tags[tag]=v<sdk_base?sdk_base+v:v;
        }
        var table=tags[4],strings=tags[5],symbols=tags[6];
        if(!table||!strings||!symbols)throw Error("SDK export table unavailable");
        var buckets=Number(read32(table)),count=Number(read32(table+4n));
        if(buckets<1||buckets>1000000||count<1||count>1000000)throw Error("SDK export bounds rejected");
        function resolve(name){
            if(cache[name])return cache[name];
            var hash=0;
            for(var j=0;j<name.length;j++){
                hash=((hash<<4)+name.charCodeAt(j))>>>0;var high=hash&0xf0000000;
                if(high)hash^=high>>>24;hash=(hash&~high)>>>0;
            }
            var index=Number(read32(table+8n+BigInt((hash%buckets)*4)));
            for(var k=0;index&&k<count;k++){
                if(index>=count)throw Error("SDK symbol chain rejected");
                var sym=symbols+BigInt(index*24),p=strings+read32(sym),text="";
                for(var n=0;n<512;n++){var c=Number(read8(p+BigInt(n)));if(!c)break;text+=String.fromCharCode(c);}
                if(text===name){var offset=read64(sym+8n);if(offset)return cache[name]=sdk_base+offset;break;}
                index=Number(read32(table+8n+BigInt((buckets+index)*4)));
            }
            throw Error("Missing SDK export: "+name);
        }
        function call(name,args){return call_rop.apply(null,[resolve(name)].concat((args||[]).map(BigInt)));}
        return {resolveNativeSymbol:resolve,call:call};
    }
    var lastBuffer=null,lastAddress=0n;
    function heapAddress(heap){
        if(heap.byteOffset!==0||heap.byteLength!==heap.buffer.byteLength)throw Error("Expected complete heap");
        if(heap.buffer===lastBuffer)return lastAddress;
        var obj=addrof_compressed(heap),external=read64_compressed(obj+0x28n),base=read32_compressed(obj+0x30n);
        if(base!==0n||external<0x100000000n||external+BigInt(heap.length)>0x8000000000n)throw Error("Unsupported external buffer layout");
        for(var i=0;i<32;i++)if(Number(read8(external+BigInt(i)))!==heap[i])throw Error("External buffer verification failed");
        if(Number(read8(external+BigInt(heap.length-1)))!==heap[heap.length-1])throw Error("External buffer end verification failed");
        lastBuffer=heap.buffer;lastAddress=external;return external;
    }
    function toNative(heap,pointer,length,destination){
        if(!Number.isInteger(pointer)||!Number.isInteger(length)||pointer<0||length<0||pointer+length>heap.length)throw Error("Native heap range rejected");
        call_rop(memcpy_addr,destination,heapAddress(heap)+BigInt(pointer),BigInt(length));
    }
    function releaseHeap(){lastBuffer=null;lastAddress=0n;}

 g.CivSDKNative={available:available,create:create,toNative:toNative,heapAddress:heapAddress,releaseHeap:releaseHeap};
})(typeof window!=="undefined"?window:globalThis);
