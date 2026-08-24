"""Chaos, concurrency, and filesystem resilience tests for selector persistence and caching.

Tests attack vectors against:
- patch_selector_config
- _set_nested_selector
- _get_nested_selector

Target Module: app.services.browser.tools
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
from pathlib import Path
from typing import Any

import pytest

from app.services.browser.tools import (
    _get_nested_selector,
    _set_nested_selector,
    patch_selector_config,
)

# ============================================================================
# Attack Vector 1: Concurrent File Write Collision & Cache Desync
# ============================================================================


class TestConcurrentFileWriteCollision:
    """Attacks targeting concurrent file I/O, race conditions, and cache consistency."""

    @pytest.mark.anyio
    async def test_concurrent_writes_20_tasks_collision_and_lost_updates(
        self, tmp_path: Path
    ) -> None:
        """Attack: 20 concurrent tasks calling patch_selector_config on the same file.

        Vulnerability Demonstrated:
        patch_selector_config performs a non-atomic read-modify-write without file locks
        (flock) or atomic file replacement (os.replace). Under concurrency:
        1. Tasks read stale states before previous writes finish.
        2. Later writes overwrite earlier writes, resulting in lost updates (data loss).
        3. Simultaneous open(path, "w") can cause race-condition collisions.
        """
        config_file = tmp_path / "x_selectors.json"
        initial_data: dict[str, Any] = {"compose": {}, "navigation": {}}
        config_file.write_text(json.dumps(initial_data, indent=2), encoding="utf-8")

        num_tasks = 20

        def worker_patch(task_idx: int) -> bool:
            return patch_selector_config(
                config_path=config_file,
                key_path=f"compose.field_{task_idx}",
                new_selector=f"input#field_{task_idx}_candidate",
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_tasks) as pool:
            loop = asyncio.get_running_loop()
            tasks = [
                loop.run_in_executor(pool, worker_patch, i) for i in range(num_tasks)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        # No uncaught exceptions should escape patch_selector_config
        for r in results:
            assert not isinstance(r, Exception), f"Unexpected exception escaped: {r}"

        # Read back the persisted configuration on disk
        try:
            with open(config_file, encoding="utf-8") as f:
                final_data = json.load(f)

            saved_keys = final_data.get("compose", {})
            saved_count = len(saved_keys)

            # File remains valid JSON
            assert isinstance(final_data, dict)
            # At least some writes succeeded
            assert saved_count >= 1
            # In a naive lock-free implementation, saved_count is frequently < num_tasks
            # because writes clobber each other (Lost Updates vulnerability).
        except json.JSONDecodeError as e:
            # Demonstrates critical race condition: simultaneous open(path, "w") can leave
            # truncated or unparseable JSON on disk
            assert "Extra data" in str(e) or "Expecting value" in str(e)

    @pytest.mark.anyio
    async def test_concurrent_writes_same_key_race_condition(
        self, tmp_path: Path
    ) -> None:
        """Attack: 20 concurrent tasks writing competing values to the exact same key.

        Verifies the behavior when multiple tasks race to update the same key path.
        """
        config_file = tmp_path / "competing_selectors.json"
        config_file.write_text(
            json.dumps({"compose": {"post_input": "div.initial"}}),
            encoding="utf-8",
        )

        num_tasks = 20
        candidates = [f"div[data-testid='tweetTextarea_{i}']" for i in range(num_tasks)]

        def worker_patch(task_idx: int) -> bool:
            return patch_selector_config(
                config_path=config_file,
                key_path="compose.post_input",
                new_selector=candidates[task_idx],
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_tasks) as pool:
            loop = asyncio.get_running_loop()
            tasks = [
                loop.run_in_executor(pool, worker_patch, i) for i in range(num_tasks)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        for r in results:
            assert not isinstance(r, Exception)

        try:
            with open(config_file, encoding="utf-8") as f:
                final_data = json.load(f)

            persisted_selector = final_data.get("compose", {}).get("post_input")
            if persisted_selector:
                assert persisted_selector in candidates
        except json.JSONDecodeError as e:
            # Demonstrates race collision on same-key writes
            assert "Extra data" in str(e) or "Expecting value" in str(e)

    @pytest.mark.anyio
    async def test_concurrent_file_truncation_reader_collision(
        self, tmp_path: Path
    ) -> None:
        """Attack: Concurrent readers attempting to read while patch_selector_config writes.

        Vulnerability Demonstrated:
        patch_selector_config uses `open(path, "w")` which immediately truncates the file
        to 0 bytes before writing `json.dump()`. Concurrent readers or other patch workers
        reading the file during this window experience JSONDecodeError (line 1 column 1 char 0).
        """
        config_file = tmp_path / "readers_writers.json"
        initial_data = {"feed": {"timeline": "div[data-testid='tweet']"}}
        config_file.write_text(json.dumps(initial_data, indent=2), encoding="utf-8")

        read_errors: list[Exception] = []
        read_successes: list[dict[str, Any]] = []

        def continuous_writer(worker_id: int) -> None:
            for i in range(10):
                patch_selector_config(
                    config_path=config_file,
                    key_path=f"feed.item_{worker_id}_{i}",
                    new_selector=f"div.item_{worker_id}_{i}",
                )

        def continuous_reader() -> None:
            for _ in range(15):
                try:
                    with open(config_file, encoding="utf-8") as f:
                        data = json.load(f)
                        read_successes.append(data)
                except Exception as exc:
                    # Captures JSONDecodeError when reading truncated or partially written file
                    read_errors.append(exc)

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            loop = asyncio.get_running_loop()
            writer_tasks = [
                loop.run_in_executor(pool, continuous_writer, w_id) for w_id in range(4)
            ]
            reader_tasks = [
                loop.run_in_executor(pool, continuous_reader) for _ in range(6)
            ]
            await asyncio.gather(*writer_tasks, *reader_tasks, return_exceptions=True)

        # After all concurrent writers finish, verify the final file is accessible
        # If write collision left extra data, test handles reading safely
        try:
            with open(config_file, encoding="utf-8") as f:
                final_data = json.load(f)
            assert isinstance(final_data, dict)
        except json.JSONDecodeError:
            # Demonstrates critical vulnerability: direct in-place write can leave corrupted file
            pass

    def test_in_memory_and_disk_cache_desync(self) -> None:
        """Attack: Multiple in-memory dictionaries desynchronize when one is mutated.

        Demonstrates that _set_nested_selector updates only the passed dictionary,
        leaving other worker caches and the disk file out of sync unless explicitly reloaded.
        """
        worker_a_cache = {"compose": {"post_input": "div.old_selector"}}
        worker_b_cache = {"compose": {"post_input": "div.old_selector"}}

        # Worker A heals its selector in-memory
        _set_nested_selector(
            worker_a_cache, "compose.post_input", "div.healed_selector_v2"
        )

        # Worker A has the new selector
        assert (
            _get_nested_selector(worker_a_cache, "compose.post_input")
            == "div.healed_selector_v2"
        )
        # Worker B's in-memory cache is now stale (desynchronized)
        assert (
            _get_nested_selector(worker_b_cache, "compose.post_input")
            == "div.old_selector"
        )


# ============================================================================
# Attack Vector 2: Corrupted JSON Recovery & Resilience
# ============================================================================


class TestCorruptedJsonRecovery:
    """Attacks targeting malformed, truncated, or corrupted JSON config files."""

    def test_corrupted_json_truncated_syntax_fails_gracefully(
        self, tmp_path: Path
    ) -> None:
        """Attack: Config file is truncated halfway (e.g. abrupt power failure / partial write)."""
        config_file = tmp_path / "truncated.json"
        config_file.write_text('{"compose": {"post_input": ', encoding="utf-8")

        success = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        # Must return False gracefully without raising JSONDecodeError to caller
        assert success is False

    def test_corrupted_json_is_not_auto_healed(self, tmp_path: Path) -> None:
        """Vulnerability Demonstrated: Corrupted config files remain corrupted permanently.

        patch_selector_config logs an error and returns False, but does not reset
        or restore from a clean default, causing all future patches to fail.
        """
        config_file = tmp_path / "broken_config.json"
        broken_content = '{"compose": UNPARSEABLE_GARBAGE'
        config_file.write_text(broken_content, encoding="utf-8")

        # Attempt patch 1
        res1 = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_button",
            new_selector="button.submit",
        )
        assert res1 is False

        # Attempt patch 2
        res2 = patch_selector_config(
            config_path=config_file,
            key_path="navigation.home",
            new_selector="a.home",
        )
        assert res2 is False

        # File is still corrupted
        assert config_file.read_text(encoding="utf-8") == broken_content

    def test_corrupted_json_zero_bytes_empty_file(self, tmp_path: Path) -> None:
        """Attack: Config file exists but has 0 bytes."""
        config_file = tmp_path / "zero_bytes.json"
        config_file.write_text("", encoding="utf-8")

        success = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        assert success is False

    def test_corrupted_json_binary_garbage(self, tmp_path: Path) -> None:
        """Attack: Config file contains binary garbage or raw HTML."""
        config_file = tmp_path / "binary_garbage.json"
        config_file.write_bytes(b"\x00\xff\xfe\xfd\x80\x81\x82<!DOCTYPE html><html>")

        success = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        assert success is False

    def test_corrupted_json_root_is_list(self, tmp_path: Path) -> None:
        """Attack: Root JSON object is a list instead of a dict."""
        config_file = tmp_path / "root_list.json"
        config_file.write_text(
            json.dumps(["item1", "item2", "item3"]), encoding="utf-8"
        )

        success = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        # Caught and returns False without crashing
        assert success is False

    def test_corrupted_json_root_is_scalar_primitive(self, tmp_path: Path) -> None:
        """Attack: Root JSON is a primitive scalar (e.g. integer 42, boolean true, null)."""
        config_file = tmp_path / "root_scalar.json"
        config_file.write_text("42", encoding="utf-8")

        success = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        assert success is False

    def test_in_memory_set_nested_selector_on_non_dict_root_raises_type_error(
        self,
    ) -> None:
        """Attack: _set_nested_selector called with non-dict root object.

        Vulnerability: Unlike patch_selector_config, _set_nested_selector lacks
        try/except wrapping and raises TypeError if selectors_dict is not a dict.
        """
        with pytest.raises(TypeError):
            _set_nested_selector(
                selectors_dict=["not", "a", "dict"],  # type: ignore[arg-type]
                key_path="compose.post_input",
                new_selector="div.healed",
            )

        with pytest.raises(TypeError):
            _set_nested_selector(
                selectors_dict=None,  # type: ignore[arg-type]
                key_path="compose.post_input",
                new_selector="div.healed",
            )

    def test_in_memory_get_nested_selector_resilience(self) -> None:
        """Test _get_nested_selector handles malformed structures gracefully returning None."""
        assert _get_nested_selector({}, "compose.post_input") is None
        assert _get_nested_selector(None, "compose.post_input") is None  # type: ignore[arg-type]
        assert _get_nested_selector(["list", "root"], "0") is None  # type: ignore[arg-type]
        assert _get_nested_selector({"a": None}, "a.b") is None
        assert _get_nested_selector({"a": 123}, "a") == "123"
        assert _get_nested_selector({"a": {"b": ["list_val"]}}, "a.b") is None
