const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {bundle,readModule}=require('./library.cjs');
function load(extra={}){
 const g={console,setTimeout,clearTimeout,...extra};g.window=g;
 const context=vm.createContext(g,{codeGeneration:{strings:true,wasm:false}});
 vm.runInContext(bundle,context);return {g,context};
}
test('independent applications reuse the exact same version without redefining factories or owners',()=>{
 const {g,context}=load(),library=g.CivAppsNativeUI,factory=g.CivNanoVGFactory;
 vm.runInContext(bundle,context);assert.equal(g.CivAppsNativeUI,library);assert.equal(g.CivNanoVGFactory,factory);
 assert.equal(library.version,require('../package.json').version);assert.equal(library.sessions,g.CivNanoVGSession);
 assert.throws(()=>vm.runInContext(bundle.replace('var version='+JSON.stringify(require('../package.json').version),'var version="2.0.0"'),context),/version mismatch/);
 assert.equal(g.CivAppsNativeUI,library);assert.equal(g.CivNanoVGFactory,factory);
 assert.throws(()=>load({CivNanoVGSession:{api:1}}),/restart Civ VII/);
});
test('geometry and fonts require no app globals or browser base64 APIs',async()=>{
 const {g}=load({WebAssembly:undefined,Worker:undefined,atob:undefined,btoa:undefined});
 const geometry=await g.CivAppsNativeUI.geometry.create();
 assert(geometry.measure('Shared CivApps renderer',24,0)>0);geometry.close();
});
test('percentage and unitless line heights preserve the same text spacing',()=>{
 const {g}=load(),height=g.CivAppsNativeUI.scene.lineHeight;
 for(const value of ['140%','1.4','22.4px'])assert(Math.abs(height(value,16,18)-22.4)<.001,value);
 assert.equal(height('normal',16,18),0);assert.equal(height('1.5rem',16,18),27);assert.equal(height('2em',16,18),32);
});
test('the generic session never discovers a Launcher or core; serialized leases preserve the owner',async()=>{
 let creates=0,closes=0;
 const renderer={close(){closes++;}},g={CivNanoVGGeometry:{create:async()=>{creates++;return {close(){}};}},CivNanoVGPrototype:{fontStyle:()=>({}),attach:async()=>({stats:{frames:1},close(){},update(){},invalidate(){}})},setInterval(){throw Error('Generic session must not monitor an app');}};
 Object.defineProperty(g,'__civhomebrewCore',{get(){throw Error('Library must not read the resident core');}});
 g.window=g;vm.runInContext(readModule('session'),vm.createContext(g));
 const session=await g.CivNanoVGSession.start({renderer});
 const [a,b]=await Promise.all([session.attach({id:'first'}),session.attach({id:'second'})]);
 await a.close();assert.equal(session.active.root.id,'second');await b.close();assert.equal(closes,0);
 assert.equal(creates,1);assert.equal(session.stats.terminalBinds,undefined);await session.close();assert.equal(closes,1);
});

test('only the resident bootstrap handoff may replace a core before graphics initialization',()=>{
 const fs=require('node:fs'),version=require('../package.json').version;
 const core=fs.readFileSync(__dirname+'/../dist/'+version+'/civhomebrew-sdk.js','utf8');
 const previous={api:1,version:'0.0.0'},g={CivHomebrewSDK:previous};g.window=g;const context=vm.createContext(g);
 assert.throws(()=>vm.runInContext(core,context),/version mismatch/);assert.equal(g.CivHomebrewSDK,previous);
 g.__civSDKBootstrapHandoff=true;vm.runInContext(core,context);assert.equal(g.CivHomebrewSDK.version,version);
 delete g.__civSDKBootstrapHandoff;vm.runInContext(bundle,context);g.__civSDKBootstrapHandoff=true;
 assert.throws(()=>vm.runInContext(core.replace('var version='+JSON.stringify(version),'var version="99.0.0"'),context),/version mismatch/);
});
test('framebuffer leases retain bounded image slots and stale close cannot release a newer lease',()=>{
 let images=0,updates=0,invalidates=0;const geometry={pixels:()=>({source:'pixels:'+(++images),update:()=>updates++})};
 const {g}=load(),attributes=new Map(),canvas={setAttribute:(k,v)=>attributes.set(k,v),getAttribute:k=>attributes.get(k),removeAttribute:k=>attributes.delete(k)},options={session:{geometry},canvas,width:2,height:2,view:{update(){},invalidate(){invalidates++;}}};
 const a=g.CivHomebrewSDK.framebuffer.create(options);assert.throws(()=>g.CivHomebrewSDK.framebuffer.create(options),/active lease/);a.present(new Uint8Array(16));a.close();
 const b=g.CivHomebrewSDK.framebuffer.create(options);a.close();assert.equal(images,1);assert(attributes.has('data-civ-pixels'));assert.throws(()=>a.present(new Uint8Array(16)),/closed/);b.close();
 const c=g.CivHomebrewSDK.framebuffer.create({...options,width:320,height:200});assert.equal(images,2);c.close();assert.equal(updates,1);assert.equal(invalidates,3);
});
