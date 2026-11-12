/* Browser-only shader oracle. Uses the real NanoVG geometry and the same GLSL
 * raster function as Vulkan. It does not emulate native calls or presentation. */
(function(g){
 'use strict';
 function create(canvas){
  var gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:false});if(!gl)throw Error('WebGL2 required for browser NanoVG comparison');
  function shader(type,source){var s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  var program=gl.createProgram(),vs=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}'),fs=shader(gl.FRAGMENT_SHADER,g.CivNanoVGShaders.web);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  function texture(){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);return t;}
  var tex=texture(),binTex=texture();gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'uData'),0);gl.uniform1i(gl.getUniformLocation(program,'uBins'),1);
  return {render:function(packet){
   canvas.width=packet.width;canvas.height=packet.height;gl.viewport(0,0,canvas.width,canvas.height);
   var rows=Math.ceil(packet.data.length/1024),padded=new Uint32Array(rows*1024);padded.set(packet.data);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32UI,1024,rows,0,gl.RED_INTEGER,gl.UNSIGNED_INT,padded);
   // CPU bin oracle for native bin.comp; not part of the console renderer.
   var bins=g.CivNanoVGWeb.bins(packet),binPadded=new Uint32Array(Math.ceil(bins.length/1024)*1024);binPadded.set(bins);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,binTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32UI,1024,binPadded.length/1024,0,gl.RED_INTEGER,gl.UNSIGNED_INT,binPadded);
   gl.uniform1i(gl.getUniformLocation(program,'uWidth'),packet.width);gl.uniform1i(gl.getUniformLocation(program,'uHeight'),packet.height);gl.drawArrays(gl.TRIANGLES,0,3);
   var error=gl.getError();if(error)throw Error('NanoVG WebGL error '+error);
  },read:function(){var raw=new Uint8Array(canvas.width*canvas.height*4),out=new Uint8Array(raw.length);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);for(var y=0;y<canvas.height;y++)out.set(raw.subarray(y*canvas.width*4,(y+1)*canvas.width*4),(canvas.height-y-1)*canvas.width*4);return out;},close:function(){gl.deleteTexture(tex);gl.deleteTexture(binTex);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);}};
 }
 function bins(packet){
  var cols=Math.ceil(packet.width/32),rows=Math.ceil(packet.height/32),stride=897,out=new Uint32Array(cols*rows*stride+1),f=new Float32Array(packet.data.buffer),offset=packet.data[4],tri=packet.data[5];
  for(var tile=0;tile<cols*rows;tile++){
   var x=tile%cols*32-.001,y=Math.floor(tile/cols)*32-.001,n=0,used=0,base=tile*stride;
   for(var i=0;i<packet.draws;i++){
    var d=offset+i*32;if(Math.max(f[d],f[d+12])>=x+32.002||Math.max(f[d+1],f[d+13])>=y+32.002||Math.min(f[d+2],f[d+14])<=x||Math.min(f[d+3],f[d+15])<=y)continue;
    if(f[d+29]===1&&f[d+7]===1&&Math.max(f[d+25],f[d+12])<=x&&Math.max(f[d+26],f[d+13])<=y&&Math.min(f[d+27],f[d+14])>=x+32.002&&Math.min(f[d+28],f[d+15])>=y+32.002){n=0;used=0;out.fill(0,base+1,base+stride);}
    var start=used;
    for(var j=0;j<f[d+9];j++){
     var index=f[d+8]+j,t=tri+index*16,tx=f[d+30],ty=f[d+31];
     if(Math.min(f[t],f[t+4],f[t+8])+tx>x+32.002||Math.min(f[t+1],f[t+5],f[t+9])+ty>y+32.002||Math.max(f[t],f[t+4],f[t+8])+tx<x||Math.max(f[t+1],f[t+5],f[t+9])+ty<y)continue;
     if(used>=512)throw Error('NanoVG triangle tile overflow');out[base+385+used++]=index;
    }
    if(used===start)continue;if(n>=128)throw Error('NanoVG draw tile overflow');out.set([i,start,used-start],base+1+n++*3);
   }out[base]=n;
  }return out;
 }
 g.CivNanoVGWeb={create:create,bins:bins};
})(window);
