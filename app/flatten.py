"""
app/flatten.py
==============
Flatten nested JSON into dot-notation dict.

    {"a": {"b": 1}, "c": [10, 20]}
    → {"a.b": 1, "c.0": 10, "c.1": 20}

Rules
-----
* Nested dicts   → parent.child
* Lists          → parent.0, parent.1, ...
* Scalar values  → kept as-is (str / int / float / bool / None)
* Empty dict/list → key itself with empty value omitted (skip)

Usage
-----
    from app.flatten import flatten_json

    flat = flatten_json({"Event": {"Name": "alert", "Source": {"Id": "DJI-001"}}})
    # {"Event.Name": "alert", "Event.Source.Id": "DJI-001"}
"""
from __future__ import annotations

from typing import Any


def flatten_json(data: dict, sep: str = ".") -> dict:
    """Recursively flatten *data* into a single-level dict.

    Parameters
    ----------
    data : dict
        The nested JSON object to flatten.
    sep : str
        Separator between key levels. Default ``'.'``.

    Returns
    -------
    dict
        Flat ``{str: Any}`` mapping.  List indices become string segments.

    Examples
    --------
    >>> flatten_json({"a": {"b": 1}})
    {'a.b': 1}
    >>> flatten_json({"items": [{"id": 1}, {"id": 2}]})
    {'items.0.id': 1, 'items.1.id': 2}
    """
    out: dict[str, Any] = {}
    _flatten(data, prefix="", sep=sep, out=out)
    return out


def _flatten(node: Any, prefix: str, sep: str, out: dict) -> None:
    if isinstance(node, dict):
        if not node and prefix:
            # empty dict — store as empty string so the key is still reachable
            out[prefix] = {}
            return
        for k, v in node.items():
            new_key = f"{prefix}{sep}{k}" if prefix else str(k)
            _flatten(v, new_key, sep, out)

    elif isinstance(node, list):
        if not node and prefix:
            out[prefix] = []
            return
        for i, v in enumerate(node):
            new_key = f"{prefix}{sep}{i}" if prefix else str(i)
            _flatten(v, new_key, sep, out)

    else:
        # scalar: str / int / float / bool / None
        if prefix:
            out[prefix] = node
