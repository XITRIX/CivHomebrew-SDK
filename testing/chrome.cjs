const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function open(){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'civ-nanovg-'));
 const chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-extensions','--no-first-run','--no-default-browser-check','--allow-file-access-from-files','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let stderr='',error;chrome.on('error',e=>error=e);chrome.stderr.on('data',s=>stderr=(stderr+s).slice(-3000));let socket;
 try{
  let port;for(let i=0;i<150;i++){if(error)throw error;try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}if(chrome.exitCode!==null)throw Error(stderr);await sleep(50);}if(!port)throw Error('Chrome startup timed out: '+stderr);
  const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  const pending=new Map();let id=0;socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},60000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  return {call,evaluate,until:async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(80);}throw Error('UI timed out: '+expression+'\n'+await evaluate('document.body.innerText'));},close:async()=>{socket.close();chrome.kill();await sleep(200);fs.rmSync(profile,{recursive:true,force:true});}};
 }catch(e){if(socket)socket.close();chrome.kill();throw e;}
}
module.exports={open,sleep};
