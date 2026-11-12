/* Civ VII 1.0.0 / Switch 2 inline IME image on the shared native UI.
 * The game owns the keyboard, callbacks and image buffer. We borrow its image
 * synchronously and retain only an ordinary SDK framebuffer texture. */
(function(g){
 'use strict';
 var active=null,lastStats=null;
 var READER_OFFSET=0x51f0c0,STATE_OFFSET=0x5e83550,WIDTH=1280,HEIGHT=720,BYTES=WIDTH*HEIGHT*4;
 var READER='fd7bbea9f30b00f9fd03009128cb029008c11591130140f9081140b97f0200f10019417aa0000054e0031faaf30b40f9fd7bc2a8c0035fd620cb029000401591021440f9e10313aa0e3cbd941f00007260129f9af30b40f9fd7bc2a8c0035fd6';
 function open(options){
  if(active)throw Error('A native keyboard overlay is already active');
  var session=options.session,view=options.view,root=options.root,renderer=session&&session.renderer,c=renderer&&renderer.owner&&renderer.owner.context;
  if(!c)return null;
  if(!view||!root||!session.active||session.active.root!==root)throw Error('Native keyboard requires the active app view');
  var reader=main_base+BigInt(READER_OFFSET),state=main_base+BigInt(STATE_OFFSET);
  if(c.read(reader,READER.length/2).toString('hex')!==READER)throw Error('Unsupported Civ VII native keyboard build');
  c.native.checkMemory(state,64,1);
  var canvas=root.ownerDocument.createElement('canvas');
  canvas.id='civ-sdk-native-keyboard';canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'fixed',left:'0',top:'0',width:g.innerWidth+'px',height:g.innerHeight+'px',display:'none',zIndex:'2147483647',pointerEvents:'none'});
  root.appendChild(canvas);
  var framebuffer=null,timer=null,closed=false,shown=false,pixels=new Uint8Array(BYTES),destination=null,lease,stats={polls:0,frames:0,errors:0,lastReadMs:0};
  try{framebuffer=g.CivSDKFramebuffer.create({session:session,canvas:canvas,view:view,width:WIDTH,height:HEIGHT});destination=c.heapAddress(pixels);}
  catch(error){try{if(framebuffer)framebuffer.close();}catch(_){}finally{if(canvas.parentNode)canvas.parentNode.removeChild(canvas);}throw error;}
  function cleanup(){
   if(closed)return null;closed=true;if(timer!==null)g.clearTimeout(timer);timer=null;
   if(active===lease)active=null;
   var error=null;
   try{framebuffer.close();}catch(e){error=e;}
   finally{if(canvas.parentNode)canvas.parentNode.removeChild(canvas);}
   // Release the canvas even when a failed renderer cannot redraw the view.
   if(session.active&&session.active.root===root){
    try{if(session.active.ui&&session.active.ui.resetLayoutCache)session.active.ui.resetLayoutCache();view.update(true);}catch(e){if(!error)error=e;}
   }
   return error;
  }
  function close(){var error=cleanup();if(error){stats.errors++;stats.lastError=String(error.message||error);if(options.error)options.error(error);}}
  function poll(){
   timer=null;if(closed)return;
   try{
    if(!session.active||session.active.root!==root){close();return;}
    stats.polls++;
    // This exact game wrapper checks state and buffer ownership before calling
    // InlineKeyboard::GetImage, and returns zero when no new image is available.
    if(c.native.read64(reader)!==0xf9000bf3a9be7bfdn)throw Error('Native keyboard reader changed');
    var started=Date.now(),source=c.rawCall(reader,[]);
    if(source!==0n){
     var expected=c.native.read64(state+32n),size=c.native.read64(state+40n);
     if(source!==expected||size<BigInt(BYTES)||size>8388608n||c.native.read32(state+48n)!==1n)throw Error('Native keyboard image bounds changed');
     c.native.checkMemory(source,BYTES,1);
     c.rawCall(memcpy_addr,[destination,source,BigInt(BYTES)]);
     canvas.style.width=g.innerWidth+'px';canvas.style.height=g.innerHeight+'px';canvas.style.display='block';
     if(!shown){shown=true;if(session.active.ui&&session.active.ui.resetLayoutCache)session.active.ui.resetLayoutCache();}
     framebuffer.present(pixels);stats.frames++;
    }
    stats.lastReadMs=Date.now()-started;
   }catch(error){stats.errors++;stats.lastError=String(error.message||error);cleanup();if(options.error)options.error(error);return;}
   if(!closed)timer=g.setTimeout(poll,33);
  }
  lease={stats:stats,close:close};active=lease;lastStats=stats;timer=g.setTimeout(poll,0);return lease;
 }
 g.CivSDKKeyboard={api:1,open:open,get lastStats(){return lastStats;}};
})(typeof window!=='undefined'?window:globalThis);
