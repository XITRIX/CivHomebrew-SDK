/* A bounded reusable RGBA texture on the shared NanoVG renderer. No second
 * display, external texture provider, owner teardown or codec dependency. */
(function(g){
 'use strict';
 var pools=new WeakMap();
 function create(options){
  var geometry=options.session.geometry,canvas=options.canvas,w=options.width,h=options.height;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>1920||h>1080)throw Error('Invalid SDK framebuffer dimensions');
  var pool=pools.get(geometry),size=w*h*4,key=w+'x'+h;
  if(!pool){pool={active:null,images:new Map(),bytes:0};pools.set(geometry,pool);}
  if(pool.active)throw Error('The shared framebuffer already has an active lease');
  var image=pool.images.get(key);
  if(!image){
   if(pool.images.size>=8||pool.bytes+size>8388608)throw Error('The retained SDK framebuffer budget is exhausted');
   image=geometry.pixels(w,h,new Uint8Array(size));pool.images.set(key,image);pool.bytes+=size;
  }
  var lease={},closed=false;pool.active=lease;
  canvas.setAttribute('data-civ-pixels',image.source);
  return {source:image.source,
   present:function(bytes){if(closed)throw Error('SDK framebuffer is closed');image.update(bytes);if(options.view)options.view.update(true,{deferPresentWait:options.deferPresentWait!==false});},
   close:function(){if(closed)return;closed=true;if(pool.active===lease)pool.active=null;if(canvas.getAttribute('data-civ-pixels')===image.source)canvas.removeAttribute('data-civ-pixels');if(options.view)options.view.invalidate();}
  };
 }
 g.CivSDKFramebuffer={create:create};
})(typeof window!=='undefined'?window:globalThis);
