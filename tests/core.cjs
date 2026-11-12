const {readModule}=require('./library.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
 const g={console,setTimeout,clearTimeout,atob,unescape,encodeURIComponent,performance};g.window=g;g.globalThis=g;
 const context=vm.createContext(g,{codeGeneration:{strings:true,wasm:false}});
 for(const name of ['nanovg','nanovg-assets','geometry'])vm.runInContext(readModule(name),context,{filename:name});
 vm.runInContext('WebAssembly=undefined;Worker=undefined;atob=undefined;btoa=undefined;',context);
 return g;
}
test('compiled factory is explicitly exported from a function-local direct eval',()=>{
 const g={console};g.window=g;const context=vm.createContext(g),source=readModule('nanovg');
 vm.runInContext('(function(){eval('+JSON.stringify(source)+');})();',context);
 assert.equal(typeof g.CivNanoVGFactory,'function','loader-local var must be exported to window in its own source');
});
test('actual wasm2js NanoVG: rounded borders, text atlas, retained geometry and disposal',async()=>{
 const g=load(),geometry=await g.CivNanoVGGeometry.create();
 const scene={width:1920,height:1080,commands:[
  {kind:'rect',rect:[10,20,210,100],radius:12,color:[.1,.2,.3,1],clip:[0,0,1920,1080]},
  {kind:'border',rect:[10,20,210,100],radius:12,lineWidth:3,color:[0,1,1,1],clip:[0,0,1920,1080]},
  {kind:'text',x:20,baseline:60,size:24,bold:0,text:'CivHomebrew AV 123',color:[1,1,1,1],clip:[0,0,1920,1080]}
 ]};
 const first=geometry.build(scene),saved=new Uint32Array(first.data);assert(first.draws>=3);assert(first.triangles>20);assert(geometry.textures.size>0);assert.equal(geometry.stats.geometryMisses,3);
 const second=geometry.build(scene);assert.equal(geometry.stats.geometryHits,3);assert.equal(geometry.stats.geometryMisses,0);assert.deepEqual(Buffer.from(saved.buffer),Buffer.from(second.data.buffer));assert(geometry.stats.preparedHit);assert.equal(first.generation,second.generation);
 assert(geometry.measure('AV',24,0)>0);assert(geometry.metrics(24,0)[0]>0);
 scene.commands[0].color=[1,0,0,1];const changed=geometry.build(scene);assert.equal(geometry.stats.geometryHits,2);assert.equal(geometry.stats.geometryMisses,1);assert.equal(changed.generation,first.generation,'shape changes reuse font atlas');assert.notDeepEqual(Buffer.from(saved.buffer),Buffer.from(changed.data.buffer));
 const floats=new Float32Array(changed.data.buffer);assert.equal(floats[changed.data[4]+4],1);assert.equal(floats[changed.data[4]+5],0);
 const border=changed.data[4]+32,tri=changed.data[5]+floats[border+8]*16;
 let positive=false,negative=false;for(let i=0;i<floats[border+9];i++){const at=tri+i*16;if(floats[at+12]!==0)continue;const area=(floats[at+4]-floats[at])*(floats[at+9]-floats[at+1])-(floats[at+5]-floats[at+1])*(floats[at+8]-floats[at]);positive||=area>0;negative||=area<0;}
 assert(positive&&negative,'NanoVG preserves the hole winding for rounded borders');
 geometry.close();assert.throws(()=>geometry.build(scene),/closed/);
});
test('actual NanoVG decodes the bundled controller PNG instead of drawing substitute glyphs',async()=>{
 const geometry=await load().CivNanoVGGeometry.create();
 const packet=geometry.build({width:1920,height:1080,commands:[{kind:'image',source:'assets/button-a.png',rect:[0,0,37.5,37.5],radius:0,alpha:1,clip:[0,0,1920,1080]}]});
 assert(packet.draws>0);assert([...geometry.textures.values()].some(t=>t.type===2&&t.bytes.some(v=>v>0)));geometry.close();
});
test('native retained packets keep immutable geometry and their own header across other scene builds',async()=>{
 const geometry=await load().CivNanoVGGeometry.create(),rect={kind:'rect',rect:[10,10,100,100],radius:4,color:[1,0,0,1],clip:[0,0,1920,1080]};
 const a={width:1920,height:1080,commands:[rect]},b={width:1920,height:1080,commands:[rect,{...rect,rect:[200,10,300,100]}]};
 const first=geometry.build(a,true),saved=Buffer.from(new Uint8Array(first.drawData.buffer));geometry.build(b,true);const again=geometry.build(a,true);
 assert.equal(again.geometryId,first.geometryId);assert.equal(again.draws,1);assert.equal(new DataView(again.header.buffer).getUint32(8,true),1);
 assert.deepEqual(Buffer.from(new Uint8Array(again.drawData.buffer)),saved);assert.equal(geometry.stats.preparedHit,true);geometry.close();
});
test('Gameface readiness rejects stale focus/display styles until the engine applies them',()=>{
 const g={};g.window=g;g.getComputedStyle=n=>n.computed;
 vm.runInContext(readModule('scene'),vm.createContext(g));
 const node=(style,computed,selected=false)=>({style,computed,hasAttribute:k=>k==='data-selected'&&selected});
 const old=node({display:'none',borderTopColor:'rgba(0,0,0,0)'},{display:'flex',borderTopColor:'rgba(0,239,207,1)'},true),next=node({display:'flex',borderTopColor:'rgba(0,239,207,1)'},{display:'none',borderTopColor:'rgba(0,0,0,0)'},true);
 const fixtureRoot=node({},{});fixtureRoot.querySelectorAll=()=>[old,next];assert.equal(g.CivNanoVGScene.ready(fixtureRoot),false);
 old.computed={...old.style};next.computed={...next.style};assert.equal(g.CivNanoVGScene.ready(fixtureRoot),true);
});
test('a pending Gameface layout is never retained under the new selection key',async()=>{
 let state='a',ready=true,snapshots=0;const drawn=[],rootNode={innerHTML:'',addEventListener(){},removeEventListener(){},querySelector(){return {getAttribute:()=>state};},__civNanoVGSceneKey:()=>state};
 const head={appendChild(n){n.parentNode=head;},removeChild(n){n.parentNode=null;}};
 const geometry={metrics(){},measure(){},build:scene=>({label:scene.commands[0].label}),close(){}};
 const renderer={render:p=>drawn.push(p.label),close(){}};
 const g={setTimeout,clearTimeout,innerWidth:1280,innerHeight:720,addEventListener(){},removeEventListener(){},CivNanoVGAssets:{},CivNanoVGGeometry:{create:async()=>geometry},CivNanoVGScene:{ready:()=>ready,snapshot(){snapshots++;return {commands:[{label:state}],warnings:[]};}},document:{head,createElement:()=>({}),getElementById:()=>null}};g.window=g;
 vm.runInContext(readModule('prototype'),vm.createContext(g));
 const ui=await g.CivNanoVGPrototype.attach(rootNode,{renderer});
 try{
  assert.deepEqual(drawn,['a']);state='b';ready=false;assert.equal(ui.update(),false);assert.equal(snapshots,1);assert.deepEqual(drawn,['a']);
  ready=true;assert.equal(ui.update(),true);assert.deepEqual(drawn,['a','b']);assert.equal(ui.scene.selectionId,'b');assert.equal(snapshots,2);
  state='a';ready=false;assert.equal(ui.update(),true,'a qualified warm state can render without waiting for CSS');assert.deepEqual(drawn,['a','b','a']);assert.equal(snapshots,2);
 }finally{await ui.close();}
});
test('monospace terminal lines retain geometry when rows move and preserve fractional cell advances',async()=>{
 const geometry=await load().CivNanoVGGeometry.create(),text={kind:'text',text:'cached terminal row iiii WWWW 123',x:12,baseline:40.5,size:21,font:2,bold:0,color:[1,1,1,1],clip:[12,12,1908,969]};
 const first=geometry.build({width:1920,height:1080,commands:[text]}),generation=first.generation,triangles=Buffer.from(first.triData.buffer);
 const shifted=geometry.build({width:1920,height:1080,commands:[{...text,baseline:66}]});
 assert.equal(geometry.stats.geometryMisses,0);assert.equal(geometry.stats.geometryHits,1);assert.equal(shifted.generation,generation);assert.deepEqual(Buffer.from(shifted.triData.buffer),triangles);
 assert.equal(shifted.drawData[31]-first.drawData[31],26);
 assert(Math.abs(geometry.measure('i'.repeat(100),21,2)-1260)<1);assert(Math.abs(geometry.measure('W'.repeat(100),21,2)-1260)<1);geometry.close();
});
test('text layout fits ellipsis before right/center alignment and allows one CSS pixel at the edge',()=>{
 const g={};g.window=g;vm.runInContext(readModule('scene'),vm.createContext(g));const scene=g.CivNanoVGScene,measure=s=>s.length*10;
 const right=scene.fitLine('abcdefghijk',20,100,'right',true,measure,1);assert.equal(right.text,'abcdefg…');assert.equal(right.x+measure(right.text),100);
 const center=scene.fitLine('abcdefghijk',20,100,'center',true,measure,1);assert.equal(center.x+measure(center.text)/2,60);
 assert.equal(scene.fitLine('abcdefgh',0,79.25,'right',true,measure,1).text,'abcdefgh');assert.notEqual(scene.fitLine('abcdefgh',0,78.5,'right',true,measure,1).text,'abcdefgh');
 assert.equal(scene.pixels('1.5rem',18,24),27);assert.equal(scene.pixels('2em',18,24),48);
 assert.deepEqual(Array.from(scene.wrapWords('abc defghijkl',50,measure,true)),['abc','defgh','ijkl']);
});
