"""
app/normalize.py
================
Lightweight normalization layer: applies adapter config to a flat dict,
then produces a clean 'normalized fields' dict used by the visual mapper.

Pipeline position
-----------------
    flatten → **normalize** → mapping → autofill → template → HTTP

Public API
----------
    normalize(flat, adapter_conf) -> dict
    get_normalized_fields(flat, adapter_conf) -> list[str]
"""
from __future__ import annotations

from app.adapter_engine import apply_adapter


def normalize(flat: dict, adapter_conf: dict) -> dict:
    """Apply adapter config to flat dict, return normalized dict.

    This is a thin wrapper around apply_adapter that ensures a clean,
    well-documented entry point for the normalize stage.

    Parameters
    ----------
    flat : dict
        Output of flatten_json().
    adapter_conf : dict
        Adapter config from uw:adapter:{source}.
        Pass {} for no-op.

    Returns
    -------
    dict
        Normalized flat dict with alias keys injected.
    """
    return apply_adapter(flat, adapter_conf)


def get_normalized_fields(flat: dict, adapter_conf: dict) -> list[str]:
    """Return sorted list of all available normalized field names.

    Combines original flat keys with any adapter-added aliases.
    Used by the frontend FieldList to populate the left panel.

    Parameters
    ----------
    flat : dict
        Output of flatten_json().
    adapter_conf : dict
        Adapter config.

    Returns
    -------
    list[str]
        Sorted list of field names available after normalization.
    """
    normalized = normalize(flat, adapter_conf)
    # Filter out empty/None values for display
    return sorted(k for k, v in normalized.items() if v is not None)
