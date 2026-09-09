from __future__ import annotations
from typing import Any, Callable, Dict, Optional, Tuple
import polars as pl

# Rule function signature: (lf: pl.LazyFrame, params: dict) -> Tuple[transformed_lf, quarantine_mask_expr_or_none]
CleaningRuleFn = Callable[[pl.LazyFrame, Dict[str, Any]], Tuple[pl.LazyFrame, Optional[pl.Expr]]]

_RULE_REGISTRY: Dict[str, CleaningRuleFn] = {}


def register_cleaning_rule(name: str):
    """
    Decorator to register an independent, modular cleaning rule.
    Allows extending the agent without modifying core pipeline code.
    """
    def decorator(fn: CleaningRuleFn) -> CleaningRuleFn:
        _RULE_REGISTRY[name] = fn
        return fn
    return decorator


def get_cleaning_rule(name: str) -> CleaningRuleFn:
    """Retrieves a registered rule function by its action name."""
    if name not in _RULE_REGISTRY:
        raise KeyError(
            f"Cleaning rule '{name}' is not registered. Available rules: {list(_RULE_REGISTRY.keys())}"
        )
    return _RULE_REGISTRY[name]


def list_registered_rules() -> list[str]:
    """Returns all currently registered rule names."""
    return list(_RULE_REGISTRY.keys())
