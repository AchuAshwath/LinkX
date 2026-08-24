"""Chaos, concurrency, and filesystem resilience tests for selector persistence and caching."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import stat
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from app.services.browser.tools import (
    _get_nested_selector,
    _set_nested_selector,
    patch_selector_config,
)


class TestConcurrentFileWriteCollision:
    """Attacks targeting concurrent file I/O, race conditions, and cache consistency."""

    @pytest.mark.anyio
    async def test_concurrent_writes_20_tasks_collision(self, tmp_path: Path) -> None:
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

        for r in results:
            assert not isinstance(r, Exception)

        with open(config_file, encoding="utf-8") as f:
            final_data = json.load(f)
        assert isinstance(final_data, dict)

    @pytest.mark.anyio
    async def test_concurrent_writes_same_key_race_condition(
        self, tmp_path: Path
    ) -> None:
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

        with open(config_file, encoding="utf-8") as f:
            final_data = json.load(f)
        persisted = final_data.get("compose", {}).get("post_input")
        if persisted:
            assert persisted in candidates

    def test_in_memory_and_disk_cache_desync(self) -> None:
        worker_a_cache = {"compose": {"post_input": "div.old_selector"}}
        worker_b_cache = {"compose": {"post_input": "div.old_selector"}}

        _set_nested_selector(
            worker_a_cache, "compose.post_input", "div.healed_selector_v2"
        )

        assert (
            _get_nested_selector(worker_a_cache, "compose.post_input")
            == "div.healed_selector_v2"
        )
        assert (
            _get_nested_selector(worker_b_cache, "compose.post_input")
            == "div.old_selector"
        )


CORRUPTED_CONTENTS = [
    '{"compose": {"post_input": ',
    '{"compose": UNPARSEABLE_GARBAGE',
    "",
    b"\x00\xff\xfe\xfd\x80\x81\x82<!DOCTYPE html><html>",
    json.dumps(["item1", "item2", "item3"]),
    "42",
]


class TestCorruptedJsonRecovery:
    """Attacks targeting malformed, truncated, or corrupted JSON config files."""

    @pytest.mark.parametrize("content", CORRUPTED_CONTENTS)
    def test_corrupted_json_fails_gracefully(
        self, tmp_path: Path, content: str | bytes
    ) -> None:
        config_file = tmp_path / "corrupted.json"
        if isinstance(content, bytes):
            config_file.write_bytes(content)
        else:
            config_file.write_text(content, encoding="utf-8")

        assert (
            patch_selector_config(
                config_path=config_file,
                key_path="compose.post_input",
                new_selector="div.healed",
            )
            is False
        )

    def test_in_memory_set_nested_selector_on_non_dict_root_raises_type_error(
        self,
    ) -> None:
        with pytest.raises(TypeError):
            _set_nested_selector(
                selectors_dict=["not", "a", "dict"],  # type: ignore[arg-type]
                key_path="compose.post_input",
                new_selector="div.healed",
            )

    def test_in_memory_get_nested_selector_resilience(self) -> None:
        assert _get_nested_selector({}, "compose.post_input") is None
        assert _get_nested_selector(None, "compose.post_input") is None  # type: ignore[arg-type]
        assert _get_nested_selector(["list", "root"], "0") is None  # type: ignore[arg-type]
        assert _get_nested_selector({"a": None}, "a.b") is None
        assert _get_nested_selector({"a": 123}, "a") == "123"
        assert _get_nested_selector({"a": {"b": ["list_val"]}}, "a.b") is None


def _create_broken_symlink(tmp_path: Path) -> Path:
    target = tmp_path / "missing_target.json"
    link = tmp_path / "broken.json"
    link.symlink_to(target)
    return link


PATH_TEST_CASES = [
    ('{"a": "foo"}', "a.b.c", "bar", {"a": {"b": {"c": "bar"}}}),
    ('{"a": {"b": {"c": "bar"}}}', "a", "flat_string", {"a": "flat_string"}),
    (
        '{"actions": ["click"]}',
        "actions.btn",
        "button#submit",
        {"actions": {"btn": "button#submit"}},
    ),
    ("{}", "", "empty_root", {"": "empty_root"}),
    ("{}", "a..b", "consecutive_val", {"a": {"": {"b": "consecutive_val"}}}),
    ("{}", ".leading", "leading_val", {"": {"leading": "leading_val"}}),
    ("{}", "trailing.", "trailing_val", {"trailing": {"": "trailing_val"}}),
    (
        "{}",
        "auth.login button#1",
        "button.submit",
        {"auth": {"login button#1": "button.submit"}},
    ),
    (
        "{}",
        "unicode.セレクタ.ボタン",
        "div.jp-btn",
        {"unicode": {"セレクタ": {"ボタン": "div.jp-btn"}}},
    ),
]


class TestPermissionsAndNestedPaths:
    """Attacks targeting filesystem permissions, OS errors, and nested paths."""

    def test_read_only_file_permission_denied(self, tmp_path: Path) -> None:
        config_file = tmp_path / "readonly.json"
        config_file.write_text(
            json.dumps({"compose": {"btn": "old"}}), encoding="utf-8"
        )
        config_file.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)

        try:
            assert (
                patch_selector_config(
                    config_path=config_file,
                    key_path="compose.btn",
                    new_selector="button.new",
                )
                is False
            )
        finally:
            config_file.chmod(stat.S_IRWXU)

    @pytest.mark.parametrize(
        "invalid_path_factory",
        [
            lambda p: (p / "a_directory").mkdir() or (p / "a_directory"),
            lambda p: p / "missing_dir" / "missing.json",
            lambda p: _create_broken_symlink(p),
        ],
    )
    def test_invalid_paths_return_false(
        self, tmp_path: Path, invalid_path_factory: Any
    ) -> None:
        path = invalid_path_factory(tmp_path)
        assert (
            patch_selector_config(
                config_path=path,
                key_path="compose.post_input",
                new_selector="div.healed",
            )
            is False
        )

    @pytest.mark.parametrize("case", PATH_TEST_CASES)
    def test_patch_selector_config_path_variants(
        self,
        tmp_path: Path,
        case: tuple[str, str, str, dict[str, Any]],
    ) -> None:
        initial_json, key_path, new_selector, expected_data = case
        config_file = tmp_path / "config.json"
        config_file.write_text(initial_json, encoding="utf-8")

        assert (
            patch_selector_config(
                config_path=config_file,
                key_path=key_path,
                new_selector=new_selector,
            )
            is True
        )
        with open(config_file, encoding="utf-8") as f:
            assert json.load(f) == expected_data

    def test_deeply_nested_key_path_100_levels(self, tmp_path: Path) -> None:
        config_file = tmp_path / "deep_100_levels.json"
        config_file.write_text("{}", encoding="utf-8")

        deep_key = ".".join(f"depth_{i}" for i in range(100))
        assert (
            patch_selector_config(
                config_path=config_file,
                key_path=deep_key,
                new_selector="deepest_value",
            )
            is True
        )
        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)
        assert _get_nested_selector(data, deep_key) == "deepest_value"

    def test_patch_selector_config_atomic_replace_os_error(
        self, tmp_path: Path
    ) -> None:
        config_file = tmp_path / "valid.json"
        config_file.write_text("{}", encoding="utf-8")

        with patch(
            "app.services.browser.tools.os.replace",
            side_effect=OSError("Disk full or I/O error"),
        ):
            assert (
                patch_selector_config(
                    config_path=config_file,
                    key_path="compose.post_input",
                    new_selector="div.healed",
                )
                is False
            )
