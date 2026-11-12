/* Foreground app view binding. The resident owns the session and display. */
(function(g){
 'use strict';
 // This DOM screen deliberately uses Gameface: it must work without a native owner.
 function blocker(root){
  var document=root.ownerDocument||g.document,removers=[],subscription=null,closed=false,finish;
  var lifetime=new Promise(function(resolve){finish=resolve;});
  var overlay=document.createElement('div');
  overlay.id='civ-sdk-update-launcher';
  overlay.setAttribute('role','alertdialog');
  overlay.setAttribute('aria-modal','true');
  overlay.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;box-sizing:border-box;background-color:#0c1220;color:#f4f7ff;font-family:Arial,sans-serif;z-index:10000';
  function text(tag,value,style){var node=document.createElement(tag);node.textContent=value;node.style.cssText=style;overlay.appendChild(node);return node;}
  text('h1','Update Launcher','display:block;font-size:36px;margin:0 0 24px 0');
  text('div','This app requires the Native renderer. Update Launcher, then restart Civ VII.','display:block;font-size:24px;max-width:760px;text-align:center;margin-bottom:32px');
  var back=text('button','B: Back','display:flex;align-items:center;justify-content:center;padding:16px 40px;background-color:#24344f;color:#f4f7ff;border:2px solid #94c6ff;border-radius:8px;font-size:24px');
  function close(){
   if(closed)return lifetime;closed=true;
   removers.forEach(function(remove){remove();});
   if(subscription&&typeof subscription.clear==='function')subscription.clear();
   else if(g.engine&&typeof g.engine.off==='function')g.engine.off('InputAction',action,owner);
   if(overlay.parentNode)overlay.parentNode.removeChild(overlay);
   finish();return lifetime;
  }
  function action(name,status){if((name==='cancel'||name==='back'||name==='sys-menu')&&Number(status)===0)close();}
  function listen(target,name,handler){target.addEventListener(name,handler,true);removers.push(function(){target.removeEventListener(name,handler,true);});}
  var owner={owner:'civ-sdk-update-launcher'};
  listen(back,'click',close);
  listen(g,'keydown',function(event){if(event.key==='Escape'||event.key==='BrowserBack'){event.preventDefault();event.stopPropagation();close();}});
  function domAction(event){var detail=event.detail||{};action(detail.name,detail.status===undefined?detail.inputStatus:detail.status);}
  listen(g,'navigate-input',domAction);listen(g,'engine-input',domAction);
  if(g.engine&&typeof g.engine.on==='function')subscription=g.engine.on('InputAction',action,owner);
  root.appendChild(overlay);
  return {blocked:true,session:null,lifetime:lifetime,close:close,update:function(){},invalidate:function(){}};
 }
 async function mount(root,options){
  options=options||{};
  var ui=g.CivAppsNativeUI,native=options.native===undefined?g.CivSDKNative.available:!!options.native;
  if(!ui||ui.api!==1)throw Error('Load the matching CivHomebrew SDK native UI module');
  var session=ui.sessions.current||await ui.sessions.pending;
  if(!session&&!native&&!options.browser)return null;
  if(native&&g.__civhomebrewCore&&(!session||!session.renderer||!session.renderer.owner))return blocker(root);
  if(!session)session=await ui.sessions.start({browser:!native});
  if(session.stats.errors.length)throw Error('Native UI session is unavailable; restart Civ VII');
  var view=await session.attach(root,{log:options.log});
  return {session:session,update:view.update,invalidate:view.invalidate,close:view.close};
 }
 g.CivSDKApp={mount:mount};
})(typeof window!=='undefined'?window:globalThis);
