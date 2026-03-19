"""
app/mapping_engine.py
=====================
Field mapping engine — supports two formats simultaneously.

────────────────────────────────────────────────────────────────────
FORMAT A — Legacy list format  (unchanged, fully backward-compatible)
────────────────────────────────────────────────────────────────────
{
    "mappings": [
        {"src": "$.creator_id", "dst": "creator_id", "type": "string",
         "default": "system", "required": true}
    ]
}

────────────────────────────────────────────────────────────────────
FORMAT B — New DSL dict format
────────────────────────────────────────────────────────────────────
{
    "dsl": {
        "creator_id": {
            "from":      ["creator_id", "operator_id"],  # flat-dict keys, tried in order
            "type":      "string",
            "default":   "unknown",
            "required":  false,

            # OPTIONAL — simple value swap
            "cases": [
                {"if": "$.level == 'critical'", "then": "CRITICAL"},
                {"if": "$.level == 'warning'",  "then": "WARNING"}
            ],

            # OPTIONAL — one built-in transform applied after resolution
            "transform": "upper"   # upper | lower | strip | int | float | bool | str
        }
    }
}

Both formats may coexist in the same config dict.  DSL runs first, then legacy.

Public API (signature UNCHANGED)
---------------------------------
    apply_mappings(webhook_event, source, mapping_conf, received_at) -> dict

The function auto-detects format from the config keys.
"""
from __future__ import annotations

import re
from typing import Any

from jsonpath_ng import parse as jp

# ── Type casters (shared by both formats) ────────────────────────────────────

TYPE_CASTERS = {
    "string": lambda v: "" if v is None else str(v),
    "int":    lambda v: int(v),
    "float":  lambda v: float(v),
    "bool":   lambda v: bool(v),
    "json":   lambda v: v,
}

# ── Built-in transforms for DSL "transform" key ──────────────────────────────

_TRANSFORMS: dict[str, Any] = {
    "upper":   lambda v: str(v).upper()   if v is not None else v,
    "lower":   lambda v: str(v).lower()   if v is not None else v,
    "strip":   lambda v: str(v).strip()   if v is not None else v,
    "int":     lambda v: int(v)           if v is not None else v,
    "float":   lambda v: float(v)         if v is not None else v,
    "bool":    lambda v: bool(v)          if v is not None else v,
    "str":     lambda v: str(v)           if v is not None else v,
}

# ── JSONPath helper (used by legacy format) ───────────────────────────────────

def extract_jsonpath(obj: Any, path: str) -> Any:
    """Extract first match of *path* from *obj*.  Returns ``None`` if not found."""
    expr = jp(path)
    matches = [m.value for m in expr.find(obj)]
    return matches[0] if matches else None


# ── "cases" evaluator for DSL format ─────────────────────────────────────────

_CMP_RE = re.compile(
    r"""^\$\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(['"]?)(.+?)\3$"""
)

def _eval_case_condition(condition: str, event: dict) -> bool:
    """Evaluate a simple condition string against *event*.

    Supported syntax::

        $.field_name == 'value'
        $.field_name != 'value'
        $.field_name >= 42

    Only **flat-key** access (no nested path).  Complex expressions are
    silently skipped (returns False).
    """
    m = _CMP_RE.match(condition.strip())
    if not m:
        return False
    field, op, _quote, raw_val = m.groups()
    actual = event.get(field)

    # coerce raw_val to match actual type when possible
    if actual is not None:
        try:
            if isinstance(actual, (int, float)):
                raw_val = type(actual)(raw_val)
            elif isinstance(actual, bool):
                raw_val = raw_val.lower() in ("true", "1", "yes")
        except (ValueError, TypeError):
            pass

    ops = {
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        ">":  lambda a, b: a > b,
        "<":  lambda a, b: a < b,
    }
    try:
        return ops[op](actual, raw_val)
    except TypeError:
        return False


# ── DSL format handler ────────────────────────────────────────────────────────

