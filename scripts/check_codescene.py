#!/usr/bin/env python3
"""Run CodeScene delta analysis via local cs-mcp server to verify Code Health quality gates."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CS_MCP_BIN = "/opt/homebrew/bin/cs-mcp"


def _send_rpc(proc: subprocess.Popen[str], msg: dict[str, Any]) -> None:
    if not proc.stdin:
        return
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()


def _read_json_response(
    proc: subprocess.Popen[str], target_id: int
) -> dict[str, Any] | None:
    if not proc.stdout:
        return None
    for line in proc.stdout:
        trimmed = line.strip()
        if not trimmed.startswith("{"):
            continue
        data: dict[str, Any] = json.loads(trimmed)
        if data.get("id") == target_id:
            return data
    return None


def _init_mcp(proc: subprocess.Popen[str]) -> bool:
    init_msg = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "linkx-check", "version": "1.0"},
        },
    }
    _send_rpc(proc, init_msg)
    res = _read_json_response(proc, 1)
    return res is not None


def _request_change_set(
    proc: subprocess.Popen[str], base_ref: str
) -> dict[str, Any] | None:
    call_msg = {
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
    _send_rpc(proc, call_msg)
    return _read_json_response(proc, 2)


def _parse_mcp_output(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload:
        return None
    content_list = payload.get("result", {}).get("content", [])
    raw_text = content_list[0].get("text", "") if content_list else ""
    json_start = raw_text.find("{")
    if json_start < 0:
        return None
    res: dict[str, Any] = json.loads(raw_text[json_start:])
    return res


def _run_mcp_analysis(base_ref: str) -> dict[str, Any] | None:
    proc = subprocess.Popen(
        [CS_MCP_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if not _init_mcp(proc):
        proc.kill()
        return None
    payload = _request_change_set(proc, base_ref)
    proc.kill()
    return _parse_mcp_output(payload)


def _log(msg: str = "") -> None:
    sys.stdout.write(f"{msg}\n")


def _print_finding_detail(detail: dict[str, Any], category: str) -> None:
    desc = detail.get("description", "")
    _log(f"   • [{category}] {desc}")


def _print_file_findings(finding: dict[str, Any]) -> None:
    category = str(finding.get("category", ""))
    for detail in finding.get("change-details", []):
        _print_finding_detail(detail, category)


def _print_degraded_file(file_info: dict[str, Any]) -> None:
    _log(f"📁 {file_info.get('name')}:")
    for finding in file_info.get("findings", []):
        _print_file_findings(finding)
    _log()


def _report_degradations(degraded_files: list[dict[str, Any]], gates: str) -> int:
    _log(f"❌ CodeScene Quality Gates: {gates.upper()}")
    _log(f"Found {len(degraded_files)} degraded file(s):\n")
    for f in degraded_files:
        _print_degraded_file(f)
    return 1


def check_codescene(*, base_ref: str = "origin/master") -> int:
    if not os.path.exists(CS_MCP_BIN):
        _log(f"Error: CodeScene MCP binary not found at {CS_MCP_BIN}")
        return 1

    result_data = _run_mcp_analysis(base_ref)
    if not result_data:
        _log("Error: No analysis data received from CodeScene MCP")
        return 1

    results = result_data.get("results", [])
    gates = str(result_data.get("quality_gates", ""))
    degraded = [f for f in results if f.get("verdict") == "degraded"]

    if not degraded and gates != "failed":
        _log(
            f"✅ CodeScene Code Health Quality Gates PASSED! ({len(results)} files checked)"
        )
        return 0

    return _report_degradations(degraded, gates)


if __name__ == "__main__":
    ref = sys.argv[1] if len(sys.argv) > 1 else "origin/master"
    sys.exit(check_codescene(base_ref=ref))
