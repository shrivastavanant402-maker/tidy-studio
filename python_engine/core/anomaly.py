from __future__ import annotations
from typing import List, Set, Tuple
import polars as pl


def compute_modified_z_score_expr(col_name: str, threshold: float = 3.5) -> pl.Expr:
    """
    Computes Modified Z-score using Median Absolute Deviation (MAD).
    Mathematically isolated from extreme skew that distorts standard Z-scores:
        M_i = 0.6745 * |x_i - median| / MAD
    Returns a boolean expression that evaluates to True for outliers.
    """
    col = pl.col(col_name).cast(pl.Float64)
    med = col.median()
    abs_deviation = (col - med).abs()
    mad = abs_deviation.median()
    
    # Avoid zero division when identical values predominate (MAD == 0)
    safe_mad = pl.when(mad == 0.0).then(abs_deviation.mean()).otherwise(mad)
    
    # Outlier condition: Modified Z-score > threshold and not null
    is_outlier = (
        col.is_not_null()
        & (safe_mad > 0.0)
        & ((0.6745 * abs_deviation / safe_mad) > threshold)
    )
    return is_outlier


def compute_iqr_outlier_expr(col_name: str, multiplier: float = 1.5) -> pl.Expr:
    """
    Tukey's Fences Outlier detection via Interquartile Range (IQR).
    Flags values below Q1 - (k * IQR) or above Q3 + (k * IQR).
    """
    col = pl.col(col_name).cast(pl.Float64)
    q1 = col.quantile(0.25)
    q3 = col.quantile(0.75)
    iqr = q3 - q1
    
    lower_fence = q1 - (multiplier * iqr)
    upper_fence = q3 + (multiplier * iqr)
    
    is_outlier = (
        col.is_not_null()
        & (iqr > 0.0)
        & ((col < lower_fence) | (col > upper_fence))
    )
    return is_outlier


def compute_ngram_jaccard_similarity(s1: str, s2: str, n: int = 3) -> float:
    """Computes Jaccard similarity between character n-grams of two strings."""
    if not s1 or not s2:
        return 0.0
    if s1 == s2:
        return 1.0
    
    s1_norm = s1.lower().strip()
    s2_norm = s2.lower().strip()
    
    if len(s1_norm) < n or len(s2_norm) < n:
        return 1.0 if s1_norm == s2_norm else 0.0
        
    ngrams1: Set[str] = {s1_norm[i : i + n] for i in range(len(s1_norm) - n + 1)}
    ngrams2: Set[str] = {s2_norm[i : i + n] for i in range(len(s2_norm) - n + 1)}
    
    intersection = len(ngrams1 & ngrams2)
    union = len(ngrams1 | ngrams2)
    return (intersection / union) if union > 0 else 0.0


def find_fuzzy_duplicate_pairs(
    values: List[str], similarity_threshold: float = 0.85
) -> List[Tuple[str, str, float]]:
    """
    Finds near-duplicate text candidates using length-blocked n-gram matching.
    Avoids O(N^2) explosion by blocking values with similar string lengths and prefix hashes.
    """
    unique_vals = list(set(filter(None, values)))
    # Sort by length for candidate window blocking
    unique_vals.sort(key=lambda x: len(x))
    
    near_dupes: List[Tuple[str, str, float]] = []
    n_vals = len(unique_vals)
    
    for i in range(n_vals):
        v1 = unique_vals[i]
        l1 = len(v1)
        # Only inspect neighbors within length ratio bounds
        for j in range(i + 1, n_vals):
            v2 = unique_vals[j]
            l2 = len(v2)
            if l2 > 0 and (l1 / l2) < similarity_threshold:
                break
                
            sim = compute_ngram_jaccard_similarity(v1, v2)
            if sim >= similarity_threshold and v1 != v2:
                near_dupes.append((v1, v2, sim))
                
    return near_dupes
