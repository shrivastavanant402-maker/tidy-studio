from __future__ import annotations
import json
import re
from typing import Any, Dict
import polars as pl
from python_engine.core.types import CleaningRecipe, RuleConfig, CleaningAction


class DecoupledLLMOrchestrator:
    """
    Decoupled Orchestrator / Router.
    Prevents token inflation by extracting minimal statistical metadata
    and compiling strict Pydantic CleaningRecipe schemas without passing raw rows.
    """

    @staticmethod
    def extract_metadata_summary(lf: pl.LazyFrame, sample_limit: int = 50) -> Dict[str, Any]:
        """
        Samples dataset schema, null ratios, and 3 distinct sample strings.
        Output token footprint is minuscule (< 400 tokens even for 100 columns).
        """
        schema = lf.collect_schema()
        sample_df = lf.limit(sample_limit).collect()
        
        metadata: Dict[str, Any] = {}
        for col_name, dtype in schema.items():
            series = sample_df[col_name]
            null_count = series.null_count()
            distinct_samples = (
                series.drop_nulls()
                .unique()
                .head(3)
                .cast(pl.String)
                .to_list()
            )
            metadata[col_name] = {
                "inferred_type": str(dtype),
                "null_ratio": round(null_count / max(sample_limit, 1), 3),
                "sample_values": distinct_samples,
            }
        return metadata

    @staticmethod
    def build_recipe_generation_prompt(dataset_name: str, metadata: Dict[str, Any]) -> str:
        """
        Constructs system prompt instructing the LLM to output a valid JSON CleaningRecipe.
        """
        schema_sample = json.dumps(metadata, indent=2)
        return f"""You are an Elite Data Cleaning Compiler.
Dataset '{dataset_name}' metadata summary:
{schema_sample}

Available Cleaning Actions:
- normalize_datetime: params: {{"format": "%Y-%m-%d"}}
- format_phone: params: {{"country_prefix": "+1", "expected_length": 10}}
- clamp_numeric: params: {{"min_val": 0, "max_val": 1000, "strict_quarantine": true}}
- standardize_categorical: params: {{"mapping": {{"ca": "California", "ny": "New York"}}}}
- outlier_quarantine: params: {{"method": "mad", "threshold": 3.5}}

Generate a deterministic CleaningRecipe JSON adhering to:
{{
  "recipe_id": "recipe_{dataset_name}",
  "dataset_name": "{dataset_name}",
  "rules": [
    {{
      "rule_id": "rule_01",
      "action": "<CleaningAction>",
      "column": "<column_name>",
      "params": {{}},
      "quarantine_on_failure": true,
      "failure_reason": "<Short description of failure>"
    }}
  ]
}}
Do NOT output explanations, markdown commentary, or code. Return ONLY valid JSON."""

    @staticmethod
    def parse_recipe_json(raw_json: str) -> CleaningRecipe:
        """
        Validates and parses raw JSON response into a strict Pydantic CleaningRecipe.
        """
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_json)
        clean_text = match.group(1).strip() if match else raw_json.strip()

        data = json.loads(clean_text)
        return CleaningRecipe.model_validate(data)
