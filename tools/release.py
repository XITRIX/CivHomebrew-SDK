#!/usr/bin/env python3
"""Create a deterministic release from checked source and generated dependencies.

Use --install APP_ROOT to pin a release into a consumer. Consumers build offline
from those verified bytes; they never need the library checkout or a sibling app.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import io
import json
import tarfile

ROOT = Path(__file__).resolve().parents[1]
MODULES = ([('src', n) for n in ['bytes', 'stack', 'context']] +
           [('vendor', n) for n in ['civ-vulkan', 'nanovg', 'nanovg-assets', 'nanovg-shaders']] +
           [('src', n) for n in ['scene', 'geometry', 'vulkan', 'prototype', 'session', 'web']])


def build():
    package = json.loads((ROOT / 'package.json').read_text())
    version = package['version']
    # Refuse silent changes to generated inputs or pinned upstream sources.
    generated = json.loads((ROOT / 'vendor/manifest.json').read_text())
    for name, digest in generated['sha256'].items():
        if hashlib.sha256((ROOT / 'vendor' / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Rebuild changed generated dependency: ' + name)
    for name, digest in generated['inputs'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Generated native UI dependencies are stale; run npm run build: ' + name)
    for dependency in ['nanovg', 'civ-vulkan', 'source-code-pro']:
        base = ROOT / 'third_party' / dependency
        for name, digest in json.loads((base / 'SOURCE.json').read_text())['sha256'].items():
            if hashlib.sha256((base / name).read_bytes()).hexdigest() != digest:
                raise ValueError('Pinned upstream source changed: ' + name)
    source = '''/* civapps-native-ui VERSION; GPL-3.0-or-later; see NOTICE.txt. */
(function(g){"use strict";
var version=VERSION_JSON,existing=g.CivAppsNativeUI;
if(existing){
 if(existing.api!==1||existing.version!==version||existing.sessions!==g.CivNanoVGSession)
  throw Error('CivApps native UI version mismatch; update the Launcher and app together, then restart Civ VII');
 return;
}
if(g.CivNanoVGSession||g.__civNanoVGVulkan)
 throw Error('Update the native Launcher and restart Civ VII before loading CivApps native UI');
'''.replace('VERSION_JSON', json.dumps(version)).replace('VERSION', version)
    hashes = {}
    for directory, name in MODULES:
        path = ROOT / directory / (name + '.js')
        text = path.read_text()
        # Emscripten emits whitespace-only lines; preserve code and literals.
        if name == 'nanovg':
            text = '\n'.join('' if not line.strip() else line for line in text.splitlines()) + '\n'
        hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
        source += '\n;/* CIVAPPS_MODULE ' + name + ' */\n' + text + '\n;/* CIVAPPS_MODULE_END ' + name + ' */\n'
    source += '''g.CivAppsNativeUI=Object.freeze({name:'civapps-native-ui',api:1,version:version,
 sessions:g.CivNanoVGSession,views:g.CivNanoVGPrototype,scene:g.CivNanoVGScene,
 geometry:g.CivNanoVGGeometry,web:g.CivNanoVGWeb});
})(typeof window!=="undefined"?window:globalThis);
'''
    notices = 'civapps-native-ui ' + version + '\nGPL-3.0-or-later\n\n'
    notices += (ROOT / 'PROVENANCE.json').read_text() + '\n' + (ROOT / 'LICENSE').read_text()
    for name in ['nanovg/LICENSE.txt', 'nanovg/Roboto-LICENSE.txt', 'source-code-pro/LICENSE.md', 'civ-vulkan/LICENSE']:
        notices += '\n\n' + name + '\n' + (ROOT / 'third_party' / name).read_text()
    contents = {'civapps-native-ui.js': source.encode(), 'NOTICE.txt': notices.encode(),
                'consume.py': (ROOT / 'tools/consume.py').read_bytes(),
                'install.py': Path(__file__).read_bytes(),
                'README.txt': ('CivHomebrew-SDK '+version+'\nInstall: python3 install.py --from-release . --install /path/to/app\nSource: https://github.com/XITRIX/CivHomebrew-SDK/tree/v'+version+'\n').encode()}
    for path in sorted((ROOT / 'testing').iterdir()):
        if path.is_file():
            contents['testing/' + path.name] = path.read_bytes()
    manifest = dict(name='civapps-native-ui', version=version, api=1,
                    sdk=dict(name='CivHomebrew-SDK', repository=package['repository']['url'], ref='v'+version), sources=hashes,
                    sha256={name: hashlib.sha256(data).hexdigest() for name, data in contents.items()})
    contents['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    out = ROOT / 'dist' / version
    out.mkdir(parents=True, exist_ok=True)
    for name, data in contents.items():
        path = out / name
        if path.exists() and path.read_bytes() != data:
            raise ValueError('Release ' + version + ' already exists with different bytes; increment package.json version')
    for name, data in contents.items():
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    archive = ROOT / 'dist' / ('civhomebrew-sdk-' + version + '.tar.gz')
    with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, data in sorted(contents.items()):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
    source_archive = ROOT / 'dist' / ('civhomebrew-sdk-source-' + version + '.tar.gz')
    roots = ['.gitignore', 'AGENTS.md', 'LICENSE', 'PROVENANCE.json', 'README.md', 'package.json',
             'assets', 'native', 'src', 'vendor', 'third_party', 'tools', 'testing', 'tests']
    source_files = []
    for name in roots:
        path = ROOT / name
        source_files.extend([path] if path.is_file() else path.rglob('*'))
    with source_archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for path in sorted(source_files):
                if not path.is_file() or '__pycache__' in path.parts or path.suffix == '.pyc':
                    continue
                data = path.read_bytes()
                info = tarfile.TarInfo(str(path.relative_to(ROOT)))
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
    print('Source', source_archive, hashlib.sha256(source_archive.read_bytes()).hexdigest())
    print('Built', archive, hashlib.sha256(archive.read_bytes()).hexdigest())
    return out


def install(release, consumer):
    consumer = consumer.resolve()
    manifest = json.loads((release / 'manifest.json').read_text())
    targets = {'civapps-native-ui.js': 'app/vendor/native-ui-runtime.js',
               'NOTICE.txt': 'app/vendor/civapps-native-ui-NOTICE.txt',
               'consume.py': 'tools/civapps_native_ui.py'}
    targets.update({name: 'tools/civapps-native-ui/' + Path(name).name
                    for name in manifest['sha256'] if name.startswith('testing/')})
    verified = {}
    # Validate all inputs before replacing any consumer file.
    for name in targets:
        data = (release / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest['sha256'][name]:
            raise ValueError('Release checksum mismatch: ' + name)
        verified[name] = data
    lock = {k: manifest[k] for k in ['name', 'version', 'api', 'sdk']}
    lock['sha256'] = {}
    for name, target in targets.items():
        path = consumer / target
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(verified[name])
        lock['sha256'][target] = manifest['sha256'][name]
    (consumer / 'civapps-native-ui.lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    print('Pinned', manifest['name'], manifest['version'], 'in', consumer)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', type=Path, action='append', default=[])
    parser.add_argument('--from-release', type=Path, help='Install an already extracted release directory without a source build')
    args = parser.parse_args()
    release = args.from_release or build()
    for consumer in args.install:
        install(release, consumer)
