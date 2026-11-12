#!/usr/bin/env python3
"""Send ordered JS sources to an idle CivSwitch loader; preserve app lifetime."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import sys
import time

LIMIT = 500 * 1024
STATE = "__civswitchStagedApp"


def build_payload(paths):
    parts = [Path(path).read_bytes() for path in paths]
    payload = b"\n;\n".join(parts)
    if not payload.decode("utf-8").strip():
        raise ValueError("No JavaScript source supplied")
    return payload


def plan_upload(payload):
    """Return finite staging scripts and the final direct-eval launch payload."""
    source = payload.decode("utf-8")
    if not source.strip():
        raise ValueError("Empty JavaScript payload")
    if len(payload) < LIMIT:
        return [], payload
    digest = hashlib.sha256(payload).hexdigest()
    parts = []
    for offset in range(0, len(source), 100000):
        piece = source[offset:offset + 100000]
        if len(json.dumps(piece).encode("ascii")) > 450000:
            parts.extend(piece[i:i + 30000] for i in range(0, len(piece), 30000))
        else:
            parts.append(piece)
    expected_length = len(source.encode("utf-16-le")) // 2
    stage = "window." + STATE
    uploads = []
    for index, piece in enumerate(parts):
        if index == 0:
            metadata = {"id": digest, "count": len(parts), "length": expected_length, "parts": []}
            script = stage + "=" + json.dumps(metadata) + ";\n"
        else:
            script = ("if(!" + stage + "||" + stage + ".id!==" + json.dumps(digest) + "||" +
                      stage + ".parts.length!==" + str(index) + ")throw Error('App staging mismatch');\n")
        script += stage + ".parts.push(" + json.dumps(piece) + ");\n"
        script += "log('CIVSWITCH_STAGE " + str(index + 1) + "/" + str(len(parts)) + "');"
        data = script.encode("ascii")
        if len(data) >= LIMIT:
            raise ValueError("Staging script exceeds the loader limit")
        uploads.append(data)
    final = ("(async function(){var staged=" + stage + ";delete " + stage + ";"
             "if(!staged||staged.id!==" + json.dumps(digest) + "||staged.parts.length!==staged.count)"
             "throw Error('Incomplete app upload');"
             "var source=staged.parts.join('');staged.parts.length=0;"
             "if(source.length!==staged.length)throw Error('App upload length mismatch');"
             "return await eval(source);})();").encode("ascii")
    return uploads, final


def _write(output, data):
    output.write(data)
    output.flush()


def send_stage(host, port, payload, output, timeout=60):
    if len(payload) >= LIMIT:
        raise ValueError("Payload exceeds the loader limit")
    with socket.create_connection((host, port), timeout=10) as connection:
        connection.settimeout(1)
        connection.sendall(payload)
        connection.shutdown(socket.SHUT_WR)
        deadline = time.monotonic() + timeout
        tail = b""
        completed = failed = False
        while time.monotonic() < deadline:
            try:
                data = connection.recv(4096)
            except socket.timeout:
                continue
            if not data:
                break
            _write(output, data)
            scan = tail + data
            completed = completed or b"Executed successfully" in scan
            failed = failed or b"Error in payload:" in scan or b"ERROR in accept loop:" in scan
            tail = scan[-1024:]
        if not completed or failed:
            raise RuntimeError("Stage did not complete successfully; stop and inspect the console/log before retrying")


def launch(host, port, payload, output):
    """No completion timeout: a UI intentionally keeps its eval pending."""
    if len(payload) >= LIMIT:
        raise ValueError("Launch payload exceeds the loader limit")
    with socket.create_connection((host, port), timeout=10) as connection:
        connection.settimeout(None)
        connection.sendall(payload)
        connection.shutdown(socket.SHUT_WR)
        tail = b""
        completed = failed = False
        while True:
            data = connection.recv(4096)
            if not data:
                break
            _write(output, data)
            scan = tail + data
            completed = completed or b"Executed successfully" in scan
            failed = failed or b"Error in payload:" in scan or b"ERROR in accept loop:" in scan
            tail = scan[-1024:]
        if not completed or failed:
            raise RuntimeError("App session ended without successful completion; inspect the console before another upload")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("console_ip", help="Console address; CivSwitch must be waiting for a payload")
    parser.add_argument("sources", nargs="+", type=Path, help="JS files in evaluation order; app entry point last")
    parser.add_argument("--port", type=int, default=9026)
    parser.add_argument("--stage-timeout", type=float, default=60, help="Finite upload-stage timeout in seconds")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 0 < args.stage_timeout <= 3600:
        parser.error("Port must be 1–65535 and stage timeout must be greater than zero and at most 3600")
    try:
        stages, final = plan_upload(build_payload(args.sources))
        for payload in stages:
            send_stage(args.console_ip, args.port, payload, sys.stdout.buffer, args.stage_timeout)
        print("Starting app. Keep this terminal open; use the app's close action to return to the loader.", flush=True)
        launch(args.console_ip, args.port, final, sys.stdout.buffer)
    except KeyboardInterrupt:
        print("\nSender stopped. The app may still be running; close it on the console before another upload.")
    except (OSError, UnicodeError, ValueError, RuntimeError) as error:
        parser.exit(1, "Upload stopped: " + str(error) + "\n")


if __name__ == "__main__":
    main()
