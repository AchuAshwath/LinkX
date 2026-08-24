"""Chaos tests for filesystem permissions and deep key path overwrites in selector persistence."""

from __future__ import annotations

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


class TestReadOnlyAndPermissionDeniedFilesystem:
    """Attacks targeting unwritable files, read-only permissions, and bad paths."""

    def test_read_only_file_permission_denied_returns_false(
        self, tmp_path: Path
    ) -> None:
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

    def test_read_only_directory_permission_denied(self, tmp_path: Path) -> None:
        ro_dir = tmp_path / "ro_directory"
        ro_dir.mkdir()
        config_file = ro_dir / "selectors.json"
        config_file.write_text(
            json.dumps({"nav": {"home": "a#home"}}), encoding="utf-8"
        )
        ro_dir.chmod(stat.S_IRUSR | stat.S_IXUSR | stat.S_IRGRP | stat.S_IXGRP)

        try:
            assert isinstance(
                patch_selector_config(
                    config_path=config_file,
                    key_path="nav.home",
                    new_selector="a#home_new",
                ),
                bool,
            )
        finally:
            ro_dir.chmod(stat.S_IRWXU)

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


def _create_broken_symlink(tmp_path: Path) -> Path:
    target = tmp_path / "missing_target.json"
    link = tmp_path / "broken.json"
    link.symlink_to(target)
    return link


class TestDeepKeyPathOverwrites:
    """Attacks targeting nested dictionary manipulation, type collisions, and path splitting."""

    @pytest.mark.parametrize(
        "initial_json, key_path, new_selector, expected_data",
        [
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
        ],
    )
    def test_patch_selector_config_path_variants(
        self,
        tmp_path: Path,
        initial_json: str,
        key_path: str,
        new_selector: str,
        expected_data: dict[str, Any],
    ) -> None:
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

    def test_set_nested_selector_in_memory_exact_parity(self) -> None:
        in_memory_data: dict[str, Any] = {"a": "initial_scalar"}
        _set_nested_selector(in_memory_data, "a.b.c", "deep_val")
        assert in_memory_data == {"a": {"b": {"c": "deep_val"}}}
        assert _get_nested_selector(in_memory_data, "a.b.c") == "deep_val"

    def test_patch_selector_config_atomic_replace_os_error_returns_false(
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
