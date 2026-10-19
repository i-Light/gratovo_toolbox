"""Proves the package imports and the test runner works. Real suites are ported in step 3e."""

import gratovo_pipeline


def test_package_has_a_version() -> None:
    assert gratovo_pipeline.__version__
