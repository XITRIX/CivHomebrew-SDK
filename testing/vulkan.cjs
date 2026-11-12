/* Execute the packaged native SPIR-V on host Vulkan. No Switch call is mocked
 * into a rendering claim. Verify straight alpha independently of the WebGL path. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
async function verify(options){
 const dir=path.resolve(options.out);fs.mkdirSync(dir,{recursive:true});
 const g={console,setTimeout,clearTimeout,atob,unescape,encodeURIComponent,performance};g.window=g;g.globalThis=g;
 vm.runInContext(fs.readFileSync(options.runtime,'utf8'),vm.createContext(g,{codeGeneration:{strings:true,wasm:false}}));
 const geometry=await g.CivNanoVGGeometry.create();
 // Construct bytes in the renderer realm so native bridge type checks remain exact.
 const image=geometry.pixels(2,2,new g.CivNanoVGBuffer([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]));
 const scene={width:1920,height:1080,commands:[{kind:'rect',rect:[10,20,210,100],radius:0,color:[.2,.4,.6,.5],clip:[0,0,1920,1080]},{kind:'image',source:image.source,rect:[300,20,500,220],radius:0,alpha:1,clip:[0,0,1920,1080]}]};
 const packet=geometry.build(scene);
 fs.writeFileSync(path.join(dir,'packet.bin'),new Uint8Array(packet.data.buffer));
 for(const name of ['bin.comp','raster.comp'])fs.writeFileSync(path.join(dir,name+'.spv'),Buffer.from(g.CivNanoVGShaders.spirv[name],'hex'));
 const binary=path.join(dir,'vulkan-host'),includes=process.env.VULKAN_INCLUDE||'/opt/homebrew/opt/vulkan-headers/include',lib=process.env.VULKAN_LIB||'/opt/homebrew/opt/molten-vk/lib';
 execFileSync(process.env.CC||'cc',['-std=c11','-O2','-Wall','-Wextra','-I'+includes,path.join(__dirname,'vulkan-host.c'),'-L'+lib,process.platform==='darwin'?'-lMoltenVK':'-lvulkan','-o',binary],{stdio:'inherit'});
 execFileSync(binary,[path.join(dir,'bin.comp.spv'),path.join(dir,'raster.comp.spv'),path.join(dir,'packet.bin'),path.join(dir,'output.rgba'),path.join(dir,'bins.bin')],{stdio:'inherit',timeout:30000});
 const rgba=fs.readFileSync(path.join(dir,'output.rgba')),pixel=(x,y)=>[...rgba.subarray((y*1920+x)*4,(y*1920+x)*4+4)];
 assert.deepEqual(pixel(500,500),[0,0,0,0]);const actual=pixel(50,50),expected=[51,102,153,128];assert(actual.every((v,i)=>Math.abs(v-expected[i])<=1),JSON.stringify(actual));
 assert.deepEqual(pixel(350,70),[255,0,0,255]);
 image.update(new g.CivNanoVGBuffer([0,0,255,255,0,0,255,255,0,0,255,255,0,0,255,255]));
 const updated=geometry.build(scene);assert(updated.generation>packet.generation);assert(geometry.stats.preparedHit);
 fs.writeFileSync(path.join(dir,'packet.bin'),new Uint8Array(updated.data.buffer));
 execFileSync(binary,[path.join(dir,'bin.comp.spv'),path.join(dir,'raster.comp.spv'),path.join(dir,'packet.bin'),path.join(dir,'updated.rgba'),path.join(dir,'updated-bins.bin')],{stdio:'inherit',timeout:30000});
 const changed=fs.readFileSync(path.join(dir,'updated.rgba')),at=(70*1920+350)*4;assert.deepEqual([...changed.subarray(at,at+4)],[0,0,255,255]);
 geometry.close();console.log('Actual host Vulkan passed: release shaders, alpha, dynamic RGBA updates and retained geometry.');
}
module.exports={verify};
if(require.main===module)verify({runtime:process.argv[2]||path.join(__dirname,'../dist',require('../package.json').version,'civapps-native-ui.js'),out:process.argv[3]||path.join(__dirname,'../build/vulkan')}).catch(e=>{console.error(e);process.exitCode=1;});
