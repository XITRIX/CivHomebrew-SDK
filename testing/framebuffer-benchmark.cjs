/* Jitless CPU preparation benchmark, not a GPU or console FPS claim. */
const fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
async function measure(runtime){
 const g={console,setTimeout,clearTimeout,performance};g.window=g;g.globalThis=g;
 vm.runInContext(fs.readFileSync(runtime,'utf8'),vm.createContext(g,{codeGeneration:{strings:true,wasm:false}}));
 const geometry=await g.CivNanoVGGeometry.create(),Bytes=geometry.module.HEAPU8.constructor,bytes=new Bytes(320*200*4);
 const image=geometry.pixels(320,200,bytes),scene={width:1920,height:1080,commands:[
  {kind:'text',text:'Retained framebuffer HUD 0123456789',x:20,baseline:30,size:24,bold:0,color:[1,1,1,1],clip:[0,0,1920,1080]},
  {kind:'image',source:image.source,rect:[0,40,1440,1040],radius:0,alpha:1,clip:[0,0,1920,1080]}]};
 geometry.build(scene,true);for(let i=0;i<3;i++){image.update(bytes);geometry.build(scene,true);}
 const samples=[],repacked=[];
 for(let i=0;i<30;i++){bytes[0]=i;const start=performance.now();image.update(bytes);const packet=geometry.build(scene,true);samples.push(performance.now()-start);repacked.push(geometry.stats.texturePackedBytes??[...geometry.textures.values()].reduce((n,t)=>n+t.w*t.h*4,0));}
 samples.sort((a,b)=>a-b);const result={version:g.CivHomebrewSDK.version,frames:30,medianPrepareMs:samples[15],p95PrepareMs:samples[28],meanPackedBytes:repacked.reduce((a,b)=>a+b)/30,textures:geometry.textures.size};geometry.close();return result;
}
(async()=>{const results=[];for(const path of process.argv.slice(2))results.push(await measure(path));console.log(JSON.stringify({scope:'jitless CPU image update and retained packet preparation; no GPU or display measurement',results},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
