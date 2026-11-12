/* Foreground app view binding. The resident owns the session and display. */
(function(g){
 'use strict';
 async function mount(root,options){
  options=options||{};
  var ui=g.CivAppsNativeUI,native=options.native===undefined?g.CivSDKNative.available:!!options.native;
  if(!ui||ui.api!==1)throw Error('Load the matching CivHomebrew SDK native UI module');
  var session=ui.sessions.current||await ui.sessions.pending;
  if(!session&&!native&&!options.browser)return null;
  if(!session&&native&&g.__civhomebrewCore)throw Error('Update the native Launcher and restart Civ VII before starting this app');
  if(!session)session=await ui.sessions.start({browser:!native});
  if(session.stats.errors.length)throw Error('Native UI session is unavailable; restart Civ VII');
  var view=await session.attach(root,{log:options.log});
  return {session:session,update:view.update,invalidate:view.invalidate,close:view.close};
 }
 g.CivSDKApp={mount:mount};
})(typeof window!=='undefined'?window:globalThis);
