"""Exercise a moved source checkout and an offline consumer pin."""
from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseTests(unittest.TestCase):
    def test_moved_checkout_is_reproducible_and_consumer_rejects_corruption(self):
        with tempfile.TemporaryDirectory(prefix='civapps-library-') as temp:
            moved = Path(temp) / 'independent-repo'
            shutil.copytree(ROOT, moved, ignore=shutil.ignore_patterns('build', 'dist', 'toolchains', '__pycache__', '.git'))
            consumer = Path(temp) / 'app'
            consumer.mkdir()
            requirements = dict(api=1, library='civapps-native-ui', version='1.0.0',
                                minVersion='1.2.0', capabilities=['framebuffer'])
            (consumer / 'payload.json').write_text(json.dumps(dict(extensions=dict(nativeUi=requirements))))
            command = ['python3', '-B', str(moved / 'tools/release.py')]
            subprocess.run(command + ['--install', str(consumer)], check=True, capture_output=True)
            version = json.loads((moved / 'package.json').read_text())['version']
            installed = json.loads((consumer / 'payload.json').read_text())['extensions']['nativeUi']
            self.assertEqual(installed, dict(requirements, version=version))
            for name in ['civhomebrew-sdk.js','civapps-native-ui.js']:
                (moved/'dist'/version/name).read_bytes().decode('ascii')
            filename = 'civhomebrew-sdk-' + version + '.tar.gz'
            archive = moved / 'dist' / filename
            expected = hashlib.sha256((ROOT / 'dist' / filename).read_bytes()).hexdigest()
            self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), expected)
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), expected)
            spec = importlib.util.spec_from_file_location('consumer_pin', consumer / 'tools/civapps_native_ui.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.assertEqual(module.verify(consumer)['version'], version)
            runtime = consumer / 'app/vendor/native-ui-runtime.js'
            runtime.write_bytes(runtime.read_bytes() + b'\n/* changed */\n')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                module.verify(consumer)
            source = moved / 'src/scene.js'
            source.write_bytes(source.read_bytes() + b'\n/* renderer fix needs a new release */\n')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('increment package.json version', result.stderr)


if __name__ == '__main__':
    unittest.main()
