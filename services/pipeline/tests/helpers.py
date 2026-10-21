"""Helpers the tests import (pytest discourages importing conftest itself)."""

from collections.abc import Mapping
from typing import Any


def schema_errors(schema: Mapping[str, Any], instance: Any) -> list[str]:
    """What JSON Schema finds wrong with instance (any decoded JSON); empty when it is valid."""
    from jsonschema import Draft202012Validator

    validator = Draft202012Validator(schema)
    # The stubs leave one overload of iter_errors untyped; the messages are plain strings.
    found = validator.iter_errors(instance)  # pyright: ignore[reportUnknownMemberType]
    return [str(error.message) for error in found]
