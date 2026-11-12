/* Guarded synchronous bulk copies for the inspected CivSwitch/V8 layout.
 * Adapted from Moonlight's verified native-io.js external-buffer path.
 */
(function(g){
    "use strict";
    function create(p){
        var bytes=new Uint8Array(65536),capacity=bytes.length;
        for(var i=0;i<32;i++)bytes[i]=(i*37+19)&255;
        bytes[capacity-1]=167;
        // This view owns a complete, fixed ArrayBuffer and remains alive in the
        // closure. Never use the loader's generic 64-bit compressed-base helper.
        var object=p.addrof(bytes),external=p.read64(object+0x28n),base=p.read32(object+0x30n);
        if(base!==0n||external<0x100000000n||external+BigInt(capacity)>0x8000000000n)throw Error("Native transfer buffer layout rejected.");
        for(var j=0;j<32;j++)if(Number(p.read8(external+BigInt(j)))!==bytes[j])throw Error("Native transfer buffer verification failed.");
        if(Number(p.read8(external+BigInt(capacity-1)))!==bytes[capacity-1])throw Error("Native transfer buffer end verification failed.");
        var stats={mode:"memcpy",readBytes:0,writtenBytes:0};
        function range(address,length){
            if(typeof address!=="bigint"||address<0x100000000n||!Number.isInteger(length)||length<0||length>capacity||address+BigInt(length)>0x8000000000n)throw Error("Native transfer range rejected.");
        }
        return {stats:stats,
            read:function(address,length){
                range(address,length);
                if(length)p.call(p.memcpy,external,address,BigInt(length));
                stats.readBytes+=length;
                // Bounded argument lists avoid a V8 stack overflow at 64 KiB.
                var parts=[];
                for(var i=0;i<length;i+=8192)parts.push(String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+8192,length))));
                return parts.join("");
            },
            write:function(address,text){
                if(typeof text!=="string")throw Error("Expected binary transfer string.");
                range(address,text.length);
                for(var i=0;i<text.length;i++){var byte=text.charCodeAt(i);if(byte>255)throw Error("Expected binary transfer bytes.");bytes[i]=byte;}
                if(text.length)p.call(p.memcpy,address,external,BigInt(text.length));
                stats.writtenBytes+=text.length;
            }
        };
    }
    g.CivSDKTransfer={create:create};
})(typeof window!=="undefined"?window:globalThis);
