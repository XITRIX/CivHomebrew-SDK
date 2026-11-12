#!/usr/bin/env python3
"""Build pinned NanoVG as plain JS plus Vulkan/WebGL parity shaders. No network."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT/'build/nanovg'
OUT = ROOT/'vendor'
BUILD.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
sdk = Path(os.environ.get('CIV_EMSDK', ROOT/'toolchains/emsdk'))
env = dict(os.environ, EM_CONFIG=str(sdk/'.emscripten'), EM_CACHE=str(BUILD/'em-cache'))
emcc = sdk/'upstream/emscripten/emcc'
version = subprocess.check_output([str(emcc),'--version'],env=env,text=True).splitlines()[0]
if '3.1.74' not in version: raise SystemExit('Expected Emscripten 3.1.74')
for directory in ['nanovg','civ-vulkan','source-code-pro']:
    p=ROOT/'third_party'/directory
    for name,digest in json.loads((p/'SOURCE.json').read_text())['sha256'].items():
        if hashlib.sha256((p/name).read_bytes()).hexdigest()!=digest:
            raise SystemExit(f'Pinned source changed: {directory}/{name}')
# Preserve upstream files. Only the explicitly named monospace face uses
# fractional advances, avoiding cumulative rounding drift across 146 columns.
port=BUILD/'c-source';port.mkdir(exist_ok=True)
shutil.copyfile(ROOT/'third_party/nanovg/nanovg.c',port/'nanovg.c')
fontstash=(ROOT/'third_party/nanovg/fontstash.h').read_text()
advance='*x += (int)(glyph->xadv / 10.0f + 0.5f);'
if fontstash.count(advance)!=1:raise SystemExit('Fontstash advance patch anchor changed')
fontstash=fontstash.replace(advance,'*x += strcmp(font->name, "mono")==0 ? glyph->xadv / 10.0f : (int)(glyph->xadv / 10.0f + 0.5f);')
advance_store='glyph->xadv = (short)(scale * advance * 10.0f);'
if fontstash.count(advance_store)!=1:raise SystemExit('Fontstash glyph advance anchor changed')
fontstash=fontstash.replace(advance_store,'glyph->xadv = (short)(scale * advance * 10.0f + (strcmp(font->name, "mono")==0 ? 0.5f : 0.0f));')
(port/'fontstash.h').write_text(fontstash)
exports=['malloc','free','civ_init','civ_font','civ_image','civ_begin','civ_clip','civ_color','civ_rect','civ_triangle','civ_border','civ_picture','civ_text','civ_measure','civ_metrics','civ_end','civ_draws','civ_tris','civ_draw_count','civ_tri_count','civ_failed','civ_close']
subprocess.run([str(emcc),'-O3','-flto',str(port/'nanovg.c'),str(ROOT/'native/capture.c'),'-I'+str(ROOT/'third_party/nanovg'),'-sWASM=0','-sSINGLE_FILE=1','-sMODULARIZE=1','-sEXPORT_NAME=CivNanoVGFactory','-sENVIRONMENT=web,shell','-sFILESYSTEM=0','-sINITIAL_MEMORY=33554432','-sALLOW_MEMORY_GROWTH=0','-sSTACK_SIZE=2097152','-sEXPORTED_FUNCTIONS='+json.dumps(['_'+n for n in exports]),'-o',str(OUT/'nanovg.js')],env=env,check=True)
# Direct eval inside the resident loader retains var locally; it does not turn
# Emscripten's EXPORT_NAME into a window property. Export in this same script.
with (OUT/'nanovg.js').open('a') as output:
    output.write('\n;(function(g){g.CivNanoVGFactory=CivNanoVGFactory;})(typeof window!=="undefined"?window:globalThis);\n')
fontNames=['Roboto-Regular.ttf','Roboto-Bold.ttf','SourceCodePro-Regular.ttf']
fontPaths=[ROOT/'third_party/nanovg'/n for n in fontNames[:2]]+[ROOT/'third_party/source-code-pro'/fontNames[2]]
assets={p.name:base64.b64encode(p.read_bytes()).decode() for p in fontPaths}
metrics=[]
for path in fontPaths:
    raw=path.read_bytes()
    tables={raw[12+i*16:16+i*16].decode():struct.unpack_from('>II',raw,20+i*16) for i in range(struct.unpack_from('>H',raw,4)[0])}
    units=struct.unpack_from('>H',raw,tables['head'][0]+18)[0]
    ascent,descent,gap=struct.unpack_from('>hhh',raw,tables['hhea'][0]+4)
    metrics.append([ascent/units,descent/units,(ascent-descent+gap)/units])
for path in sorted((ROOT/'assets').glob('button-*.png')): assets[path.name]=base64.b64encode(path.read_bytes()).decode()
licenses={name:(ROOT/'third_party'/name).read_text() for name in ['nanovg/LICENSE.txt','nanovg/Roboto-LICENSE.txt','civ-vulkan/LICENSE','source-code-pro/LICENSE.md']}
(OUT/'nanovg-assets.js').write_text('/* Generated fonts, button artwork and redistribution notices. */\nwindow.CivNanoVGAssets='+json.dumps(assets,separators=(',',':'))+';\nwindow.CivNanoVGFontMetrics='+json.dumps(metrics)+';\nwindow.CivNanoVGLicenses='+json.dumps(licenses)+';\n')
subprocess.run(['python3',str(ROOT/'tools/build-vulkan.py')],check=True)
glslang=shutil.which('glslangValidator') or '/opt/homebrew/bin/glslangValidator'
common=(ROOT/'native/raster.glsl').read_text()
shaders={}
for name in ['bin.comp','raster.comp','present.vert','present.frag']:
    source=(ROOT/'native'/name).read_text().replace('/*COMMON*/',common)
    file=BUILD/name;file.write_text(source)
    subprocess.run([glslang,'-V','--target-env','vulkan1.0',str(file),'-o',str(file)+'.spv'],check=True)
    shaders[name]=(Path(str(file)+'.spv').read_bytes()).hex()
web='#version 300 es\nprecision highp float;precision highp int;precision highp usampler2D;\nuniform usampler2D uData,uBins;\nuniform int uWidth,uHeight;\nout vec4 color;\n#define NATIVE_BINS\nconst int BIN_CAPACITY=128,BIN_STRIDE=897;\nuint word(int i){return texelFetch(uData,ivec2(i%1024,i/1024),0).r;}\nuint bin(int i){return texelFetch(uBins,ivec2(i%1024,i/1024),0).r;}\n'+common+'\nvoid main(){color=raster(vec2(gl_FragCoord.x,float(uHeight)-gl_FragCoord.y));}\n'
(OUT/'nanovg-shaders.js').write_text('/* Generated from native/; native SPIR-V and shared browser oracle. */\nwindow.CivNanoVGShaders='+json.dumps({'spirv':shaders,'web':web},separators=(',',':'))+';\n')
manifest={'transforms':{'monoFractionalAdvance':2},'compiler':version,'nanovg':json.loads((ROOT/'third_party/nanovg/SOURCE.json').read_text())['commit'],'sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.glob('*.js'))}}
manifest['inputs']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(list((ROOT/'native').glob('*'))+list((ROOT/'assets').glob('*'))+[ROOT/'tools/build.py',ROOT/'tools/build-vulkan.py']) if p.is_file()}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(BUILD/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Built actual wasm2js NanoVG and four SPIR-V shaders; no Wasm/Workers required.')

subprocess.run(['python3', str(ROOT/'tools/release.py')], check=True)
