"""
app/adapter_engine.py
=====================
Config-driven field normalization layer.

Sits between flatten_json() and apply_mappings().
Its only job: rename / normalize keys — NO business logic.

Config schema (stored as uw:adapter:{source} in Redis)
-------------------------------------------------------
{
    "fields": {
        "<normalized_key>": ["<candidate_path_1>", "<candidate_path_2>", ...]
    }
}

Behaviour
---------
* For each target key, try candidate paths **in order** against the flat dict.
* Use the first one that has a non-None value.
* If none match, the target key is absent (caller may supply default later).
* Keys in the flat dict that are NOT listed as candidates are passed through
  unchanged — so the output is a superset of the input (additive, non-destructive).

Example
-------
Config::

    {
        "fields": {
            "event.name":  ["Event.Name", "eventType", "type"],
            "device.id":   ["Event.Source.Id", "deviceId", "device_id"]
        }
    }

Input flat dict::

    {"Event.Name": "obstacle", "Event.Source.Id": "DJI-001", "lat": 22.5}

Output::

    {
        "Event.Name": "obstacle",   # original key kept
        "Event.Source.Id": "DJI-001",
        "lat": 22.5,
        "event.name": "obstacle",   # normalized alias added
        "device.id": "DJI-001"      # normalized alias added
    }

Usage
-----
    from app.adapter_engine import apply_adapter

    normalized = apply_adapter(flat_dict, adapter_config)
"""
from __future__ import annotations

from typing import Any

_SENTINEL = object()


def apply_adapter(flat: dict, config: dict) -> dict:
    """Normalize *flat* using *config*, returning an enriched flat dict.

    Parameters
    ----------
    flat : dict
        Output of :func:`app.flatten.flatten_json`.
    config : dict
        Adapter config with key ``"fields"``.
        ``{}`` or missing ``"fields"`` → passthrough (no-op).

    Returns
    -------
    dict
        A **new** dict containing all original keys **plus** any resolved
        normalized aliases.  Original keys are never removed.
    """
    if not config or not isinstance(config.get("fields"), dict):
        # no adapter config → passthrough
        return dict(flat)

    out = dict(flat)  # copy — never mutate caller's dict

    for target_key, candidates in config["fields"].items():
        if not isinstance(candidates, list):
            # tolerate a single string instead of list
            candidates = [candidates]

        resolved = _SENTINEL
        for path in candidates:
            val = flat.get(path, _SENTINEL)
            if val is not _SENTINEL and val is not None:
                resolved = val
                break

        if resolved is not _SENTINEL:
            out[target_key] = resolved
        # if nothing resolved → target key simply absent; downstream default applies

    return out


def get_candidate_value(flat: dict, candidates: list[str]) -> Any:
    """Utility: return first non-None value from *candidates* in *flat*.

    Returns ``None`` if nothing matches.
    """
    for path in candidates:
        val = flat.get(path)
        if val is not None:
            return val
    return None
