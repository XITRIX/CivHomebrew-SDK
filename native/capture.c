/* NanoVG geometry backend for the opt-in CivHomebrew Vulkan prototype.
 * This is CPU path/font preparation, not a software framebuffer renderer.
 * Packed records are consumed by the same shader in Vulkan and browser QA. */
#include <emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "nanovg.h"

#define MAX_DRAWS 4096
#define MAX_TRIS 65536
static NVGcontext *vg;
static float draws[MAX_DRAWS][32], tris[MAX_TRIS][16];
static int ndraws, ntris, failed, nextTexture;

EM_JS(void, texture, (int op,int id,int w,int h,int type,const unsigned char *data), {
  Module.civTexture(op,id,w,h,type,data);
});
static int create(void *u){return 1;}
static int createTexture(void *u,int type,int w,int h,int flags,const unsigned char *data){
  int id=++nextTexture;texture(0,id,w,h,type,data);return id;
}
static int deleteTexture(void *u,int id){texture(2,id,0,0,0,0);return 1;}
/* Fontstash supplies the full atlas even for a dirty rectangle. Upload snapshots
 * are cached by generation; copying only this rectangle is a later optimization. */
static int updateTexture(void *u,int id,int x,int y,int w,int h,const unsigned char *data){
  texture(1,id,0,0,0,data);return 1;
}
EM_JS(int, textureSize, (int id,int *w,int *h), {
  var t=Module.civTextures.get(id);if(!t)return 0;HEAP32[w>>2]=t.w;HEAP32[h>>2]=t.h;return 1;
});
static int getTextureSize(void *u,int id,int *w,int *h){return textureSize(id,w,h);}
static void viewport(void *u,float w,float h,float ratio){}
static void noop(void *u){}
static int beginDraw(NVGpaint *p,NVGscissor *s,int kind,float multiplier){
  if(ndraws>=MAX_DRAWS){failed=1;return -1;}
  float *d=draws[ndraws++];memset(d,0,32*sizeof(float));
  d[0]=d[1]=1e10f;d[2]=d[3]=-1e10f;
  memcpy(d+4,p->innerColor.rgba,16);d[8]=(float)ntris;d[10]=(float)kind;d[11]=(float)p->image;
  d[12]=s->xform[4]-s->extent[0];d[13]=s->xform[5]-s->extent[1];
  d[14]=s->xform[4]+s->extent[0];d[15]=s->xform[5]+s->extent[1];
  if(s->extent[0]<0){d[12]=d[13]=-1e10f;d[14]=d[15]=1e10f;}
  /* The prototype issues axis-aligned scissors and image patterns only. */
  nvgTransformInverse(d+16,p->xform);d[22]=p->extent[0];d[23]=p->extent[1];d[24]=multiplier;
  return ndraws-1;
}
static void tri(int draw,NVGvertex a,NVGvertex b,NVGvertex c,int mode){
  if(draw<0||ntris>=MAX_TRIS){failed=1;return;}
  float *d=draws[draw],*t=tris[ntris++];
  memcpy(t,&a,16);memcpy(t+4,&b,16);memcpy(t+8,&c,16);t[12]=(float)mode;t[13]=t[14]=t[15]=0;
  NVGvertex v[3]={a,b,c};for(int i=0;i<3;i++){d[0]=fminf(d[0],v[i].x);d[1]=fminf(d[1],v[i].y);d[2]=fmaxf(d[2],v[i].x);d[3]=fmaxf(d[3],v[i].y);}
  d[9]=(float)ntris-d[8];
}
static void strip(int draw,const NVGvertex *v,int n){
  for(int i=2;i<n;i++)tri(draw,v[i-2],v[i-1],v[i],1);
}
static void fill(void *u,NVGpaint *p,NVGcompositeOperationState c,NVGscissor *s,float fringe,const float *bounds,const NVGpath *paths,int n){
  int d=beginDraw(p,s,0,1);
  for(int i=0;i<n;i++){
    const NVGpath *q=paths+i;
    for(int j=2;j<q->nfill;j++)tri(d,q->fill[0],q->fill[j-1],q->fill[j],0);
    strip(d,q->stroke,q->nstroke);
  }
}
static void stroke(void *u,NVGpaint *p,NVGcompositeOperationState c,NVGscissor *s,float fringe,float width,const NVGpath *paths,int n){
  int d=beginDraw(p,s,1,(width*.5f+fringe*.5f)/fringe);
  for(int i=0;i<n;i++)strip(d,paths[i].stroke,paths[i].nstroke);
}
static void triangles(void *u,NVGpaint *p,NVGcompositeOperationState c,NVGscissor *s,const NVGvertex *v,int n,float fringe){
  int d=beginDraw(p,s,2,1);for(int i=0;i+2<n;i+=3)tri(d,v[i],v[i+1],v[i+2],2);
}
int civ_init(void){
  if(vg)return 1;NVGparams p;memset(&p,0,sizeof(p));p.edgeAntiAlias=1;
  p.renderCreate=create;p.renderCreateTexture=createTexture;p.renderDeleteTexture=deleteTexture;
  p.renderUpdateTexture=updateTexture;p.renderGetTextureSize=getTextureSize;p.renderViewport=viewport;
  p.renderCancel=noop;p.renderFlush=noop;p.renderFill=fill;p.renderStroke=stroke;p.renderTriangles=triangles;p.renderDelete=noop;
  vg=nvgCreateInternal(&p);return vg!=NULL;
}
int civ_font(unsigned char *data,int length,int bold){return nvgCreateFontMem(vg,bold==2?"mono":bold?"bold":"regular",data,length,0);}
int civ_image(unsigned char *data,int length){return nvgCreateImageMem(vg,0,data,length);}
void civ_begin(int width,int height){ndraws=ntris=failed=0;nvgBeginFrame(vg,(float)width,(float)height,1);}
void civ_clip(float x,float y,float w,float h){nvgScissor(vg,x,y,w,h);}
void civ_color(float r,float g,float b,float a){nvgFillColor(vg,nvgRGBAf(r,g,b,a));}
void civ_rect(float x,float y,float w,float h,float radius){nvgBeginPath(vg);nvgRoundedRect(vg,x,y,w,h,radius);nvgFill(vg);}
void civ_triangle(float ax,float ay,float bx,float by,float cx,float cy){nvgBeginPath(vg);nvgMoveTo(vg,ax,ay);nvgLineTo(vg,bx,by);nvgLineTo(vg,cx,cy);nvgClosePath(vg);nvgFill(vg);}
void civ_border(float x,float y,float w,float h,float radius,float width){nvgBeginPath(vg);nvgRoundedRect(vg,x,y,w,h,radius);nvgRoundedRect(vg,x+width,y+width,fmaxf(0,w-2*width),fmaxf(0,h-2*width),fmaxf(0,radius-width));nvgPathWinding(vg,NVG_HOLE);nvgFill(vg);}
void civ_picture(float x,float y,float w,float h,float radius,int image,float alpha){nvgBeginPath(vg);nvgRoundedRect(vg,x,y,w,h,radius);nvgFillPaint(vg,nvgImagePattern(vg,x,y,w,h,0,image,alpha));nvgFill(vg);}
void civ_text(float x,float baseline,float size,int font,const char *text){nvgFontFaceId(vg,font);nvgFontSize(vg,size);nvgTextAlign(vg,NVG_ALIGN_LEFT|NVG_ALIGN_BASELINE);nvgText(vg,x,baseline,text,NULL);}
float civ_measure(float size,int font,const char *text){nvgFontFaceId(vg,font);nvgFontSize(vg,size);return nvgTextBounds(vg,0,0,text,NULL,NULL);}
float *civ_metrics(float size,int font){static float m[3];nvgFontFaceId(vg,font);nvgFontSize(vg,size);nvgTextMetrics(vg,m,m+1,m+2);return m;}
void civ_end(void){nvgEndFrame(vg);}
int civ_draws(void){return (int)draws;}
int civ_tris(void){return (int)tris;}
int civ_draw_count(void){return ndraws;}
int civ_tri_count(void){return ntris;}
int civ_failed(void){return failed;}
void civ_close(void){if(vg)nvgDeleteInternal(vg);vg=NULL;nextTexture=0;}
