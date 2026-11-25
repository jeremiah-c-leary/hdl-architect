"""ha.toml: paths relative to the file; unknown keys rejected; found from below."""

import pytest

from hdl_architect.core import config
from hdl_architect.core.model import ModelError


def test_paths_are_relative_to_the_file(tmp_path):
    (tmp_path / "ha.toml").write_text(
        '[model]\npaths = ["m"]\ntop = "T"\n[scaffold]\nworkspace = "w"\n'
    )
    cfg, f = config.load(tmp_path / "ha.toml")
    assert cfg["model"]["paths"] == [str(tmp_path / "m")]
    assert cfg["scaffold"]["workspace"] == str(tmp_path / "w")
    assert cfg["model"]["top"] == "T"


def test_unknown_key_is_an_error(tmp_path):
    (tmp_path / "ha.toml").write_text('[scaffold]\nworkspce = "w"\n')
    with pytest.raises(ModelError, match="unknown key 'workspce'"):
        config.load(tmp_path / "ha.toml")


def test_found_from_a_subfolder(tmp_path, monkeypatch):
    (tmp_path / "ha.toml").write_text('[model]\ntop = "T"\n')
    (tmp_path / "a" / "b").mkdir(parents=True)
    monkeypatch.chdir(tmp_path / "a" / "b")
    cfg, f = config.load()
    assert f == tmp_path / "ha.toml" and cfg["model"]["top"] == "T"
