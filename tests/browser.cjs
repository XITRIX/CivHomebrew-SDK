/* Independent DOM/view and WebGL oracle checks; no application checkout. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{open,sleep}=require('../testing/chrome.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/browser');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const runtime=pathToFileURL(path.join(root,'dist',require('../package.json').version,'civapps-native-ui.js')).href;
 const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0}button{font:16px CivNanoVG}#first,#second{position:fixed;left:0;top:0;width:1280px;height:720px}#second{display:none}</style>
 <div id="first" data-civ-native-ui="1"><div style="position:absolute;left:10px;top:20px;width:200px;height:80px;background:rgba(51,102,153,.5)"></div>
 <button id="button" style="position:absolute;left:10px;top:150px;width:200px;height:60px;display:flex;align-items:center;justify-content:center;line-height:22px">Centered label</button>
 <div style="position:absolute;left:10px;top:300px;font-size:16px;line-height:140%;white-space:pre;color:white">Overlay one
Overlay two
Overlay three</div></div>
 <div id="second" data-civ-native-ui="1" style="background:rgb(20,30,40)">Other CivApp</div>
 <script src="${runtime}"></script><script>(async()=>{window.shared=await CivAppsNativeUI.sessions.start({browser:true});window.firstLease=await shared.attach(document.getElementById('first'));})().catch(e=>window.failure=String(e));</script>`;
 const page=path.join(out,'index.html');fs.writeFileSync(page,html);
 const chrome=await open(),{call,evaluate,until}=chrome;
 try{
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:pathToFileURL(page).href});
  await until('!!window.failure||!!window.shared?.active?.ui.stats.frames');
  assert.equal(await evaluate('window.failure||null'),null);
  const pixels=await evaluate(`(()=>{var b=shared.renderer.read();function pixel(x,y){return Array.from(b.slice((y*1920+x)*4,(y*1920+x)*4+4));}return [pixel(75,75),pixel(1800,1000)];})()`);
  assert(pixels[0].every((v,i)=>Math.abs(v-[51,102,153,128][i])<=1),JSON.stringify(pixels));
  assert.deepEqual(pixels[1],[0,0,0,0]);
  async function spacing(){
   return evaluate(`(()=>{var rows=shared.active.ui.scene.commands.filter(c=>c.kind==='text'&&c.text.indexOf('Overlay ')===0);return rows.map(c=>c.baseline);})()`);
  }
  let rows=await spacing();assert.equal(rows.length,3);
  for(let i=1;i<rows.length;i++)assert(Math.abs(rows[i]-rows[i-1]-33.6)<1,JSON.stringify(rows));
  await evaluate('window.originalGeometry=shared.geometry;window.originalRenderer=shared.renderer;document.getElementById("first").style.display="none";document.getElementById("second").style.display="block";');await sleep(100);
  await evaluate('(async()=>{window.secondLease=await shared.attach(document.getElementById("second"));await firstLease.close();})()');
  assert.equal(await evaluate('shared.active.root.id'), 'second');
  assert.equal(await evaluate('shared.geometry===originalGeometry&&shared.renderer===originalRenderer'),true);
  await evaluate('document.getElementById("first").style.display="block";document.getElementById("second").style.display="none";document.createRange=undefined;');await sleep(100);
  await evaluate('(async()=>{window.newLease=await shared.attach(document.getElementById("first"));await secondLease.close();})()');
  await until('shared.active.ui.stats.frames>0');rows=await spacing();assert.equal(rows.length,3);
  for(let i=1;i<rows.length;i++)assert(Math.abs(rows[i]-rows[i-1]-33.6)<1,JSON.stringify(rows));
  const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'native-ui.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate('(async()=>{await newLease.close();await shared.close();})()');
  assert.equal(await evaluate('CivAppsNativeUI.sessions.current===null&&document.querySelectorAll("#nanovg-output").length===0'),true);
  console.log('Standalone browser passed: alpha, fonts/line spacing, view handoff, no-Range fallback, retained owner and cleanup.');
 }finally{await chrome.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
