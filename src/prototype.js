/* Shared DOM view adapter. DOM supplies layout and input; the session owns
 * the display and caches. Closing a view releases only its own lease. */
(function(g){
 'use strict';
 var enabled=false,current=null;
 function fontStyle(){var style=document.createElement('style');style.textContent='@font-face{font-family:CivNanoVG;src:url(data:font/ttf;base64,'+g.CivNanoVGAssets['Roboto-Regular.ttf']+')}@font-face{font-family:CivNanoVG;src:url(data:font/ttf;base64,'+g.CivNanoVGAssets['Roboto-Bold.ttf']+');font-weight:700}@font-face{font-family:CivNanoMono;src:url(data:font/ttf;base64,'+g.CivNanoVGAssets['SourceCodePro-Regular.ttf']+')}[data-civ-native-ui],[data-civ-native-ui] *{font-family:CivNanoVG,sans-serif!important}';document.head.appendChild(style);return style;}
 async function attach(root,o){
  o=o||{};var geometry=o.session?o.session.geometry:await g.CivNanoVGGeometry.create(),renderer=null,closed=false,timer=null,settle=null,observer=null,last='',removers=[],textCache=new WeakMap(),scenes=new Map();
  var stats={snapshots:0,frames:0,unchanged:0,snapshotMs:0,geometryMs:0,renderMs:0,error:'',warnings:[]};
  // Both layout and NanoVG use the exact same licensed font in the prototype.
  // Actual the layout engine data-URL font loading still needs console qualification.
  var style=o.session?null:fontStyle();
  try{
  if(document.fonts&&document.fonts.load)await document.fonts.load('24px CivNanoVG');
  if(o.session)renderer=o.session.renderer;
  else if(o.renderer)renderer=o.renderer;
  else if(o.browser){var canvas=document.createElement('canvas');canvas.id='nanovg-output';canvas.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:10000;pointer-events:none';document.body.appendChild(canvas);renderer=g.CivNanoVGWeb.create(canvas);}
  else renderer=await g.CivNanoVGVulkan.create(o);
  function update(){
   if(closed)return false;
   try{
    var begin=Date.now(),key=root.__civNanoVGSceneKey?root.__civNanoVGSceneKey():null;
    if(key===null){var markup=root.innerHTML;key=typeof markup==='string'?innerWidth+':'+innerHeight+':'+markup+':'+Array.from(root.querySelectorAll('input,textarea')).map(function(n){return n.value;}).join('\u0000'):null;}
    var scene=key!==null?scenes.get(key):null;
    stats.sceneHit=!!scene;
    if(!scene&&!g.CivNanoVGScene.ready(root)){stats.layoutDeferred=(stats.layoutDeferred||0)+1;if(timer===null)timer=setTimeout(tick,16);return false;}
    if(!scene){scene=g.CivNanoVGScene.snapshot(root,{width:1920,height:1080,metrics:geometry.metrics,measure:geometry.measure,textCache:textCache});stats.snapshots++;var selected=root.querySelector('[role="option"][data-selected="true"]');scene.selectionId=selected?selected.getAttribute('data-id'):null;if(key!==null){if(scenes.size>=64)scenes.delete(scenes.keys().next().value);scenes.set(key,scene);}}
    stats.snapshotMs=Date.now()-begin;stats.warnings=scene.warnings;
    var hash=scene.__nanoHash||(scene.__nanoHash=JSON.stringify(scene.commands));if(hash===last){stats.unchanged++;return false;}
    begin=Date.now();var packet=geometry.build(scene,!!renderer.owner);stats.geometryMs=Date.now()-begin;
    begin=Date.now();renderer.render(packet);stats.renderMs=Date.now()-begin;stats.frames++;stats.error='';last=hash;instance.scene=scene;instance.packet=packet;return true;
   }catch(e){var message=String(e.message);if(o.log&&message!==stats.error)o.log('NanoVG UI: '+message.slice(0,180));stats.error=message;throw e;}
  }
  function tick(){timer=null;try{update();}catch(e){if(o.error)o.error(e);}}
  function invalidate(){if(closed)return;if(timer===null)timer=setTimeout(tick,0);if(settle!==null)clearTimeout(settle);settle=setTimeout(function(){settle=null;if(timer===null)timer=setTimeout(tick,0);},100);}
  function reset(){scenes.clear();textCache=new WeakMap();last='';invalidate();}
  function listen(target,name,fn){target.addEventListener(name,fn,true);removers.push(function(){target.removeEventListener(name,fn,true);});}
  ['keydown','keyup','engine-input','navigate-input','resize'].forEach(function(name){listen(g,name,invalidate);});listen(root,'scroll',reset);listen(root,'load',reset);listen(g,'resize',reset);if(document.fonts&&document.fonts.addEventListener)listen(document.fonts,'loadingdone',reset);listen(root,'click',invalidate);listen(root,'input',invalidate);listen(root,'change',invalidate);
  if(typeof MutationObserver==='function'){observer=new MutationObserver(invalidate);observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});}
  var instance={geometry:geometry,renderer:renderer,stats:stats,update:update,invalidate:invalidate,resetLayoutCache:reset,scene:null,packet:null,
   close:async function(){if(closed)return;closed=true;if(timer!==null)clearTimeout(timer);if(settle!==null)clearTimeout(settle);if(observer)observer.disconnect();removers.forEach(function(r){r();});try{if(!o.session)await renderer.close();}finally{if(!o.session)geometry.close();scenes.clear();textCache=new WeakMap();if(style&&style.parentNode)style.parentNode.removeChild(style);var canvas=!o.session&&document.getElementById('nanovg-output');if(canvas&&canvas.parentNode)canvas.parentNode.removeChild(canvas);if(current===instance)current=null;}}};
  current=instance;update();return instance;
  }catch(e){
   if(current&&current.geometry===geometry)await current.close();
   else{if(!o.session)geometry.close();if(style&&style.parentNode)style.parentNode.removeChild(style);var canvas=!o.session&&document.getElementById('nanovg-output');if(canvas&&canvas.parentNode)canvas.parentNode.removeChild(canvas);}
   throw e;
  }
 }
 g.CivNanoVGPrototype={get enabled(){return enabled;},set enabled(v){enabled=!!v;},attach:attach,fontStyle:fontStyle,invalidate:function(){if(current)current.invalidate();},get current(){return current;}};
})(typeof window!=='undefined'?window:globalThis);
