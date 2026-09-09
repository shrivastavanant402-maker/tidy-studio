from __future__ import annotations
from typing import Any, Dict, Optional, Tuple
import polars as pl
from python_engine.core.registry import register_cleaning_rule
from python_engine.core.anomaly import compute_modified_z_score_expr, compute_iqr_outlier_expr


@register_cleaning_rule("normalize_datetime")
def normalize_datetime_rule(
    lf: pl.LazyFrame, params: Dict[str, Any]
) -> Tuple[pl.LazyFrame, Optional[pl.Expr]]:
    """
    Parses and normalizes dates to ISO-8601 strings.
    If a non-null string cannot be parsed, marks the row for quarantine.
    """
    col_name = params["column"]
    target_format = params.get("format", "%Y-%m-%d")
    
    col_str = pl.col(col_name).cast(pl.String)
    # Try parsing to Date or Datetime
    parsed_date = col_str.str.to_date(format=target_format, strict=False)
    flexible_parsed = (
        pl.when(parsed_date.is_not_null())
        .then(parsed_date)
        .otherwise(col_str.str.to_date(strict=False))
    )
    
    iso_string = flexible_parsed.dt.to_string("%Y-%m-%d")
    
    orig_has_val = col_str.is_not_null() & (col_str.str.strip_chars() != "")
    quarantine_mask = orig_has_val & flexible_parsed.is_null()
    
    transformed_lf = lf.with_columns(
        pl.when(quarantine_mask)
        .then(col_str)
        .otherwise(iso_string)
        .alias(col_name)
    )
    return transformed_lf, quarantine_mask


@register_cleaning_rule("format_phone")
def format_phone_rule(
    lf: pl.LazyFrame, params: Dict[str, Any]
) -> Tuple[pl.LazyFrame, Optional[pl.Expr]]:
    """
    Normalizes phone numbers to standard E.164-compatible format.
    Isolates invalid digit counts into quarantine.
    """
    col_name = params["column"]
    country_prefix = params.get("country_prefix", "+1")
    expected_length = params.get("expected_length", 10)
    
    col_str = pl.col(col_name).cast(pl.String)
    digits = col_str.str.replace_all(r"\D", "")
    
    # Handle optional leading country code (e.g. 1-555-123-4567 -> 5551234567)
    digits_norm = (
        pl.when((digits.str.len_bytes() == expected_length + 1) & digits.str.starts_with("1"))
        .then(digits.str.slice(1, expected_length))
        .otherwise(digits)
    )
    
    valid_length = digits_norm.str.len_bytes() == expected_length
    orig_has_val = col_str.is_not_null() & (col_str.str.strip_chars() != "")
    
    quarantine_mask = orig_has_val & (digits_norm.str.len_bytes() != expected_length)
    
    formatted = (
        pl.when(valid_length)
        .then(
            pl.concat_str([
                pl.lit(f"{country_prefix} ("),
                digits_norm.str.slice(0, 3),
                pl.lit(") "),
                digits_norm.str.slice(3, 3),
                pl.lit("-"),
                digits_norm.str.slice(6, 4),
            ])
        )
        .otherwise(col_str)
    )
    
    transformed_lf = lf.with_columns(formatted.alias(col_name))
    return transformed_lf, quarantine_mask


@register_cleaning_rule("clamp_numeric")
def clamp_numeric_rule(
    lf: pl.LazyFrame, params: Dict[str, Any]
) -> Tuple[pl.LazyFrame, Optional[pl.Expr]]:
    """
    Clamps numeric values within [min_val, max_val] or quarantines out-of-bounds rows.
    """
    col_name = params["column"]
    min_val = params.get("min_val")
    max_val = params.get("max_val")
    strict_quarantine = params.get("strict_quarantine", False)
    
    col = pl.col(col_name).cast(pl.Float64)
    
    if min_val is not None and max_val is not None:
        out_of_bounds = (col < min_val) | (col > max_val)
    elif min_val is not None:
        out_of_bounds = col < min_val
    elif max_val is not None:
        out_of_bounds = col > max_val
    else:
        return lf, None

    if strict_quarantine:
        quarantine_expr = col.is_not_null() & out_of_bounds
        return lf, quarantine_expr
    else:
        clamped = col.clip(min_val, max_val)
        return lf.with_columns(clamped.alias(col_name)), None


@register_cleaning_rule("standardize_categorical")
def standardize_categorical_rule(
    lf: pl.LazyFrame, params: Dict[str, Any]
) -> Tuple[pl.LazyFrame, Optional[pl.Expr]]:
    """
    Maps spelling variations, casing variants, or abbreviations to canonical categories.
    """
    col_name = params["column"]
    mapping: Dict[str, str] = params.get("mapping", {})
    case_fold = params.get("case_fold", True)
    
    if not mapping:
        return lf, None

    expr = pl.col(col_name).cast(pl.String)
    if case_fold:
        expr_key = expr.str.strip_chars().str.to_lowercase()
        clean_map = {k.lower().strip(): v for k, v in mapping.items()}
    else:
        expr_key = expr.str.strip_chars()
        clean_map = mapping

    replace_expr = expr_key.replace_strict(clean_map, default=expr)
    transformed_lf = lf.with_columns(replace_expr.alias(col_name))
    return transformed_lf, None


@register_cleaning_rule("outlier_quarantine")
def outlier_quarantine_rule(
    lf: pl.LazyFrame, params: Dict[str, Any]
) -> Tuple[pl.LazyFrame, Optional[pl.Expr]]:
    """
    Mathematically isolates outliers using Modified Z-Score (MAD) or Tukey's IQR Fences.
    """
    col_name = params["column"]
    method = params.get("method", "mad").lower()
    
    if method == "mad":
        threshold = params.get("threshold", 3.5)
        outlier_expr = compute_modified_z_score_expr(col_name, threshold=threshold)
    else:
        multiplier = params.get("multiplier", 1.5)
        outlier_expr = compute_iqr_outlier_expr(col_name, multiplier=multiplier)

    return lf, outlier_expr
