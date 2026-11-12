/* Ownership and native image validation only; mocks do not qualify console IME. */
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readModule}=require('./library.cjs');
const source=readModule('keyboard');
const signature=source.match(/var READER='([a-f0-9]+)'/)[1];
const BYTES=1280*720*4,BASE=0x100000000n,READER=BASE+0x51f0c0n,STATE=BASE+0x5e83550n,MEMCPY=0x200000000n,IMAGE=0x300000000n;
function fixture(){
 const timers=new Map(),calls=[],errors=[],frames=[],leases=[],updates=[],checks=[],resets=[];let next=0,destination=null,mismatch=false,readerChanged=false,readError=null,presentError=null,heapError=null,closeError=null,redrawError=null;
 const data={source:IMAGE,expected:IMAGE,size:BigInt(BYTES),ready:1n};
 class Node{
  constructor(){this.style={};this.attributes=new Map();this.children=[];this.ownerDocument=document;}
  setAttribute(k,v){this.attributes.set(k,v);}getAttribute(k){return this.attributes.get(k);}removeAttribute(k){this.attributes.delete(k);}
  appendChild(node){node.parentNode=this;this.children.push(node);}
  removeChild(node){const i=this.children.indexOf(node);assert(i>=0);this.children.splice(i,1);node.parentNode=null;}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
 }
 const document={createElement:()=>new Node()},root=new Node();
 const native={checkMemory:(pointer,bytes,permissions)=>checks.push({pointer,bytes,permissions}),read64:pointer=>pointer===READER?(readerChanged?0n:0xf9000bf3a9be7bfdn):pointer===STATE+32n?data.expected:pointer===STATE+40n?data.size:assert.fail('unexpected read64'),read32:pointer=>pointer===STATE+48n?data.ready:assert.fail('unexpected read32')};
 const context={native,read(pointer,bytes){assert.equal(pointer,READER);assert.equal(bytes,signature.length/2);return Buffer.from(mismatch?'00'.repeat(bytes):signature,'hex');},heapAddress(bytes){if(heapError)throw heapError;destination=bytes;return 0x400000000n;},rawCall(pointer,args){calls.push({pointer,args});if(pointer===READER){if(readError)throw readError;return data.source;}assert.equal(pointer,MEMCPY);assert.equal(args[0],0x400000000n);assert.equal(args[1],IMAGE);assert.equal(args[2],BigInt(BYTES));destination[0]=23;destination[BYTES-1]=71;return args[0];}};
 const session={renderer:{owner:{context}},active:{root,ui:{resetLayoutCache(){resets.push(true);}}}},view={update(force){updates.push(force);if(redrawError)throw redrawError;},invalidate(){}};
 const g={main_base:BASE,memcpy_addr:MEMCPY,innerWidth:1920,innerHeight:1080,setTimeout(fn,delay){timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id),CivSDKFramebuffer:{create(options){assert.equal(options.width,1280);assert.equal(options.height,720);assert.equal(options.session,session);assert.equal(options.view,view);const entry={closed:0};leases.push(entry);return {present(bytes){if(presentError)throw presentError;assert.equal(bytes.length,BYTES);frames.push([bytes[0],bytes[BYTES-1]]);},close(){entry.closed++;if(closeError)throw closeError;}};}}};g.window=g;
 vm.runInContext(source,vm.createContext(g));
 function open(extra={}){return g.CivSDKKeyboard.open({session,view,root,error:e=>errors.push(e),...extra});}
 function tick(){const [id,item]=timers.entries().next().value||[];assert(item,'expected pending poll');timers.delete(id);item.fn();return item;}
 return {g,root,session,view,data,calls,errors,frames,leases,updates,checks,resets,timers,open,tick,setMismatch(){mismatch=true;},changeReader(){readerChanged=true;},setReaderError(e){readError=e;},setPresentError(e){presentError=e;},setHeapError(e){heapError=e;},setCloseError(e){closeError=e;},setRedrawError(e){redrawError=e;}};
}
test('keyboard leases are exclusive and stale close or polling callbacks cannot release a newer editor',()=>{
 const f=fixture(),first=f.open(),stale=f.timers.values().next().value.fn;
 assert.throws(()=>f.open(),/already active/);assert.equal(f.root.children.length,1);
 f.tick();assert.deepEqual(f.frames,[[23,71]]);assert.equal(first.stats.frames,1);assert.equal(f.root.children[0].style.display,'block');
 first.close();first.close();assert.equal(f.leases[0].closed,1);assert.equal(f.timers.size,0);assert.equal(f.root.children.length,0);
 const second=f.open();first.close();stale();assert.equal(f.root.children.length,1);assert.equal(f.timers.size,1);assert.throws(()=>f.open(),/already active/);second.close();
 assert.deepEqual(f.leases.map(l=>l.closed),[1,1]);assert.deepEqual(f.updates,[true,true]);
});
test('unsupported native readers and inactive views fail before reading images or creating a framebuffer',()=>{
 const f=fixture();f.setMismatch();assert.throws(()=>f.open(),/Unsupported Civ VII/);assert.equal(f.calls.length,0);assert.equal(f.leases.length,0);assert.equal(f.timers.size,0);assert.equal(f.root.children.length,0);
 const h=fixture();h.session.active={root:{}};assert.throws(()=>h.open(),/active app view/);assert.equal(h.calls.length,0);assert.equal(h.leases.length,0);
 assert.equal(h.g.CivSDKKeyboard.open({session:{renderer:{}},root:h.root,view:h.view}),null);
});
test('image validation rejects changed pointers, undersized/oversized buffers and inactive image state before memcpy',()=>{
 for(const change of [{expected:IMAGE+4n},{size:BigInt(BYTES-1)},{size:8388609n},{ready:0n}]){
  const f=fixture(),lease=f.open();Object.assign(f.data,change);f.tick();
  assert.equal(f.calls.length,1,'only the guarded reader was called');assert.equal(f.frames.length,0);assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/image bounds/);assert.equal(lease.stats.errors,1);assert.equal(f.leases[0].closed,1);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);
 }
});
test('polling waits for available images and stops before reading when another app takes the view',()=>{
 const f=fixture(),lease=f.open();f.data.source=0n;f.tick();assert.equal(lease.stats.polls,1);assert.equal(lease.stats.frames,0);assert.equal(f.calls.length,1);assert.equal(f.root.children[0].style.display,'none');assert.equal(f.timers.values().next().value.delay,33);
 f.session.active={root:{}};f.tick();assert.equal(f.calls.length,1);assert.equal(f.leases[0].closed,1);assert.equal(f.updates.length,0,'old app must not repaint the new view');assert.equal(f.timers.size,0);assert.equal(f.errors.length,0);
});
test('reader and framebuffer errors remove owned UI and timers and permit another keyboard',()=>{
 for(const kind of ['reader','present']){
  const f=fixture(),error=Error(kind+' failed');if(kind==='reader')f.setReaderError(error);else f.setPresentError(error);
  const lease=f.open();f.tick();assert.equal(f.errors[0],error);assert.equal(lease.stats.errors,1);assert.equal(f.leases[0].closed,1);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);f.open().close();
 }
});
test('framebuffer setup failure closes a created lease before abandoning its canvas',()=>{
 const f=fixture(),error=Error('external buffer unavailable');f.setHeapError(error);assert.throws(()=>f.open(),error);assert.equal(f.leases[0].closed,1);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);
});
test('setup failure removes the canvas and preserves its original error even if framebuffer cleanup fails',()=>{
 const f=fixture(),original=Error('external buffer unavailable');f.setHeapError(original);f.setCloseError(Error('framebuffer cleanup failed'));assert.throws(()=>f.open(),error=>error===original);assert.equal(f.leases[0].closed,1);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);
});
test('showing and closing invalidate retained layout; subsequent image updates reuse it and stats survive close',()=>{
 const f=fixture(),lease=f.open();assert.equal(f.g.CivSDKKeyboard.lastStats,lease.stats);f.tick();f.tick();assert.equal(f.resets.length,1);assert.equal(lease.stats.frames,2);lease.close();assert.equal(f.resets.length,2);assert.equal(f.g.CivSDKKeyboard.lastStats,lease.stats);assert.equal(lease.stats.polls,2);
});
test('a changed reader is rejected at poll time before any native call',()=>{
 const f=fixture(),lease=f.open();f.changeReader();f.tick();assert.equal(f.calls.length,0);assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/reader changed/);assert.equal(lease.stats.errors,1);assert.equal(f.timers.size,0);assert.equal(f.root.children.length,0);
});
test('a failed close or redraw still removes the canvas and reports exactly one cleanup error',()=>{
 for(const stage of ['close','redraw']){
  const f=fixture(),lease=f.open(),error=Error(stage+' failed');if(stage==='close')f.setCloseError(error);else f.setRedrawError(error);
  assert.doesNotThrow(()=>lease.close());assert.equal(f.errors[0],error);assert.equal(lease.stats.errors,1);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);lease.close();assert.equal(f.errors.length,1);assert.equal(f.leases[0].closed,1);
 }
});
test('poll failure preserves the original error when cleanup and redraw also fail',()=>{
 const f=fixture(),lease=f.open(),original=Error('read failed');f.setReaderError(original);f.setCloseError(Error('close failed'));f.setRedrawError(Error('redraw failed'));
 assert.doesNotThrow(()=>f.tick());assert.equal(f.errors[0],original);assert.equal(f.errors.length,1);assert.equal(lease.stats.lastError,'read failed');assert.equal(lease.stats.errors,1);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);lease.close();assert.equal(f.errors.length,1);
});
