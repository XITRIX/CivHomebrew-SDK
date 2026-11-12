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
 assert.throws(()=>vm.runInContext(bundle.replace('var version="1.0.0"','var version="2.0.0"'),context),/version mismatch/);
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
