from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple
import polars as pl

from python_engine.core.types import CleaningRecipe, CriticReport, CriticSanityConfig
from python_engine.core.registry import get_cleaning_rule
from python_engine.core.critic import PipelineCritic
# Ensure builtins are registered
import python_engine.rules.builtins  # noqa: F401


class EnterpriseDataCleaningEngine:
    """
    High-throughput Data Cleaning Engine leveraging Polars streaming LazyFrames.
    Features:
      - Memory-capped streaming execution for multi-gigabyte files
      - Dual-stage Critic validation
      - Zero-data-loss quarantine branching
      - Dynamic modular rule execution
    """

    def __init__(self, recipe: CleaningRecipe, critic_config: Optional[CriticSanityConfig] = None):
        self.recipe = recipe
        self.critic_config = critic_config or CriticSanityConfig()
        self.critic = PipelineCritic(self.critic_config)

    def _sample_baseline_null_ratios(self, lf: pl.LazyFrame) -> Dict[str, float]:
        """Calculates initial null ratios on input without pulling whole dataset into memory."""
        schema = lf.collect_schema()
        exprs = [(pl.col(c).null_count() / pl.len()).alias(c) for c in schema.names()]
        res = lf.select(exprs).collect()
        return {col: float(res[col][0]) for col in res.columns}

    def execute_pipeline(
        self,
        input_source: str | Path | pl.LazyFrame,
        clean_output_path: Optional[str | Path] = None,
        quarantine_output_path: Optional[str | Path] = None,
    ) -> Tuple[bool, pl.DataFrame, pl.DataFrame, CriticReport]:
        """
        Executes the entire end-to-end cleaning pipeline with zero-loss quarantine.
        Returns (success, clean_df, quarantine_df, final_critic_report).
        """
        if isinstance(input_source, pl.LazyFrame):
            lf = input_source
        else:
            p = Path(input_source)
            if not p.exists():
                raise FileNotFoundError(f"Input file not found: {p}")
            if p.suffix.lower() == ".parquet":
                lf = pl.scan_parquet(p)
            elif p.suffix.lower() in [".csv", ".tsv", ".txt"]:
                separator = "\t" if p.suffix.lower() == ".tsv" else ","
                lf = pl.scan_csv(p, separator=separator, ignore_errors=True)
            else:
                raise ValueError(f"Unsupported file format for streaming: {p.suffix}")

        # 1. Stage 1 Critic: Pre-execution Sanity Gate
        pre_report = self.critic.stage_1_pre_check(lf)
        if not pre_report.passed:
            empty_df = pl.DataFrame()
            return False, empty_df, empty_df, pre_report

        baseline_nulls = self._sample_baseline_null_ratios(lf)

        # 2. Initialize Audit Metadata Columns
        current_lf = lf.with_columns([
            pl.lit(False).alias("_is_quarantined"),
            pl.lit("").alias("_violated_rule_id"),
            pl.lit("").alias("_quarantine_reason"),
            pl.lit(datetime.now(timezone.utc).isoformat()).alias("_processed_at"),
        ])

        # 3. Apply Modular Cleaning Rules in Sequence
        for rule in self.recipe.rules:
            action_name = rule.action.value if hasattr(rule.action, "value") else str(rule.action)
            rule_fn = get_cleaning_rule(action_name)
            
            current_lf, quarantine_mask = rule_fn(
                current_lf, {"column": rule.column, **rule.params}
            )

            # Route failed rows into quarantine
            if quarantine_mask is not None and rule.quarantine_on_failure:
                current_lf = current_lf.with_columns([
                    # Mark quarantined if mask is True
                    pl.when(quarantine_mask & (~pl.col("_is_quarantined")))
                    .then(pl.lit(True))
                    .otherwise(pl.col("_is_quarantined"))
                    .alias("_is_quarantined"),

                    # Record first violated rule ID
                    pl.when(quarantine_mask & (pl.col("_violated_rule_id") == ""))
                    .then(pl.lit(rule.rule_id))
                    .otherwise(pl.col("_violated_rule_id"))
                    .alias("_violated_rule_id"),

                    # Record failure reason
                    pl.when(quarantine_mask & (pl.col("_quarantine_reason") == ""))
                    .then(pl.lit(rule.failure_reason))
                    .otherwise(pl.col("_quarantine_reason"))
                    .alias("_quarantine_reason"),
                ])

        # 4. Zero Data Loss Split: Clean vs Quarantined Records
        clean_lf = (
            current_lf.filter(~pl.col("_is_quarantined"))
            .drop(["_is_quarantined", "_violated_rule_id", "_quarantine_reason"])
        )
        quarantine_lf = current_lf.filter(pl.col("_is_quarantined"))

        # 5. Collect with streaming engine
        try:
            clean_df = clean_lf.collect(engine="streaming")
            quarantine_df = quarantine_lf.collect(engine="streaming")
        except TypeError:
            clean_df = clean_lf.collect()
            quarantine_df = quarantine_lf.collect()

        # 6. Stage 2 Critic: Post-execution Quality & Drift Assertions
        post_report = self.critic.stage_2_post_check(clean_df, quarantine_df, baseline_nulls)

        # 7. Write outputs if paths are supplied
        if clean_output_path:
            clean_out_p = Path(clean_output_path)
            clean_out_p.parent.mkdir(parents=True, exist_ok=True)
            if clean_out_p.suffix.lower() == ".parquet":
                clean_df.write_parquet(clean_out_p)
            else:
                clean_df.write_csv(clean_out_p)

        if quarantine_output_path and quarantine_df.height > 0:
            quar_out_p = Path(quarantine_output_path)
            quar_out_p.parent.mkdir(parents=True, exist_ok=True)
            if quar_out_p.suffix.lower() == ".parquet":
                quarantine_df.write_parquet(quar_out_p)
            elif quar_out_p.suffix.lower() in [".ndjson", ".jsonl"]:
                quarantine_df.write_ndjson(quar_out_p)
            else:
                quarantine_df.write_csv(quar_out_p)

        return post_report.passed, clean_df, quarantine_df, post_report
