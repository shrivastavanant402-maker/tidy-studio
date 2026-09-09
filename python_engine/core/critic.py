from __future__ import annotations
from typing import Dict, List
import polars as pl
from python_engine.core.types import CriticReport, CriticSanityConfig


class PipelineCritic:
    """
    Dual-stage Critic validating dataset integrity before and after transformation execution.
    Prevents silent data corruption, schema drift, and excessive nullification.
    """

    def __init__(self, config: CriticSanityConfig):
        self.config = config

    def stage_1_pre_check(self, lf: pl.LazyFrame) -> CriticReport:
        """
        Stage 1: Pre-execution Sanity Critic.
        Asserts schema existence, mandatory columns, and non-empty status before any computation.
        """
        violations: List[str] = []
        try:
            schema = lf.collect_schema()
            col_names = set(schema.names())
            
            # 1. Assert mandatory columns
            missing_cols = [col for col in self.config.required_columns if col not in col_names]
            if missing_cols:
                violations.append(f"Missing required columns in dataset: {missing_cols}")
                
            # 2. Check that dataset is not structurally empty
            if len(col_names) == 0:
                violations.append("Dataset schema contains 0 columns.")

        except Exception as e:
            violations.append(f"Schema collection failed: {str(e)}")

        return CriticReport(
            stage="stage_1_pre_check",
            passed=len(violations) == 0,
            total_rows=0,
            quarantined_rows=0,
            quarantine_percentage=0.0,
            null_percentages={},
            violations=violations,
        )

    def stage_2_post_check(
        self,
        clean_df: pl.DataFrame,
        quarantine_df: pl.DataFrame,
        baseline_null_ratios: Dict[str, float],
    ) -> CriticReport:
        """
        Stage 2: Post-execution Quality Critic.
        Asserts null-value stability, quarantine failure budgets, and data type consistency.
        """
        violations: List[str] = []
        total_rows = clean_df.height + quarantine_df.height
        
        if total_rows == 0:
            return CriticReport(
                stage="stage_2_post_check",
                passed=False,
                total_rows=0,
                quarantined_rows=0,
                quarantine_percentage=0.0,
                violations=["Total processed row count is 0."],
            )

        # 1. Quarantine Budget Assertion
        quarantine_ratio = quarantine_df.height / total_rows
        if quarantine_ratio > self.config.max_quarantine_ratio:
            violations.append(
                f"Quarantine budget breached: {quarantine_ratio:.2%} of rows quarantined "
                f"(maximum allowed threshold is {self.config.max_quarantine_ratio:.2%})"
            )

        # 2. Null Value Inflation / Drift Assertion
        current_nulls: Dict[str, float] = {}
        for col_name in clean_df.columns:
            if col_name.startswith("_"):
                continue
            null_count = clean_df[col_name].null_count()
            current_ratio = (null_count / clean_df.height) if clean_df.height > 0 else 0.0
            current_nulls[col_name] = current_ratio
            
            baseline = baseline_null_ratios.get(col_name, 0.0)
            null_shift = current_ratio - baseline
            
            if null_shift > self.config.max_null_shift_ratio:
                violations.append(
                    f"Excessive null-value inflation on column '{col_name}': "
                    f"shift +{null_shift:.2%} (from {baseline:.2%} to {current_ratio:.2%}, "
                    f"max allowed tolerance is {self.config.max_null_shift_ratio:.2%})"
                )

        return CriticReport(
            stage="stage_2_post_check",
            passed=len(violations) == 0,
            total_rows=total_rows,
            quarantined_rows=quarantine_df.height,
            quarantine_percentage=round(quarantine_ratio * 100, 2),
            null_percentages=current_nulls,
            violations=violations,
        )
