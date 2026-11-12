const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readModule}=require('./library.cjs');
function fixture(current=null,pending=null){
 const events=new Map(),native=new Map();let starts=0,attaches=0,clears=0;
 function node(){return {style:{},children:[],setAttribute(){},appendChild(n){this.children.push(n);n.parentNode=this;},removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;},addEventListener(name,fn){this[name]=fn;},removeEventListener(name){delete this[name];}};}
 const document={createElement:node},root=node();root.ownerDocument=document;
 const g={document,CivSDKNative:{available:true},__civhomebrewCore:{},
  addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);},
  engine:{on(name,fn){native.set(name,fn);return {clear(){clears++;native.delete(name);}};}},
  CivAppsNativeUI:{api:1,sessions:{current,pending,start(){starts++;throw Error('Must not create a second owner');}}}};
 g.window=g;vm.runInContext(readModule('app'),vm.createContext(g));
 return {g,root,events,native,get starts(){return starts;},get clears(){return clears;},get attaches(){return attaches;},
  session:{renderer:{owner:{}},stats:{errors:[]},attach:async()=>{attaches++;return {close(){},update(){},invalidate(){}};}}};
}
test('Gameface resident shows a persistent Update Launcher blocker without creating graphics',async()=>{
 const f=fixture(),view=await f.g.CivSDKApp.mount(f.root);let done=false;view.lifetime.then(()=>done=true);await Promise.resolve();
 assert.equal(view.blocked,true);assert.equal(done,false);assert.equal(f.starts,0);
 assert.equal(f.root.children[0].children[0].textContent,'Update Launcher');
 f.native.get('InputAction')('cancel',1);assert.equal(f.root.children.length,1,'release does not dismiss');
 f.native.get('InputAction')('cancel',0);await view.lifetime;
 assert.equal(done,true);assert.equal(f.root.children.length,0);assert.equal(f.events.size,0);assert.equal(f.native.size,0);assert.equal(f.clears,1);
 await view.close();assert.equal(f.clears,1);
});
test('a session without a native renderer owner also blocks; DOM Back and external close release it',async()=>{
 for(const route of ['dom','close','click']){
  const f=fixture({renderer:{},stats:{errors:[]},attach(){throw Error('Must not attach Gameface');}}),view=await f.g.CivSDKApp.mount(f.root);
  assert.equal(view.blocked,true);
  if(route==='dom')f.events.get('navigate-input')({detail:{name:'cancel',status:0}});
  else if(route==='click')f.root.children[0].children[2].click();else await view.close();
  await view.lifetime;assert.equal(f.root.children.length,0);assert.equal(f.events.size,0);
 }
});
test('pending native initialization completes before deciding; a valid native session mounts normally',async()=>{
 const f=fixture();let resolve;f.g.CivAppsNativeUI.sessions.pending=new Promise(r=>resolve=r);
 const mounting=f.g.CivSDKApp.mount(f.root);await Promise.resolve();assert.equal(f.root.children.length,0);
 resolve(f.session);const view=await mounting;assert.equal(view.session,f.session);assert.equal(view.blocked,undefined);assert.equal(f.attaches,1);assert.equal(f.starts,0);
});
test('browser DOM previews do not display the console update blocker',async()=>{
 const f=fixture();f.g.CivSDKNative.available=false;
 assert.equal(await f.g.CivSDKApp.mount(f.root),null);assert.equal(f.root.children.length,0);assert.equal(f.starts,0);
});
