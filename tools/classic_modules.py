"""Compile the reviewed classic-JS module subset for CivHomebrew SDK consumers."""
import json
import re


def compile_graph(source, entries, stubs):
    factories = dict(stubs)
    def visit(name):
        if name in factories:
            return
        file = source / name
        if file.suffix == '.json':
            factories[name] = 'return {default:' + json.dumps(json.loads(file.read_text()), separators=(',', ':')) + '};'
            return
        text = file.read_text()
        factories[name] = ''  # Cycle guard; this selected graph has no runtime cycles.

        def dependency(match):
            binding, target = match[1].strip(), match[2]
            if not target.startswith('node:'):
                target = str((file.parent / target).resolve().relative_to(source))
            visit(target)
            req = '__require(' + json.dumps(target) + ')'
            if binding.startswith('* as '):
                return 'const ' + binding[5:] + '=' + req + ';'
            if binding.startswith('{'):
                binding = re.sub(r'\b(\w+)\s+as\s+(\w+)\b', r'\1:\2', binding)
                return 'const ' + binding + '=' + req + ';'
            if not re.fullmatch(r'\w+', binding):
                raise ValueError(f'Unsupported import: {binding}')
            return 'const ' + binding + '=' + req + '.default;'

        text = re.sub(r'^import\s+([^;]+?)\s+from\s+[\'"]([^\'"]+)[\'"](?:\s+with\s*\{[^}]+\})?;', dependency, text, flags=re.M)
        exports = {}

        def declaration(match):
            exports[match[2]] = match[2]
            return match[1] + ' ' + match[2]

        text = re.sub(r'\bexport\s+((?:async\s+)?function|const|let|var|class)\s+(\w+)', declaration, text)

        def export_list(match):
            for item in match[1].split(','):
                if item.strip():
                    parts = re.split(r'\s+as\s+', item.strip())
                    exports[parts[-1]] = parts[0]
            return ''

        text = re.sub(r'\bexport\s*\{([^}]+)\};', export_list, text)
        if re.search(r'^\s*(?:import|export)\s', text, re.M):
            raise ValueError(f'Unsupported module syntax: {name}')
        text = text.replace('Object.hasOwn(', 'Object.prototype.hasOwnProperty.call(')
        factories[name] = text + '\nreturn {' + ','.join(k + ':' + v for k, v in exports.items()) + '};'

    for name in entries:
        visit(name)
    return factories
