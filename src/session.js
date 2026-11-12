/* Opt-in shared UI owner. Bind/unbind views without destroying the native
 * display, Vulkan objects, glyph atlas or geometry cache. No default activation. */
(function(g){
 'use strict';
 var current=null,pending=null;
 async function start(o){
  o=o||{};if(current||pending)throw Error('A NanoVG UI session is already active');
  pending=(async function(){
   var geometry=null,renderer=null,style=g.CivNanoVGPrototype.fontStyle(),canvas=null,active=null,tail=Promise.resolve(),binding=null,requested=null,closed=false;
   var stats={binds:0,errors:[],transitions:[]};
   function failed(e){if(stats.errors.length<16)stats.errors.push(String(e.message||e));}
   try{
    geometry=await g.CivNanoVGGeometry.create();
    if(o.renderer)renderer=o.renderer;
    else if(o.browser){canvas=document.createElement('canvas');canvas.id='nanovg-output';canvas.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:10000;pointer-events:none;background:#0c1220';document.body.appendChild(canvas);renderer=g.CivNanoVGWeb.create(canvas);}
    else renderer=await g.CivNanoVGVulkan.create(o);
    var session={api:1,geometry:geometry,renderer:renderer,stats:stats,
     attach:function(root,options){
      if(closed)return Promise.reject(Error('NanoVG UI session is closed'));
      if(active&&active.root===root)return Promise.resolve(active.lease);
      if(binding&&requested===root)return binding;
      requested=root;
      var task=tail.catch(function(){}).then(async function(){
       if(closed)throw Error('NanoVG UI session is closed');
       if(active)await active.lease.close();
       var ui=await g.CivNanoVGPrototype.attach(root,Object.assign({},options,{session:session,error:failed})),entry={root:root,ui:ui,lease:null};
       entry.lease={get stats(){return ui.stats;},get scene(){return ui.scene;},get packet(){return ui.packet;},update:ui.update,invalidate:ui.invalidate,
        close:async function(){await ui.close();if(active===entry)active=null;}};
       active=entry;stats.binds++;
       stats.transitions.push({root:root.id,time:Date.now(),presentations:renderer.owner?renderer.owner.presentations:ui.stats.frames});if(stats.transitions.length>64)stats.transitions.shift();return entry.lease;
      });
      binding=task;tail=task;task.then(function(){if(binding===task){binding=null;requested=null;}},function(e){if(binding===task){binding=null;requested=null;}failed(e);});return task;
     },get active(){return active;},idle:function(){return tail;},
     close:async function(){
      if(closed)return;closed=true;
      try{await tail.catch(function(){});if(active)await active.lease.close();await renderer.close();}
      finally{geometry.close();if(style.parentNode)style.parentNode.removeChild(style);if(canvas&&canvas.parentNode)canvas.parentNode.removeChild(canvas);if(current===session)current=null;}
     }};
    current=session;
    return session;
   }catch(e){if(renderer)try{await renderer.close();}catch(ignore){}if(geometry)geometry.close();if(style.parentNode)style.parentNode.removeChild(style);if(canvas&&canvas.parentNode)canvas.parentNode.removeChild(canvas);throw e;}
  })();
  try{return await pending;}finally{pending=null;}
 }
 g.CivNanoVGSession={api:1,start:start,get current(){return current;},get pending(){return pending;}};
})(typeof window!=='undefined'?window:globalThis);
