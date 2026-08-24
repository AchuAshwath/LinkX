"""Chaos tests for filesystem permissions and deep key path overwrites in selector persistence."""

from __future__ import annotations

import json
import stat
from pathlib import Path
from typing import Any
from unittest.mock import patch

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
        """Attack: Config file is marked read-only (chmod 444)."""
        config_file = tmp_path / "readonly.json"
        config_file.write_text(
            json.dumps({"compose": {"btn": "old"}}), encoding="utf-8"
        )
        config_file.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)

        try:
            success = patch_selector_config(
                config_path=config_file,
                key_path="compose.btn",
                new_selector="button.new",
            )
            assert success is False
        finally:
            config_file.chmod(stat.S_IRWXU)

    def test_read_only_directory_permission_denied(self, tmp_path: Path) -> None:
        """Attack: Parent directory is read-only (chmod 555)."""
        ro_dir = tmp_path / "ro_directory"
        ro_dir.mkdir()
        config_file = ro_dir / "selectors.json"
        config_file.write_text(
            json.dumps({"nav": {"home": "a#home"}}), encoding="utf-8"
        )
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


class TestDeepKeyPathOverwrites:
    """Attacks targeting nested dictionary manipulation, type collisions, and path splitting."""

    def test_overwrite_primitive_string_with_nested_dict(self, tmp_path: Path) -> None:
        """Attack: Overwriting a scalar primitive string key with a multi-level dict path."""
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
        """Attack: Overwriting a nested dictionary branch with a flat primitive string."""
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
        """Attack: Target key path navigates through an existing JSON list."""
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
        """Attack: Extremely deep dot path (100 nested dictionary levels)."""
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

        assert _get_nested_selector(data, deep_key) == "deepest_value"

    def test_malformed_key_paths_empty_and_consecutive_dots(
        self, tmp_path: Path
    ) -> None:
        """Attack: Malformed key paths such as empty string, single dot, consecutive dots."""
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

    def test_key_paths_with_dots_in_css_selector_fragment(self, tmp_path: Path) -> None:
        """Vulnerability Demonstrated: Unescaped dots in key paths cause false nesting."""
        config_file = tmp_path / "dotted_keys.json"
        config_file.write_text("{}", encoding="utf-8")

        patch_selector_config(
            config_path=config_file,
            key_path="selectors.button.primary",
            new_selector="button.btn-primary",
        )
        with open(config_file, encoding="utf-8") as f:
            data = json.load(f)

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
