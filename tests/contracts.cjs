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
 assert.throws(()=>vm.runInContext(bundle.replace('var version='+JSON.stringify(require('../package.json').version),'var version="2.0.0"'),context),/Incompatible SDK/);
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
 const previous={name:'civhomebrew-sdk',api:1,version:'0.0.0'},g={CivHomebrewSDK:previous};g.window=g;const context=vm.createContext(g);
 assert.throws(()=>vm.runInContext(core,context),/Incompatible SDK/);assert.equal(g.CivHomebrewSDK,previous);
 g.__civSDKBootstrapHandoff=true;vm.runInContext(core,context);assert.equal(g.CivHomebrewSDK.version,version);
 delete g.__civSDKBootstrapHandoff;vm.runInContext(bundle,context);g.__civSDKBootstrapHandoff=true;
 assert.throws(()=>vm.runInContext(core.replace('var version='+JSON.stringify(version),'var version="99.0.0"'),context),/Incompatible SDK/);
});
test('framebuffer leases retain bounded image slots and stale close cannot release a newer lease',()=>{
 let images=0,updates=0,invalidates=0;const presentations=[];const geometry={pixels:()=>({source:'pixels:'+(++images),update:()=>updates++})};
 const {g}=load(),attributes=new Map(),canvas={setAttribute:(k,v)=>attributes.set(k,v),getAttribute:k=>attributes.get(k),removeAttribute:k=>attributes.delete(k)},options={session:{geometry},canvas,width:2,height:2,view:{update(force,options){presentations.push(options);},invalidate(){invalidates++;}}};
 const a=g.CivHomebrewSDK.framebuffer.create(options);assert.throws(()=>g.CivHomebrewSDK.framebuffer.create(options),/active lease/);a.present(new Uint8Array(16));a.close();
 const b=g.CivHomebrewSDK.framebuffer.create(options);a.close();assert.equal(images,1);assert(attributes.has('data-civ-pixels'));assert.throws(()=>a.present(new Uint8Array(16)),/closed/);b.close();
 const c=g.CivHomebrewSDK.framebuffer.create({...options,width:320,height:200,deferPresentWait:false});assert.equal(images,2);c.present(new Uint8Array(256000));c.close();assert.equal(updates,2);assert.equal(invalidates,3);assert.equal(presentations[0].deferPresentWait,true);assert.equal(presentations[1].deferPresentWait,false);
});

const version=require('../package.json').version;
function asVersion(source,value){return source.replace('var version='+JSON.stringify(version),'var version='+JSON.stringify(value));}
test('compatible patch and minor bundles reuse all resident factories, globals and owners in either direction',()=>{
 for(const resident of ['1.2.0','1.3.1','1.9.0']){
  const g={console,setTimeout,clearTimeout};g.window=g;const context=vm.createContext(g);
  vm.runInContext(asVersion(bundle,resident),context);
  const names=['CivAppsNativeUI','CivHomebrewSDK','CivNanoVGSession','CivNanoVGFactory','CivSDKApp','CivSDKFramebuffer','CivSDKController'];
  const identities=names.map(name=>g[name]),owner={device:42,swapchain:43};g.__civNanoVGVulkan=owner;
  // Any module evaluation is a failure: no compatible app may replace a module.
  const guarded=bundle.replace(';/* CIVAPPS_MODULE bytes */',';throw Error("evaluated resident modules");/* CIVAPPS_MODULE bytes */');
  vm.runInContext(guarded,context);
  names.forEach((name,i)=>assert.equal(g[name],identities[i],name));assert.equal(g.__civNanoVGVulkan,owner);
  const core=require('node:fs').readFileSync(__dirname+'/../dist/'+version+'/civhomebrew-sdk.js','utf8');
  vm.runInContext(core,context);assert.equal(g.CivHomebrewSDK,identities[1]);
 }
});
test('requirements reject API/major changes, missing features, invalid versions and unmet minimums',()=>{
 const {g}=load(),check=g.CivHomebrewSDK.compatibility.assert,ui=g.CivAppsNativeUI;
 for(const required of [
  {api:1,version:'1.0.0'}, {api:1,version:'1.99.0'},
  {api:1,minVersion:version}, {api:1,minVersion:'1.2.99',capabilities:['framebuffer','native-ui']}
 ])assert.equal(check(ui,required),ui);
 for(const required of [
  {api:2}, {api:'1'}, {api:1,version:'2.0.0'}, {api:1,minVersion:'2.0.0'},
  {api:1,minVersion:'1.99.0'}, {api:1,capabilities:['unknown-feature']},
  {api:1,capabilities:'framebuffer'}, {api:1,capabilities:[null]},
  ...['1.3','01.3.2','1.3.2-beta','1.3.2junk','9007199254740992.0.0',null].map(version=>({api:1,version}))
 ])assert.throws(()=>check(ui,required),/SDK|native Launcher/);
 assert.throws(()=>check({...ui,capabilities:undefined},{api:1,capabilities:['framebuffer']}),/capability/);
});
test('compatible guards retain session identity checks and reject an incompatible SDK before changing globals',()=>{
 const {g,context}=load(),ui=g.CivAppsNativeUI,factory=g.CivNanoVGFactory;
 g.CivNanoVGSession={api:1};assert.throws(()=>vm.runInContext(bundle,context),/Inconsistent.*owner/);
 assert.equal(g.CivAppsNativeUI,ui);assert.equal(g.CivNanoVGFactory,factory);
 g.CivNanoVGSession=ui.sessions;g.CivHomebrewSDK={name:'civhomebrew-sdk',api:2,version:version};
 assert.throws(()=>vm.runInContext(bundle,context),/Incompatible SDK/);assert.equal(g.CivAppsNativeUI,ui);
});
test('a compatible lightweight core can initialize a renderer without replacing its core services',()=>{
 const core=require('node:fs').readFileSync(__dirname+'/../dist/'+version+'/civhomebrew-sdk.js','utf8');
 const g={console};g.window=g;const context=vm.createContext(g);vm.runInContext(asVersion(core,'1.3.1'),context);
 const sdk=g.CivHomebrewSDK;vm.runInContext(bundle,context);vm.runInContext(bundle,context);
 assert.equal(g.CivHomebrewSDK,sdk);assert.equal(g.CivAppsNativeUI.version,version);
});

test('an exact-release bootstrap handoff preserves initialized core service identities',()=>{
 const core=require('node:fs').readFileSync(__dirname+'/../dist/'+version+'/civhomebrew-sdk.js','utf8');
 const g={console};g.window=g;const context=vm.createContext(g);vm.runInContext(core,context);
 const sdk=g.CivHomebrewSDK,controller=g.CivSDKController,framebuffer=g.CivSDKFramebuffer;
 g.__civSDKBootstrapHandoff=true;vm.runInContext(core,context);
 assert.equal(g.CivHomebrewSDK,sdk);assert.equal(g.CivSDKController,controller);assert.equal(g.CivSDKFramebuffer,framebuffer);
});
