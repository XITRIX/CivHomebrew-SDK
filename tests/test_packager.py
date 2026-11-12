import base64
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import struct
import zlib
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
import package_payload as packager
import package_payload as pm


class PackagerTests(unittest.TestCase):
    def test_wire_uses_ascii_escapes_without_changing_unicode_sources(self):
        value = {'name': 'Doom × 雪 😀', 'source': 'var message="雪 😀";\n'}
        raw = packager.wire_json(value)
        self.assertTrue(raw.isascii())
        self.assertIn(b'\\u96ea', raw)
        self.assertEqual(json.loads(raw), value)

    def test_large_v1_data_script_remains_standard(self):
        package = {'format':'civswitch-app', 'version':1, 'id':'large-data', 'name':'Large data',
                   'scripts':[{'name':'data.js', 'source':'var data="'+'A'*(9*1024*1024)+'";'}]}
        self.assertIs(packager.validate(package), package)
        self.assertEqual(packager.MAX_SOURCE, 32*1024*1024)
        self.assertEqual(packager.MAX_FRAME, 48*1024*1024)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root/'app.js').write_text('(async function(){return 42;})();', encoding='utf-8')
        (self.root/'lib.js').write_text('var greeting="雪";', encoding='utf-8')

    def flags(self):
        return [str(self.root), '--non-interactive', '--id', 'test-app', '--name', 'Test App',
                '--creator', 'Test Creator', '--version', '1.2.3', '--description', 'Example',
                '--api', '1', '--script', 'lib.js', '--script', 'app.js']

    def run_tool(self, flags):
        with contextlib.redirect_stdout(io.StringIO()):
            return packager.main(flags)

    def test_all_settings_from_ci_and_deterministic_manifest_reuse(self):
        # A self-contained 256x256 PNG keeps SDK tests independent of app assets.
        def chunk(kind, data):
            return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data))
        icon = (b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', 256, 256, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress((b'\0'+b'\0'*1024)*256))
                + chunk(b'IEND', b''))
        (self.root/'logo.png').write_bytes(icon)
        output = self.root/'result.civapp'
        self.assertEqual(self.run_tool(self.flags()+['--icon', 'logo.png', '-o', str(output)]), 0)
        package = pm.read_package(output)
        self.assertEqual(package['metadata'], {'author':'Test Creator','release':'1.2.3','description':'Example','api':1})
        self.assertEqual([s['name'] for s in package['scripts']], ['lib.js','app.js'])
        self.assertEqual(base64.b64decode(package['icon'][22:]), icon)
        before = output.read_bytes()
        self.assertEqual(self.run_tool([str(self.root), '--non-interactive', '-o', str(output)]), 0)
        self.assertEqual(output.read_bytes(), before)

    def test_wizard_prompts_and_saves_reusable_metadata_without_generated_art(self):
        answers = [str(self.root), 'Sample App', '', 'Creator', '0.1.0', '', '', 'lib.js,app.js', 'yes']
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', side_effect=answers) as prompt:
            self.assertEqual(self.run_tool([]), 0)
        self.assertEqual(prompt.call_count, len(answers))
        manifest = json.loads((self.root/'payload.json').read_text())
        self.assertEqual(manifest['id'], 'sample-app')
        self.assertIsNone(manifest['icon'])
        self.assertFalse((self.root/'icon.png').exists())
        self.assertEqual(pm.read_package(self.root/'dist/sample-app.civapp')['icon'], '')
        # Reusing an explicit no-icon decision never prompts again.
        self.assertEqual(self.run_tool([str(self.root), '--non-interactive']), 0)

    def test_generic_extensions_are_packaged_and_reused_without_provider_coupling(self):
        extensions = {'updates': {'schema': 1, 'releasesUrl': 'https://github.com/test/app/releases/latest', 'asset': 'app.civapp'}, 'future': {'labels': ['雪', True, None]}}
        self.run_tool(self.flags()+['--no-icon'])
        manifest_path = self.root/'payload.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['extensions'] = extensions
        manifest_path.write_text(json.dumps(manifest))
        self.run_tool([str(self.root), '--non-interactive'])
        self.assertEqual(pm.read_package(self.root/'dist/test-app.civapp')['metadata']['extensions'], extensions)
        self.assertEqual(json.loads(manifest_path.read_text())['extensions'], extensions)
        for value in ([], None, {'x': 'x'*17000}, {'x': float('inf')}, {'__proto__': 1}):
            with self.assertRaises(ValueError):
                packager.validate_extensions(value)

    def test_update_extension_survives_standalone_packaging_and_manifest_reuse(self):
        self.run_tool(self.flags()+['--no-icon'])
        path = self.root/'payload.json'
        manifest = json.loads(path.read_text())
        extensions = {'updates': {'schema': 1, 'releasesUrl': 'https://github.com/test/app/releases/latest',
                                  'asset': 'app.civapp'}, 'future': {'label': '雪'}}
        manifest['extensions'] = extensions
        path.write_text(json.dumps(manifest))
        self.run_tool([str(self.root), '--non-interactive'])
        output = self.root/'dist/test-app.civapp'
        self.assertEqual(pm.read_package(output)['metadata']['extensions'], extensions)
        self.assertEqual(json.loads(path.read_text())['extensions'], extensions)
        manifest['extensions'] = {'constructor': {}}
        path.write_text(json.dumps(manifest))
        previous = output.read_bytes()
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_tool([str(self.root), '--non-interactive'])
        self.assertEqual(output.read_bytes(), previous)

    def test_update_cli_overrides_reuses_and_disables_without_losing_other_extensions(self):
        self.run_tool(self.flags()+['--no-icon'])
        manifest_path = self.root/'payload.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['extensions'] = {'future': {'label': '雪'}}
        manifest_path.write_text(json.dumps(manifest))
        flags = [str(self.root), '--non-interactive', '--releases-url',
                 'https://github.com/test/app/releases/latest/', '--update-asset', 'app.civapp']
        self.run_tool(flags)
        output = self.root/'dist/test-app.civapp'
        metadata = pm.read_package(output)['metadata']
        self.assertEqual(metadata['extensions']['updates'], {'schema': 1, 'releasesUrl': 'https://github.com/test/app/releases/latest', 'asset': 'app.civapp'})
        self.assertEqual(metadata['extensions']['future'], {'label': '雪'})
        before = manifest_path.read_bytes()
        self.run_tool([str(self.root), '--non-interactive', '--update-asset', '', '--no-save-metadata'])
        self.assertNotIn('asset', pm.read_package(output)['metadata']['extensions']['updates'])
        self.assertEqual(manifest_path.read_bytes(), before)
        self.run_tool([str(self.root), '--non-interactive', '--no-updates'])
        self.assertIsNone(pm.read_package(output)['metadata']['extensions']['updates'])
        self.assertEqual(pm.read_package(output)['metadata']['extensions']['future'], {'label': '雪'})
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', side_effect=AssertionError('saved choice must not prompt')):
            self.run_tool([str(self.root)])

    def test_update_wizard_remembers_url_and_asset(self):
        answers = [str(self.root), 'Sample App', '', 'Creator', '1.2.3', '',
                   'https://github.com/test/app/releases/latest', 'sample.civapp', 'lib.js,app.js', 'yes']
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', side_effect=answers):
            self.run_tool([])
        updates = pm.read_package(self.root/'dist/sample-app.civapp')['metadata']['extensions']['updates']
        self.assertEqual(updates['asset'], 'sample.civapp')
        self.assertEqual(updates['releasesUrl'], 'https://github.com/test/app/releases/latest')

    def test_invalid_update_settings_never_publish_or_modify_metadata(self):
        self.run_tool(self.flags()+['--no-icon'])
        manifest_path = self.root/'payload.json'
        output = self.root/'dist/test-app.civapp'
        before, package_before = manifest_path.read_bytes(), output.read_bytes()
        for extra in [
            ['--update-asset', 'app.civapp'],
            ['--releases-url', 'http://github.com/test/app/releases/latest'],
            ['--releases-url', 'https://github.com.evil/test/app/releases/latest'],
            ['--releases-url', 'https://github.com/test/../releases/latest'],
            ['--releases-url', 'https://github.com/test/app/releases/latest', '--update-asset', '../app.civapp'],
            ['--no-updates', '--update-asset', 'app.civapp'],
        ]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.run_tool([str(self.root), '--non-interactive']+extra)
            self.assertEqual(manifest_path.read_bytes(), before)
            self.assertEqual(output.read_bytes(), package_before)
        for updates in [{'schema': True, 'releasesUrl': 'https://github.com/test/app/releases/latest'},
                        {'schema': 2}, {'schema': 1, 'releasesUrl': 'https://github.com/test/app/releases/latest', 'asset': ''}]:
            with self.assertRaises(ValueError):
                packager.validate_updates(updates)

    def test_missing_icon_requires_explicit_ci_decision_and_decline_changes_nothing(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            self.run_tool(self.flags())
        self.assertEqual(error.exception.code, 1)
        self.assertFalse((self.root/'payload.json').exists())
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='no'):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.run_tool([s for s in self.flags() if s != '--non-interactive'])
        self.assertFalse((self.root/'dist').exists())

    def test_read_only_ci_override_preserves_manifest_and_emits_no_art(self):
        self.run_tool(self.flags()+['--no-icon'])
        before = (self.root/'payload.json').read_bytes()
        self.run_tool([str(self.root), '--non-interactive', '--version', '2.0.0', '--no-icon', '--no-save-metadata'])
        self.assertEqual((self.root/'payload.json').read_bytes(), before)
        self.assertEqual(pm.read_package(self.root/'dist/test-app.civapp')['metadata']['release'], '2.0.0')
        self.assertFalse((self.root/'icon.png').exists())

    def test_partial_manifest_unknown_fields_preserved_and_missing_fields_prompted(self):
        (self.root/'payload.json').write_text(json.dumps({'name':'Existing','id':'existing','scripts':['app.js'],'icon':None,'source':'https://example.com'}))
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', side_effect=['Creator','3.0','','']) as prompt:
            self.run_tool([str(self.root)])
        self.assertEqual(prompt.call_count, 4)
        manifest = json.loads((self.root/'payload.json').read_text())
        self.assertEqual(manifest['source'], 'https://example.com')
        self.assertEqual(manifest['release'], '3.0')

    def test_invalid_inputs_do_not_modify_source_or_output(self):
        for flags in [self.flags()+['--no-icon','--script','../escape.js'],
                      self.flags()+['--icon','missing.png'],
                      self.flags()+['--no-icon','--name',''],
                      self.flags()+['--no-icon','--id','../bad']]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.run_tool(flags)
            self.assertFalse((self.root/'payload.json').exists())
            self.assertFalse((self.root/'dist').exists())

    def test_non_tty_cli_fails_fast_without_waiting_for_input(self):
        result = subprocess.run([sys.executable, '-B', str(ROOT/'tools/package_payload.py'), str(self.root)],
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn('--name', result.stderr)

    def test_symlink_escape_rejected_before_publishing(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside)/'secret.js'
            target.write_text('var privateData = 1;', encoding='utf-8')
            (self.root/'escape.js').symlink_to(target)
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.run_tool(self.flags()+['--no-icon', '--script', 'escape.js'])
        self.assertFalse((self.root/'payload.json').exists())
        self.assertFalse((self.root/'dist').exists())

    def test_inspect_cli_validates_packages_and_rejects_corruption(self):
        self.run_tool(self.flags()+['--no-icon'])
        output = self.root/'dist/test-app.civapp'
        command = [sys.executable, '-B', str(ROOT/'tools/package_payload.py'), '--inspect', str(output)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Scripts: lib.js, app.js', result.stdout)
        package = json.loads(output.read_text())
        package['scripts'][0]['name'] = '../escape.js'
        output.write_text(json.dumps(package))
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Invalid or duplicate script name', result.stderr)

    def test_single_copied_file_runs_in_unrelated_repository_without_imports(self):
        standalone = self.root/'ci/package_payload.py'
        standalone.parent.mkdir()
        standalone.write_bytes((ROOT/'tools/package_payload.py').read_bytes())
        output = self.root/'artifacts/example.civapp'
        command = [sys.executable, '-I', '-B', str(standalone)]
        flags = self.flags()+['--no-icon', '--no-save-metadata', '--releases-url', 'https://github.com/test/app/releases/latest', '--update-asset', 'app.civapp', '-o', str(output)]
        result = subprocess.run(command+flags, cwd=standalone.parent,
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root/'payload.json').exists())
        package = json.loads(output.read_text())
        self.assertEqual(package['id'], 'test-app')
        self.assertEqual(package['metadata']['extensions']['updates']['asset'], 'app.civapp')
        self.assertEqual([script['name'] for script in package['scripts']], ['lib.js', 'app.js'])
        self.assertEqual(package['scripts'][0]['source'], 'var greeting="雪";')
        result = subprocess.run(command+['--inspect', str(output)], cwd=standalone.parent,
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Test App', result.stdout)


if __name__ == '__main__':
    unittest.main()
