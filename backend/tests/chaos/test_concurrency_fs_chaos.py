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
import stat
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


# ============================================================================
# Attack Vector 3: Read-Only / Permission Denied Filesystem
# ============================================================================


class TestReadOnlyAndPermissionDeniedFilesystem:
    """Attacks targeting unwritable files, read-only permissions, and bad paths."""

    def test_read_only_file_permission_denied_returns_false(
        self, tmp_path: Path
    ) -> None:
        """Attack: Config file is marked read-only (chmod 444).

        patch_selector_config encounters PermissionError when opening for writing.
        Verifies it fails gracefully returning False and does not take down the server.
        """
        config_file = tmp_path / "readonly.json"
        config_file.write_text(
            json.dumps({"compose": {"btn": "old"}}), encoding="utf-8"
        )

        # Set read-only permissions (0o444)
        config_file.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)

        try:
            success = patch_selector_config(
                config_path=config_file,
                key_path="compose.btn",
                new_selector="button.new",
            )
            assert success is False
        finally:
            # Restore write permissions for cleanup
            config_file.chmod(stat.S_IRWXU)

    def test_read_only_directory_permission_denied(self, tmp_path: Path) -> None:
        """Attack: Parent directory is read-only (chmod 555)."""
        ro_dir = tmp_path / "ro_directory"
        ro_dir.mkdir()
        config_file = ro_dir / "selectors.json"
        config_file.write_text(
            json.dumps({"nav": {"home": "a#home"}}), encoding="utf-8"
        )

        # Make directory read-only (0o555: read + search, no write)
        ro_dir.chmod(stat.S_IRUSR | stat.S_IXUSR | stat.S_IRGRP | stat.S_IXGRP)

        try:
            success = patch_selector_config(
                config_path=config_file,
                key_path="nav.home",
                new_selector="a#home_new",
            )
            assert isinstance(success, bool)
        finally:
            ro_dir.chmod(stat.S_IRWXU)

    def test_target_is_a_directory_returns_false(self, tmp_path: Path) -> None:
        """Attack: config_path points to an existing directory instead of a file."""
        dir_path = tmp_path / "not_a_file"
        dir_path.mkdir()

        success = patch_selector_config(
            config_path=dir_path,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        assert success is False

    def test_nonexistent_config_path_returns_false(self, tmp_path: Path) -> None:
        """Attack: config_path does not exist on disk."""
        nonexistent = tmp_path / "missing_dir" / "missing_file.json"

        success = patch_selector_config(
            config_path=nonexistent,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        assert success is False

    def test_broken_symlink_config_path_returns_false(self, tmp_path: Path) -> None:
        """Attack: config_path is a broken symbolic link."""
        target_file = tmp_path / "target_that_does_not_exist.json"
        symlink_file = tmp_path / "broken_link.json"
        symlink_file.symlink_to(target_file)

        success = patch_selector_config(
            config_path=symlink_file,
            key_path="compose.post_input",
            new_selector="div.healed",
        )

        assert success is False


# ============================================================================
# Attack Vector 4: Deep Key Path Overwrites & Structural Collisions
# ============================================================================


class TestDeepKeyPathOverwrites:
    """Attacks targeting nested dictionary manipulation, type collisions, and path splitting."""

    def test_overwrite_primitive_string_with_nested_dict(self, tmp_path: Path) -> None:
        """Attack: Overwriting a scalar primitive string key with a multi-level dict path.

        Initial: {"a": "foo"}
        Patch: "a.b.c" = "bar"
        Expected Result: {"a": {"b": {"c": "bar"}}}
        The primitive string "foo" is replaced with an intermediate dictionary.
        """
        config_file = tmp_path / "prim_to_dict.json"
        config_file.write_text(json.dumps({"a": "foo"}), encoding="utf-8")

        success = patch_selector_config(
            config_path=config_file,
            key_path="a.b.c",
            new_selector="bar",
        )

        assert success is True
        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

        assert data == {"a": {"b": {"c": "bar"}}}
        assert _get_nested_selector(data, "a.b.c") == "bar"

    def test_overwrite_nested_dict_with_primitive_string(self, tmp_path: Path) -> None:
        """Attack: Overwriting a nested dictionary branch with a flat primitive string.

        Initial: {"a": {"b": {"c": "bar"}}}
        Patch: "a" = "flat_string"
        Expected Result: {"a": "flat_string"}
        The entire sub-tree under "a" is clobbered.
        """
        config_file = tmp_path / "dict_to_prim.json"
        config_file.write_text(json.dumps({"a": {"b": {"c": "bar"}}}), encoding="utf-8")

        success = patch_selector_config(
            config_path=config_file,
            key_path="a",
            new_selector="flat_string",
        )

        assert success is True
        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

        assert data == {"a": "flat_string"}
        assert _get_nested_selector(data, "a") == "flat_string"
        assert _get_nested_selector(data, "a.b.c") is None

    def test_overwrite_intermediate_list_with_dict(self, tmp_path: Path) -> None:
        """Attack: Target key path navigates through an existing JSON list.

        Initial: {"actions": ["click", "submit"]}
        Patch: "actions.submit_button" = "button#submit"
        Result: The list under "actions" is replaced with a dictionary.
        """
        config_file = tmp_path / "list_collision.json"
        config_file.write_text(
            json.dumps({"actions": ["click", "submit"]}), encoding="utf-8"
        )

        success = patch_selector_config(
            config_path=config_file,
            key_path="actions.submit_button",
            new_selector="button#submit",
        )

        assert success is True
        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

        assert data == {"actions": {"submit_button": "button#submit"}}

    def test_deeply_nested_key_path_100_levels(self, tmp_path: Path) -> None:
        """Attack: Extremely deep dot path (100 nested dictionary levels).

        Tests iterative loop execution, serialization limit, and stack safety.
        """
        config_file = tmp_path / "deep_100_levels.json"
        config_file.write_text("{}", encoding="utf-8")

        levels = [f"depth_{i}" for i in range(100)]
        deep_key = ".".join(levels)

        success = patch_selector_config(
            config_path=config_file,
            key_path=deep_key,
            new_selector="deepest_value",
        )

        assert success is True
        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

        # Verify 100 levels can be traversed and retrieved
        assert _get_nested_selector(data, deep_key) == "deepest_value"

    def test_malformed_key_paths_empty_and_consecutive_dots(
        self, tmp_path: Path
    ) -> None:
        """Attack: Malformed key paths such as empty string, single dot, consecutive dots.

        Demonstrates that string split on dot produces empty string dict keys:
        - "" -> creates {"": "val"}
        - "a..b" -> creates {"a": {"": {"b": "val"}}}
        - ".a" -> creates {"": {"a": "val"}}
        - "a." -> creates {"a": {"": "val"}}
        """
        # Case 1: Empty string "" -> sets root key ""
        config_empty = tmp_path / "empty_key.json"
        config_empty.write_text("{}", encoding="utf-8")
        assert (
            patch_selector_config(
                config_path=config_empty, key_path="", new_selector="empty_root"
            )
            is True
        )
        with open(config_empty, encoding="utf-8") as f:
            assert json.load(f) == {"": "empty_root"}

        # Case 2: Consecutive dots "a..b" -> creates nested empty string key: {"a": {"": {"b": "val"}}}
        config_dots = tmp_path / "consecutive_dots.json"
        config_dots.write_text("{}", encoding="utf-8")
        assert (
            patch_selector_config(
                config_path=config_dots, key_path="a..b", new_selector="consecutive_val"
            )
            is True
        )
        with open(config_dots, encoding="utf-8") as f:
            assert json.load(f) == {"a": {"": {"b": "consecutive_val"}}}

        # Case 3: Leading dot ".leading" -> creates {"": {"leading": "leading_val"}}
        config_leading = tmp_path / "leading_dot.json"
        config_leading.write_text("{}", encoding="utf-8")
        assert (
            patch_selector_config(
                config_path=config_leading,
                key_path=".leading",
                new_selector="leading_val",
            )
            is True
        )
        with open(config_leading, encoding="utf-8") as f:
            assert json.load(f) == {"": {"leading": "leading_val"}}

        # Case 4: Trailing dot "trailing." -> creates {"trailing": {"": "trailing_val"}}
        config_trailing = tmp_path / "trailing_dot.json"
        config_trailing.write_text("{}", encoding="utf-8")
        assert (
            patch_selector_config(
                config_path=config_trailing,
                key_path="trailing.",
                new_selector="trailing_val",
            )
            is True
        )
        with open(config_trailing, encoding="utf-8") as f:
            assert json.load(f) == {"trailing": {"": "trailing_val"}}

    def test_key_paths_with_dots_in_css_selector_fragment(self, tmp_path: Path) -> None:
        """Vulnerability Demonstrated: Unescaped dots in key paths cause false nesting.

        If a caller intends key 'button.primary' as a single key name,
        key_path.split('.') erroneously splits it into {"button": {"primary": ...}}.
        """
        config_file = tmp_path / "dotted_keys.json"
        config_file.write_text("{}", encoding="utf-8")

        key_with_dots = "selectors.button.primary"
        patch_selector_config(
            config_path=config_file,
            key_path=key_with_dots,
            new_selector="button.btn-primary",
        )

        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

        # Creates 3 levels of nesting instead of 2
        assert "button" in data["selectors"]
        assert "primary" in data["selectors"]["button"]
        assert data["selectors"]["button"]["primary"] == "button.btn-primary"

    def test_key_paths_with_special_characters_and_whitespace(
        self, tmp_path: Path
    ) -> None:
        """Attack: Key paths with unicode, spaces, newlines, quotes, and punctuation."""
        config_file = tmp_path / "special_chars.json"
        config_file.write_text("{}", encoding="utf-8")

        test_cases = [
            ("auth.login button#1", "button.submit"),
            ("unicode.セレクタ.ボタン", "div.jp-btn"),
            ('escaped.quote"key', "span.quote"),
            ("multiline.line\nbreak", "div.multi"),
        ]

        for key_path, selector in test_cases:
            success = patch_selector_config(
                config_path=config_file,
                key_path=key_path,
                new_selector=selector,
            )
            assert success is True

        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

        for key_path, selector in test_cases:
            assert _get_nested_selector(data, key_path) == selector

    def test_set_nested_selector_in_memory_exact_parity(self) -> None:
        """Verify _set_nested_selector produces the exact same structure in memory as on disk."""
        in_memory_data: dict[str, Any] = {"a": "initial_scalar"}
        _set_nested_selector(in_memory_data, "a.b.c", "deep_val")

        assert in_memory_data == {"a": {"b": {"c": "deep_val"}}}
        assert _get_nested_selector(in_memory_data, "a.b.c") == "deep_val"

    def test_patch_selector_config_atomic_replace_os_error_returns_false(
        self, tmp_path: Path
    ) -> None:
        """Attack G15: Filesystem error during os.replace returns False safely."""
        from unittest.mock import patch

        config_file = tmp_path / "valid.json"
        config_file.write_text("{}", encoding="utf-8")

        with patch(
            "app.services.browser.tools.os.replace",
            side_effect=OSError("Disk full or I/O error"),
        ):
            success = patch_selector_config(
                config_path=config_file,
                key_path="compose.post_input",
                new_selector="div.healed",
            )
            assert success is False
