const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname+'/../dist/'+require('../package.json').version+'/civhomebrew-sdk.js','utf8'),context);
context.PayloadNativeBuffer=context.CivHomebrewSDK.transfer;
function fixture(options={}){
 const backing=0x200000000n,native=0x300000000n,memory=new Uint8Array(65538),copies=[];let bytes;
 const p={memcpy:123n,addrof:view=>{bytes=view;return 0x200n;},
  read64:address=>{assert.equal(address,0x228n);return options.pointer??backing;},
  read32:address=>{assert.equal(address,0x230n);return options.base??0n;},
  read8:address=>options.corrupt===address-backing?-1:bytes[Number(address-backing)],
  call:(fn,destination,source,length)=>{
   assert.equal(fn,123n);copies.push({destination,source,length});
   const lengthValue=Number(length);
   if(destination===backing)bytes.set(memory.subarray(Number(source-native),Number(source-native)+lengthValue));
   else {assert.equal(source,backing);memory.set(bytes.subarray(0,lengthValue),Number(destination-native));}
  }};
 return {p,native,memory,copies};
}
test('bulk read/write round-trips exact binary bytes and bounded chunk sizes',()=>{
 const f=fixture(),buffer=context.PayloadNativeBuffer.create(f.p);
 for(const n of [0,1,8191,8192,16384,65536]){
  const text=Array.from({length:n},(_,i)=>String.fromCharCode((i*31+129)&255)).join('');
  f.memory.fill(42);buffer.write(f.native+1n,text);
  assert.equal(f.memory[0],42);assert.equal(f.memory[n+1],42);
  assert.equal(buffer.read(f.native+1n,n),text);
 }
 assert.equal(f.copies.length,10,'one memcpy per nonempty read/write, never per byte');
 assert.equal(buffer.stats.readBytes,buffer.stats.writtenBytes);
});
test('rejects incompatible layout or mismatched backing bytes before memcpy',()=>{
 for(const options of [{base:1n},{base:0x100000000n},{pointer:0xffn},{pointer:0x8000000000n},{corrupt:0n},{corrupt:65535n}]){
  const f=fixture(options);assert.throws(()=>context.PayloadNativeBuffer.create(f.p),/rejected|verification/);assert.equal(f.copies.length,0);
 }
});
test('rejects invalid native ranges, lengths and nonbinary strings before memcpy',()=>{
 const f=fixture(),buffer=context.PayloadNativeBuffer.create(f.p);
 for(const [address,length] of [[0n,1],[123,1],[f.native,-1],[f.native,1.5],[f.native,65537],[0x7fffffffffn,2]])assert.throws(()=>buffer.read(address,length),/range/);
 assert.throws(()=>buffer.write(f.native,'雪'),/bytes/);
 assert.throws(()=>buffer.write(f.native,new Uint8Array(1)),/string/);
 assert.equal(f.copies.length,0);
});
