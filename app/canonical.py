"""
app/canonical.py
================
Build a lightweight canonical event envelope from mapping output.

Pipeline position
-----------------
    flatten → adapter → mapping → **canonical** → enrichment → template

Purpose
-------
Normalise every message into a predictable shape so that enrichment and
template stages can rely on a stable contract, regardless of the source
system or mapping config used.

Design choices
--------------
* Minimal struct — only guaranteed fields are present.
* ``raw`` is carried through for debugging / fallback access.
* ``location`` starts as an empty dict; enrichment may fill it.
* UUID is generated deterministically-ish (uuid4 at intake time).
* No heavy validation — this layer is deliberately thin.

Public API
----------
    build_event(mapped, raw, source) -> dict
"""
from __future__ import annotations

import uuid
from typing import Any


def build_event(
    mapped: dict[str, Any],
    raw: dict[str, Any],
    source: str,
) -> dict[str, Any]:
    """Build canonical event envelope.

    Parameters
    ----------
    mapped : dict
        Output of :func:`app.mapping_engine.apply_mappings`.
        Expected optional keys: ``event_type``, ``timestamp``, ``device_id``,
        ``lat``, ``lng``, ``alt``.
    raw : dict
        Original (unmodified) ``webhook_event`` from the ingress payload.
        Kept for traceability; template may reference ``raw.*`` fields.
    source : str
        Source identifier (e.g. ``"flighthub2"``).

    Returns
    -------
    dict
        Canonical event dict with structure::

            {
                "id":         str,        # uuid4
                "source":     str,
                "event_type": str | None,
                "timestamp":  Any,        # passed through from mapped
                "device": {
                    "id": str | None
                },
                "location": {             # empty; filled by enrich()
                    "lat": float | None,
                    "lng": float | None,
                    "alt": float | None,
                },
                "raw": dict,              # original webhook_event
                **mapped                  # all mapped fields merged in
            }

    Notes
    -----
    * ``mapped`` fields are merged in at the top level so templates like
      ``{{creator_id}}`` continue to work without any changes.
    * ``id``, ``source``, ``event_type``, ``device``, ``location``, ``raw``
      are set *after* the spread so they cannot be accidentally overwritten
      by mapping output.
    """
    # Pre-extract location fields from mapped (may come from enrichment later)
    lat = _to_float(mapped.get("lat") or mapped.get("latitude"))
    lng = _to_float(mapped.get("lng") or mapped.get("longitude"))
    alt = _to_float(mapped.get("alt") or mapped.get("altitude"))

    event: dict[str, Any] = {
        # spread all mapped fields first — keeps template compatibility
        **mapped,

        # guaranteed envelope fields (override any mapping key collision)
        "id":         str(uuid.uuid4()),
        "source":     source,
        "event_type": mapped.get("event_type"),
        "timestamp":  mapped.get("timestamp"),

        "device": {
            "id": mapped.get("device_id") or mapped.get("device.id"),
        },

        "location": {
            "lat": lat,
            "lng": lng,
            "alt": alt,
        },

        "raw": raw,
    }
    return event


# ── Private helpers ──────────────────────────────────────────────────────────

def _to_float(v: Any) -> float | None:
    """Coerce *v* to float; return None on failure."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
