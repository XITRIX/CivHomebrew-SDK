/* Civ VII 1.0.0: private stack for the existing loader's ROP algorithm.
 * No generated machine code, loader modification, or new gadget sequence.
 * Known source variants pass frame-equivalence and console memcpy checks. */
(function(g){
    "use strict";
    function create(options){
        // Vulkan driver shader compilation needs a larger downward reserve.
        // The caller algorithm and its exact-source guards remain unchanged.
        var driver=!!(options&&options.driver),allocationBytes=driver?0x240010:0x20010;
        var pivot=driver?0x210000:0x1c000;
        if(typeof call_rop!=="function"||typeof malloc!=="function"||typeof free!=="function"||
           typeof rop_chain_addr!=="bigint"||typeof fake_chi_full!=="bigint"||
           typeof fake_rop_return_full!=="bigint"||typeof rop_epilogue!=="bigint")
            throw Error("Private-stack loader bindings unavailable");
        var source=Function.prototype.toString.call(call_rop);
        var fingerprint=0x811c9dc5;
        for(var i=0;i<source.length;i++)fingerprint=Math.imul(fingerprint^source.charCodeAt(i),0x1000193)>>>0;
        // Exact known sources only: upstream function and the console-captured
        // minified equivalent, both checked by the132-write host oracle.
        var profiles={
            "14821:baa7de59":{references:54,dump:"dump_chain_area"},
            "5166:d6ebfa61":{references:51,dump:"u"}
        };
        var profile=profiles[source.length+":"+fingerprint.toString(16)];
        if(!profile||!/^function\s+call_rop\s*\(/.test(source)||source.indexOf("__moonlightPrivateRopChain")!==-1)
            throw Error("Unrecognized loader native-call implementation");
        var replacements=source.match(/\brop_chain_addr\b/g)||[];
        var chainOffsets=Array.from(source.matchAll(/\brop_chain_addr\s*\+\s*0x([0-9a-f]+)n/gi),function(m){return parseInt(m[1],16);});
        var dumpOffsets=Array.from(source.matchAll(new RegExp("\\b"+profile.dump+"\\s*\\+\\s*0x([0-9a-f]+)n","gi")),function(m){return parseInt(m[1],16);});
        if(replacements.length!==profile.references||chainOffsets.length!==50||dumpOffsets.length!==47||
           Math.max.apply(null,chainOffsets)!==0x3000||Math.max.apply(null,dumpOffsets)!==0x300)
            throw Error("Loader native-call frame shape changed");
        // All free bindings except the relocated chain remain in the original
        // inherited loader scope. Verify their presence before owning memory.
        var gadgets=[gadget1,gadget2,gadget3,gadget4,gadget5,gadget6,gadget7,gadget8,
            gadget9,gadget10,gadget11,gadget12,gadget13,gadget14,gadget15,gadget16,
            gadget17,gadget18,gadget19,gadget20,gadget21];
        if(gadgets.some(function(v){return typeof v!=="bigint";}))throw Error("Loader ROP gadget bindings unavailable");
        var allocation=malloc(allocationBytes),closed=false,running=false;
        if(!allocation)throw Error("Private native stack allocation failed");
        var aligned=(allocation+15n)&~15n;
        // Actual call entry SP is chain+0xa0; the existing dump chain begins at
        // chain+0x3000 and finishes below chain+0x3400.
        var __moonlightPrivateRopChain=aligned+BigInt(pivot),clone;
        var guards=[aligned,aligned+8n,aligned+16n,aligned+24n,
            aligned+BigInt(allocationBytes-48),aligned+BigInt(allocationBytes-40),aligned+BigInt(allocationBytes-32),aligned+BigInt(allocationBytes-24)];
        var marker=0x6d15ab537ac42e19n;
        try{
            for(var pointer of guards)write64(pointer,marker);
            clone=eval("("+source.replace(/\brop_chain_addr\b/g,"__moonlightPrivateRopChain")+")");
        }catch(error){free(allocation);throw error;}
        function check(){
            if(closed)throw Error("Private native stack is closed");
            for(var pointer of guards)if(read64(pointer)!==marker)throw Error("Private native stack canary changed; retain allocation");
        }
        return {
            call:function(address,args){
                check();if(running)throw Error("Private native stack reentry rejected");
                if(typeof address!=="bigint"||address===0n||!Array.isArray(args)||args.length>6||
                   args.some(function(v){return typeof v!=="bigint";}))throw Error("Private native call arguments rejected");
                running=true;
                try{var result=clone.apply(null,[address].concat(args));check();return result;}
                finally{running=false;}
            },
            check:check,
            close:function(){if(closed)return;if(running)throw Error("Private native call still active");check();closed=true;free(allocation);},
            stack:{allocationBytes:allocationBytes,downwardBytes:pivot,chainUpwardBytes:allocationBytes-pivot-16,sourceFNV1a32:fingerprint.toString(16)}
        };
    }
    g.CivNanoVGStack=g.CivSDKStack={create:create};
})(typeof window!=="undefined"?window:globalThis);