def _apply_dsl(flat_event: dict, dsl: dict, unified: dict) -> None:
    """Process DSL mappings, writing results into *unified* (mutates in place).

    Parameters
    ----------
    flat_event : dict
        The already-flattened (and adapter-normalized) event dict.
    dsl : dict
        The ``"dsl"`` sub-dict from the mapping config.
    unified : dict
        Output dict to populate.
    """
    for dst, rule in dsl.items():
        if not isinstance(rule, dict):
            # simple shorthand: "dst": "src_key"  (string alias)
            val = flat_event.get(str(rule))
            unified[dst] = val
            continue

        # ── 1. Resolve value from "from" paths ────────────────────────────
        from_paths: list[str] = rule.get("from", [])
        if isinstance(from_paths, str):
            from_paths = [from_paths]

        val = None
        for path in from_paths:
            candidate = flat_event.get(path)
            if candidate is not None:
                val = candidate
                break

        # ── 2. Apply "cases" (optional override) ──────────────────────────
        for case in rule.get("cases", []):
            cond = case.get("if", "")
            if _eval_case_condition(cond, flat_event):
                val = case.get("then", val)
                break

        # ── 3. Apply default if still None ────────────────────────────────
        if val is None:
            val = rule.get("default")

        # ── 4. required check ─────────────────────────────────────────────
        if val is None and rule.get("required", False):
            raise ValueError(f"[DSL] required field missing: {dst}")

        # ── 5. Apply transform (optional) ─────────────────────────────────
        transform = rule.get("transform")
        if transform and val is not None:
            fn = _TRANSFORMS.get(transform)
            if fn:
                try:
                    val = fn(val)
                except Exception as exc:
                    raise ValueError(
                        f"[DSL] transform '{transform}' failed on field '{dst}': {exc}"
                    ) from exc

        # ── 6. Type cast (optional, same keys as legacy) ──────────────────
        tp = rule.get("type")
        if tp and val is not None:
            caster = TYPE_CASTERS.get(tp)
            if caster:
                try:
                    val = caster(val)
                except Exception as exc:
                    raise ValueError(
                        f"[DSL] type cast failed: {dst} as {tp}, value={val!r}"
                    ) from exc

        unified[dst] = val


# ── Legacy list format handler (ORIGINAL CODE, untouched) ────────────────────

def _apply_legacy(webhook_event: dict, mappings: list, unified: dict) -> None:
    """Original list-format mapping logic — NOT modified."""
    for row in mappings:
        src = row.get("src")
        dst = row.get("dst")
        tp = row.get("type", "string")
        default = row.get("default", None)
        required = bool(row.get("required", False))

        if not src or not dst:
            continue

        val = extract_jsonpath(webhook_event, src)
        if val is None:
            val = default

        if val is None and required:
            raise ValueError(f"required field missing: {dst} (from {src})")

        if val is not None:
            caster = TYPE_CASTERS.get(tp, TYPE_CASTERS["string"])
            try:
                val = caster(val)
            except Exception as e:
                raise ValueError(
                    f"type cast failed: {dst} as {tp}, value={val}"
                ) from e

        unified[dst] = val


# ── Public API (signature unchanged) ─────────────────────────────────────────

def apply_mappings(
    webhook_event: dict,
    source: str,
    mapping_conf: dict,
    received_at: int,
    flat_event: dict | None = None,    # NEW optional param — pre-flattened dict
) -> dict:
    """Apply field mappings and return a unified context dict.

    Signature is **backward-compatible**.  The new ``flat_event`` parameter
    is optional; when omitted the function behaves exactly as before.

    Parameters
    ----------
    webhook_event : dict
        Raw (nested) webhook payload.
    source : str
        Source identifier (e.g. ``"flighthub2"``).
    mapping_conf : dict
        Mapping configuration.  Supports legacy ``"mappings"`` list
        and/or new ``"dsl"`` dict.
    received_at : int
        Unix timestamp of ingestion.
    flat_event : dict | None
        Pre-flattened + adapter-normalized event.  When provided, DSL rules
        read from this dict instead of re-flattening *webhook_event*.
        Legacy JSONPath rules always operate on the original *webhook_event*.

    Returns
    -------
    dict
        Unified context dict ready for template rendering.
    """
    unified: dict[str, Any] = {
        "source":    source,
        "timestamp": received_at,
        "raw":       webhook_event,
    }

    # DSL format — uses flat_event if available, otherwise falls back to
    # a simple flat view of webhook_event for "from" path resolution
    dsl = mapping_conf.get("dsl")
    if dsl and isinstance(dsl, dict):
        _flat = flat_event if flat_event is not None else webhook_event
        _apply_dsl(_flat, dsl, unified)

    # Legacy list format — always uses original webhook_event with JSONPath
    legacy = mapping_conf.get("mappings", [])
    if legacy and isinstance(legacy, list):
        _apply_legacy(webhook_event, legacy, unified)

    return unified
