import tomllib
from pathlib import Path

import gratovo_pipeline

PYPROJECT = Path(__file__).parent.parent / "pyproject.toml"


def test_installed_package_matches_pyproject() -> None:
    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]
    assert gratovo_pipeline.__version__ == project["version"]
