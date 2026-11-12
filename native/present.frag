#version 450
layout(set=0,binding=1,std430) readonly buffer Output {uint pixels[];};
layout(location=0) out vec4 color;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);color=unpackUnorm4x8(pixels[p.y*1920+p.x]);}
