"""Generated consumer helper for civapps-native-ui releases. Standard library only."""
from pathlib import Path
import hashlib
import json


def verify(root):
    root = Path(root)
    lock = json.loads((root / 'civapps-native-ui.lock.json').read_text())
    if lock['name'] != 'civapps-native-ui' or lock['api'] != 1:
        raise ValueError('Unsupported CivApps native UI dependency')
    for name, digest in lock['sha256'].items():
        path = (root / name).resolve()
        path.relative_to(root.resolve())
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('CivApps native UI release checksum mismatch: ' + name)
    return lock
