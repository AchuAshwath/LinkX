#!/usr/bin/env python3
"""Run CodeScene delta analysis via local cs-mcp server to verify Code Health quality gates."""

import json
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CS_MCP_BIN = "/opt/homebrew/bin/cs-mcp"


def check_codescene(*, base_ref: str = "origin/master") -> int:
    if not os.path.exists(CS_MCP_BIN):
        print(f"Error: CodeScene MCP binary not found at {CS_MCP_BIN}")
        return 1

    proc = subprocess.Popen(
        [CS_MCP_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    def send_rpc(msg: dict) -> None:
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    # Initialize MCP
    send_rpc(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "linkx-check", "version": "1.0"},
            },
        }
    )

    assert proc.stdout is not None
    for line in proc.stdout:
        if line.strip().startswith("{"):
            if json.loads(line.strip()).get("id") == 1:
                break

    # Call analyze_change_set
    send_rpc(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "analyze_change_set",
                "arguments": {
                    "base_ref": base_ref,
                    "git_repository_path": REPO_ROOT,
                },
            },
        }
    )

    result_data = None
    for line in proc.stdout:
        if line.strip().startswith("{"):
            payload = json.loads(line.strip())
            if payload.get("id") == 2:
                raw_text = payload["result"]["content"][0]["text"]
                json_start = raw_text.find("{")
                result_data = json.loads(raw_text[json_start:])
                break

    proc.kill()

    if not result_data:
        print("Error: No analysis data received from CodeScene MCP")
        return 1

    results = result_data.get("results", [])
    quality_gates = result_data.get("quality_gates")
    degraded_files = [f for f in results if f.get("verdict") == "degraded"]

    if not degraded_files and quality_gates != "failed":
        print(
            f"✅ CodeScene Code Health Quality Gates PASSED! ({len(results)} files checked)"
        )
        return 0

    print(f"❌ CodeScene Quality Gates: {quality_gates.upper()}")
    print(f"Found {len(degraded_files)} degraded file(s):\n")

    for f in degraded_files:
        print(f"📁 {f.get('name')}:")
        for finding in f.get("findings", []):
            cat = finding.get("category")
            for detail in finding.get("change-details", []):
                print(f"   • [{cat}] {detail.get('description')}")
        print()

    return 1


if __name__ == "__main__":
    ref = sys.argv[1] if len(sys.argv) > 1 else "origin/master"
    sys.exit(check_codescene(base_ref=ref))
