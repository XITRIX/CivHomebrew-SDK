// Shared pixel algorithm. Vulkan uses SSBOs, Chrome QA uses an integer texture.
float num(int i){return uintBitsToFloat(word(i));}
vec2 v2(int i){return vec2(num(i),num(i+1));}
vec4 v4(int i){return vec4(num(i),num(i+1),num(i+2),num(i+3));}
float cross2(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}
vec4 rgba(uint c){return vec4(c&255u,(c>>8)&255u,(c>>16)&255u,c>>24)/255.;}
vec4 texel(int id,ivec2 p){
 int m=int(word(6))+id*4,w=int(word(m+1)),h=int(word(m+2));
 if(w<1||h<1)return vec4(0);
 p=clamp(p,ivec2(0),ivec2(w-1,h-1));
 return rgba(word(int(word(7))+int(word(m))+p.y*w+p.x));
}
vec4 sampleImage(int id,vec2 uv){
 int m=int(word(6))+id*4;vec2 size=vec2(word(m+1),word(m+2));
 if(int(word(m+3))==3)return texel(id,ivec2(floor(uv*size)));
 vec2 p=uv*size-.5,f=fract(p);ivec2 i=ivec2(floor(p));
 return mix(mix(texel(id,i),texel(id,i+ivec2(1,0)),f.x),mix(texel(id,i+ivec2(0,1)),texel(id,i+ivec2(1)),f.x),f.y);
}
bool hit(vec2 p,int t,out vec2 uv,out float area){
 vec4 a=v4(t),b=v4(t+4),c=v4(t+8);area=cross2(b.xy-a.xy,c.xy-a.xy);
 if(abs(area)<.000001)return false;
 vec2 q=p-a.xy;float u=cross2(q,c.xy-a.xy)/area,v=cross2(b.xy-a.xy,q)/area;
 if(u<0.||v<0.||u+v>1.)return false;
 uv=a.zw*(1.-u-v)+b.zw*u+c.zw*v;return true;
}
vec4 drawPixel(vec2 p,int index,int triangleList,int triangleCount){
 int d=int(word(4))+index*32;vec4 bounds=v4(d),clip=v4(d+12);
 if(p.x<bounds.x||p.y<bounds.y||p.x>=bounds.z||p.y>=bounds.w||p.x<clip.x||p.y<clip.y||p.x>=clip.z||p.y>=clip.w)return vec4(0);
 int first=int(num(d+8)),count=int(num(d+9)),kind=int(num(d+10)),image=int(num(d+11));
 float coverage=0.,winding=0.;vec2 textureUV=vec2(0);
 bool interior=num(d+29)==1.&&all(greaterThanEqual(p,v2(d+25)))&&all(lessThan(p,v2(d+27)));
 if(interior)coverage=1.;
 else for(int i=0;i<triangleCount;i++){
   int t=int(word(5))+int(bin(triangleList+i))*16;vec2 uv;float area;
   if(!hit(p+vec2(.00013,.00037)-v2(d+30),t,uv,area))continue;
   int mode=int(num(t+12));
   if(mode==0)winding+=sign(area);
   else if(mode==1)coverage=max(coverage,min(1.,(1.-abs(uv.x*2.-1.))*num(d+24))*min(1.,uv.y));
   else {textureUV=uv;coverage=1.;break;}
 }
 if(kind==0&&abs(winding)>.5)coverage=1.;
 vec4 c=v4(d+4);
 if(image>0){
   if(kind!=2){vec2 a=v2(d+16),b=v2(d+18),offset=v2(d+20);textureUV=vec2(dot(vec2(a.x,b.x),p),dot(vec2(a.y,b.y),p))+offset;textureUV/=v2(d+22);}
   int m=int(word(6))+image*4;
   vec4 tex=sampleImage(image,textureUV);
   if(word(m+3)==1u)c.a*=tex.r;else c*=tex;
 }
 c.a*=clamp(coverage,0.,1.);return vec4(c.rgb*c.a,c.a);
}
vec4 raster(vec2 p){
 vec4 outColor=vec4(0);
 #ifdef NATIVE_BINS
 int tile=int(p.y)/32*int(word(10))+int(p.x)/32;
 int at=tile*BIN_STRIDE,count=min(int(bin(at)),BIN_CAPACITY);
 #else
 int count=int(word(2));
 #endif
 for(int i=0;i<count;i++){
  #ifdef NATIVE_BINS
  int rec=at+1+i*3,index=int(bin(rec));
  int triangleList=at+1+BIN_CAPACITY*3+int(bin(rec+1)),triangleCount=min(int(bin(rec+2)),512-int(bin(rec+1)));
  #else
  int index=i;
  #endif
  vec4 c=drawPixel(p,index,triangleList,triangleCount);outColor=c+outColor*(1.-c.a);
 }
 // Export straight RGBA for native video composition; geometry blends premultiplied.
 return outColor.a>0.?vec4(outColor.rgb/outColor.a,outColor.a):vec4(0);
}
