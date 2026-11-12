/* DOM -> retained NanoVG drawing commands. No pixel loops and no idle DOM scans.
 * Supports a bounded axis-aligned DOM subset; unknown effects are reported. */
(function(g){
 'use strict';
 function intersect(a,b){return [Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];}
 function visible(a){return a[2]>a[0]&&a[3]>a[1];}
 function rgba(value,opacity){
  var m=String(value).match(/^rgba?\(([^)]+)\)/),c=m?m[1].split(/[, /]+/).map(Number):[0,0,0,0];
  return [c[0]/255,c[1]/255,c[2]/255,(c.length>3?c[3]:1)*opacity];
 }
 function pixels(value,rootSize,fontSize){var n=parseFloat(value);if(!Number.isFinite(n))return 0;value=String(value);if(/rem$/.test(value))return n*rootSize;if(/em$/.test(value))return n*fontSize;return n;}
 function lineHeight(value,fontSize,rootSize){
  value=String(value||'normal');if(value==='normal')return 0;
  // The console resolves unitless 1.4 as 140%, unlike browser pixel strings.
  if(/%$/.test(value))return parseFloat(value)*fontSize/100;
  if(/^[0-9.]+$/.test(value))return parseFloat(value)*fontSize;
  return pixels(value,rootSize,fontSize);
 }
 function fitLine(text,left,right,align,ellipsis,measure,allowance){
  var width=Math.max(0,right-left),w=measure(text);
  if(ellipsis&&w>width+allowance){var points=Array.from(text);while(points.length&&measure(points.join('')+'…')>width+allowance)points.pop();text=points.join('')+'…';w=measure(text);}
  return {text:text,x:align==='right'?right-w:align==='center'?left+(width-w)/2:left,width:w};
 }
 function wrapWords(paragraph,width,measure,breakWord){
  var out=[],line='';for(var part of paragraph.split(' ')){
   var next=line?line+' '+part:part;if(line&&measure(next)>width){out.push(line);line='';next=part;}
   if(!line&&breakWord&&measure(part)>width){for(var ch of Array.from(part)){if(line&&measure(line+ch)>width){out.push(line);line='';}line+=ch;}}
   else line=next;
  }out.push(line);return out;
 }
 function snapshot(root,o){
  var width=o.width||1920,height=o.height||1080,sx=width/g.innerWidth,sy=height/g.innerHeight,commands=[],warnings=new Set(),nodes=0,styles=new Map();
  function style(node){if(!styles.has(node))styles.set(node,g.getComputedStyle(node));return styles.get(node);}
  var rootSize=parseFloat(g.getComputedStyle(document.documentElement).fontSize)||18,fontSizes=new Map();
  function fontPixels(node){if(fontSizes.has(node))return fontSizes.get(node);var s=style(node),v=String(s.fontSize||'24px'),parent=/em$/.test(v)&&!/rem$/.test(v)&&node.parentNode&&node.parentNode.nodeType===1?fontPixels(node.parentNode):rootSize;var n=pixels(v,rootSize,parent)||24;fontSizes.set(node,n);return n;}
  function bounds(r){return [r.left*sx,r.top*sy,r.right*sx,r.bottom*sy];}
  function walk(node,clip,opacity,depth){
   if(depth>40||++nodes>2048)throw Error('NanoVG DOM scene limit exceeded');
   var s=style(node);
   if(node.hidden||s.display==='none'||s.visibility==='hidden')return;
   if(s.transform&&s.transform!=='none')warnings.add('CSS transforms');
   if(s.boxShadow&&s.boxShadow!=='none')warnings.add('CSS box shadow');
   var fontSize=fontPixels(node),alpha=opacity*Number(s.opacity||1),r=bounds(node.getBoundingClientRect());if(!alpha)return;
   var inside=intersect(r,clip),radius=pixels(s.borderTopLeftRadius,rootSize,fontSize)*sx;
   if(String(s.borderTopLeftRadius).includes('%'))radius=Math.min(r[2]-r[0],r[3]-r[1])*parseFloat(s.borderTopLeftRadius)/100;
   function add(command){command.clip=clip.slice();command.id=node.id||node.tagName;commands.push(command);}
   var bg=rgba(s.backgroundColor,alpha),border=['Top','Right','Bottom','Left'].map(function(side){return pixels(s['border'+side+'Width'],rootSize,fontSize)*(side==='Top'||side==='Bottom'?sy:sx);});
   if(visible(inside)&&bg[3])add({kind:'rect',rect:r,color:bg,radius:radius});
   var borderTriangle=parseFloat(s.width)===0&&parseFloat(s.height)===0&&border[0]&&border[1]&&border[3];
   if(visible(inside)&&border.some(Boolean)&&!borderTriangle){
    var colors=['Top','Right','Bottom','Left'].map(function(side){return rgba(s['border'+side+'Color'],alpha);});
    if(border.every(function(b){return b===border[0];})&&colors.every(function(c){return String(c)===String(colors[0]);})){
     if(colors[0][3])add({kind:'border',rect:r,color:colors[0],radius:radius,lineWidth:border[0]});
    }else{
     var shapes=[[r[0],r[1],r[2],r[1]+border[0]],[r[2]-border[1],r[1],r[2],r[3]],[r[0],r[3]-border[2],r[2],r[3]],[r[0],r[1],r[0]+border[3],r[3]]];
     shapes.forEach(function(b,i){if(border[i]&&colors[i][3])add({kind:'rect',rect:b,color:colors[i],radius:0});});
    }
   }
   // CSS border triangle used by the selected tile's speech bubble.
   if(borderTriangle){
    var color=rgba(s.borderTopColor,alpha);if(color[3])add({kind:'triangle',points:[r[0],r[1],r[2],r[1],r[0]+border[3],r[3]],color:color});
   }
   if(node.tagName==='IMG'&&visible(inside)){
    var source=node.getAttribute('src')||'';if(source)add({kind:'image',rect:r,radius:radius,source:source,alpha:alpha});
   }
   var size=fontSize*sy,bold=Number(s.fontWeight)>=600?1:0,font=/monospace|CivNanoMono|Source Code Pro/i.test(s.fontFamily||'')?2:bold,color=rgba(s.color,alpha);
   var left=r[0]+pixels(s.paddingLeft,rootSize,fontSize)*sx+border[3],right=r[2]-pixels(s.paddingRight,rootSize,fontSize)*sx-border[1],contentTop=r[1]+pixels(s.paddingTop,rootSize,fontSize)*sy+border[0],contentBottom=r[3]-pixels(s.paddingBottom,rootSize,fontSize)*sy-border[2];
   var ellipsis=s.textOverflow==='ellipsis',allowance=ellipsis?sx:0,textClip=intersect([left-allowance,contentTop,right+allowance,contentBottom],clip);
   var align=s.textAlign;if(s.display.indexOf('flex')>=0&&s.justifyContent==='center')align='center';
   // A rightmost space-between value is positioned by the layout engine's font width.
   // Anchor its native text to the same content edge, using native advances.
   if(node.parentNode&&node.parentNode.nodeType===1){var ps=style(node.parentNode);if(ps.display.indexOf('flex')>=0&&ps.justifyContent==='space-between'&&ps.flexDirection!=='column'&&node===node.parentNode.lastElementChild)align='right';}
   var textNodes=Array.from(node.childNodes||[]);
   if(node.tagName==='INPUT'||node.tagName==='TEXTAREA')textNodes=[{nodeType:3,nodeValue:String(node.value||node.placeholder||'')}];
   if(color[3]&&visible(textClip))for(var child of textNodes)if(child.nodeType===3&&child.nodeValue.trim()){
    var text=child.nodeValue,pre=s.whiteSpace==='pre'||s.whiteSpace==='pre-wrap',lines=[],metrics=o.metrics(size,font);
    if(!pre)text=text.replace(/\s+/g,' ');
    // Use the DOM's actual line breaks when Range is available. Cache consumers
    // retain these commands until a text/style/scroll/layout invalidation.
    var textKey=JSON.stringify([text,r,size,font,s.whiteSpace,s.lineHeight,s.fontFamily,s.textAlign,s.paddingLeft,s.paddingRight,s.paddingTop,s.paddingBottom,s.overflowWrap,s.wordBreak,align]),cached=o.textCache&&o.textCache.get(child);
    if(cached&&cached.key===textKey)lines=cached.lines.map(function(l){return Object.assign({},l);});
    if(!lines.length&&document.createRange&&child.parentNode===node&&text===child.nodeValue){
     try{
      var range=document.createRange(),line=null;
      for(var i=0;i<text.length;i++){
       range.setStart(child,i);range.setEnd(child,i+1);var boxes=range.getClientRects();if(!boxes.length||text[i]==='\n')continue;
       var b=bounds(boxes[0]);if(!line||Math.abs(line.top-b[1])>.5){line={text:'',x:b[0],top:b[1],height:b[3]-b[1]};lines.push(line);}line.text+=text[i];
      }
      if(range.detach)range.detach();
     }catch(e){lines=[];warnings.add('Text Range unavailable; NanoVG wrapping');}
    }
    if(!lines.length){
     var top=contentTop,lh=lineHeight(s.lineHeight,fontSize,rootSize)*sy;
     if(!Number.isFinite(lh)||lh<=0)lh=metrics[2];
     for(var paragraph of text.split('\n')){
      var rows=(s.whiteSpace==='nowrap'||s.whiteSpace==='pre')?[paragraph]:wrapWords(paragraph,right-left,function(t){return o.measure(t,size,font);},s.overflowWrap==='break-word'||s.overflowWrap==='anywhere'||s.wordBreak==='break-all');
      rows.forEach(function(row){lines.push({text:row,x:left,top:top,height:lh});top+=lh;});
     }
     if(s.display.indexOf('flex')>=0&&s.alignItems==='center'){var dy=(contentBottom-contentTop-lines.length*lh)/2;lines.forEach(function(l){l.top+=dy;});}
    }
    if(o.textCache&&(!cached||cached.key!==textKey))o.textCache.set(child,{key:textKey,lines:lines.map(function(l){return Object.assign({},l);})});
    for(var line of lines){
     var fitted=fitLine(line.text,left,right,align,ellipsis,function(t){return o.measure(t,size,font);},allowance);
     line.text=fitted.text;if(align==='right'||align==='center'||ellipsis)line.x=fitted.x;
     var baseline=line.top+(line.height-(metrics[0]-metrics[1]))/2+metrics[0];
     var command={kind:'text',text:line.text,x:line.x,baseline:baseline,size:size,bold:bold,font:font,color:color,clip:textClip.slice(),id:node.id||node.tagName};commands.push(command);
    }
   }
   var childClip=clip;
   if([s.overflowX,s.overflowY].some(function(v){return v==='hidden'||v==='auto'||v==='scroll'||v==='clip';}))childClip=intersect(clip,r);
   Array.from(node.children||[]).map(function(n,i){return {node:n,index:i,z:parseFloat(style(n).zIndex)||0};}).sort(function(a,b){return a.z-b.z||a.index-b.index;}).forEach(function(e){walk(e.node,childClip,alpha,depth+1);});
   // The shared CivApps scrollbar uses a 2px teal thumb.
   if((s.overflowY==='auto'||s.overflowY==='scroll')&&node.scrollHeight>node.clientHeight&&node.clientHeight>0){
    var track=node.clientHeight*sy,thumb=track*node.clientHeight/node.scrollHeight,top=r[1]+(track-thumb)*node.scrollTop/(node.scrollHeight-node.clientHeight);
    commands.push({kind:'rect',rect:[r[2]-2*sx,top,r[2],top+thumb],radius:0,color:[0,239/255,207/255,alpha],clip:intersect(r,clip),id:(node.id||node.tagName)+'-scrollbar'});
   }
  }
  walk(root,[0,0,width,height],1,0);
  return {width:width,height:height,commands:commands,warnings:Array.from(warnings),nodes:nodes};
 }
 // the layout engine applies CSS on an engine update. A rectangle read does not flush
 // pending display/focus styles. Never cache a new state under stale styles.
 function ready(root){
  var nodes=Array.from(root.querySelectorAll('*'));nodes.unshift(root);
  for(var n of nodes){var inline=n.style,s=null;
   if(inline.display){s=g.getComputedStyle(n);if(s.display!==inline.display)return false;}
   if(n.hasAttribute('data-selected')&&inline.borderTopColor){s=s||g.getComputedStyle(n);if(String(rgba(s.borderTopColor,1))!==String(rgba(inline.borderTopColor,1)))return false;}
  }return true;
 }
 g.CivNanoVGScene={snapshot:snapshot,intersect:intersect,ready:ready,pixels:pixels,lineHeight:lineHeight,fitLine:fitLine,wrapWords:wrapWords};
})(typeof window!=='undefined'?window:globalThis);
