/* Structural host oracle only: no machine instructions are executed. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const original=fs.readFileSync(__dirname+'/fixtures/call-rop-original.js','utf8').trimEnd();
const minified=fs.readFileSync(__dirname+'/fixtures/call-rop-console.js','utf8').trimEnd();
const adapter=fs.readFileSync(__dirname+'/../dist/'+require('../package.json').version+'/civhomebrew-sdk.js','utf8');
const oldChain=0x900000000n,firstAllocation=0xa00000000n;
const target=0x180700000n,args=[1n,2n,3n,4n,5n,6n];
function normalize(rows,chain){return rows.map(row=>row.map(v=>v>=chain-16n&&v<chain+0x4000n?'chain'+(v-chain).toString(16):v.toString(16)));}
let expected=null;
for(const [variant,source] of [['upstream',original],['console-minified',minified]]){
const memory=new Map(),writes=[],freed=[];
let nextAllocation=firstAllocation;
const box={console,rop_chain_addr:oldChain,fake_chi_full:0x800000000n,
    fake_rop_return_full:0x800100000n,rop_epilogue:0x180001000n,
    write64:(p,v)=>{memory.set(p,v);writes.push([p,v]);},read64:p=>memory.get(p)??0x700000000n,
    malloc:()=>{const p=nextAllocation;nextAllocation+=0x40000n;return p;},free:p=>freed.push(p),v8Version(){}};
for(let i=1;i<=21;i++)box['gadget'+i]=0x180010000n+BigInt(i*16);
box.window=box;vm.createContext(box);vm.runInContext(source,box);
box.call_rop(target,...args);const baseline=writes.slice();writes.length=0;memory.clear();
if(!expected)expected=normalize(baseline,oldChain);
assert.deepEqual(normalize(baseline,oldChain),expected,'captured console and upstream functions emit identical frames');
vm.runInContext(adapter,box);
const wrapper=vm.runInContext('CivHomebrewSDK.stack.create()',box);writes.length=0;
const privateChain=firstAllocation+0x1c000n;
assert.equal(wrapper.call(target,args),0x700000000n);
assert.deepEqual(normalize(writes,privateChain),normalize(baseline,oldChain),'all frame writes match original algorithm after chain relocation');
assert(writes.every(([p])=>p>=privateChain&&p<privateChain+0x3400n||p>=box.fake_chi_full&&p<box.fake_chi_full+0xd00n));
assert.throws(()=>wrapper.call(target,[1]),/arguments/);
assert.throws(()=>wrapper.call(target,Array(7).fill(1n)),/arguments/);
wrapper.close();wrapper.close();assert.deepEqual(freed,[firstAllocation]);
assert.throws(()=>wrapper.call(target,args),/closed/);
const retained=vm.runInContext('CivHomebrewSDK.stack.create()',box);memory.set(firstAllocation+0x40000n,0n);
assert.throws(()=>retained.check(),/canary/);assert.throws(()=>retained.close(),/canary/);
assert.equal(freed.length,1,'uncertain private stack retained');
vm.runInContext(source.replace('0x60n','0x61n'),box);
assert.throws(()=>vm.runInContext('CivHomebrewSDK.stack.create()',box),/Unrecognized/,'same-length modified source is rejected');
console.log(JSON.stringify({check:'private-stack frame-equivalence oracle',variant,writes:baseline.length,
    loaderCallRopSha256:crypto.createHash('sha256').update(source).digest('hex'),
    limitation:'does not execute ROP, prove native stack depth, or establish console safety'}));
}
