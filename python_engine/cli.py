from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
import polars as pl
from python_engine.core.types import CleaningRecipe, CriticSanityConfig
from python_engine.pipeline.engine import EnterpriseDataCleaningEngine
from python_engine.orchestrator.agent import DecoupledLLMOrchestrator


def main():
    parser = argparse.ArgumentParser(
        description="Enterprise Zero-Loss Data Cleaning Engine (Polars LazyFrame Streaming)"
    )
    parser.add_argument("--input", "-i", required=True, help="Input CSV/TSV/Parquet file path")
    parser.add_argument("--recipe", "-r", help="Path to JSON CleaningRecipe file")
    parser.add_argument("--output-clean", "-o", default="clean_output.parquet", help="Clean dataset output path")
    parser.add_argument("--output-quarantine", "-q", default="quarantine_log.parquet", help="Quarantine output path")
    parser.add_argument("--auto-recipe", action="store_true", help="Generate recipe template from schema metadata")

    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: input file '{input_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    # Scan lazily
    if input_path.suffix.lower() == ".parquet":
        lf = pl.scan_parquet(input_path)
    else:
        lf = pl.scan_csv(input_path, ignore_errors=True)

    if args.auto_recipe or not args.recipe:
        print("\n--- Dataset Metadata Summary (Zero-Token-Waste Schema Sample) ---")
        metadata = DecoupledLLMOrchestrator.extract_metadata_summary(lf)
        print(json.dumps(metadata, indent=2))
        prompt = DecoupledLLMOrchestrator.build_recipe_generation_prompt(input_path.stem, metadata)
        print("\n--- LLM Recipe Orchestrator Prompt Template ---")
        print(prompt)
        if not args.recipe:
            print("\nPlease provide a --recipe file to execute the pipeline.")
            sys.exit(0)

    recipe_path = Path(args.recipe)
    with open(recipe_path, "r", encoding="utf-8") as f:
        recipe_data = json.load(f)
    recipe = CleaningRecipe.model_validate(recipe_data)

    print(f"\nStarting pipeline execution with recipe: {recipe.recipe_id}...")
    engine = EnterpriseDataCleaningEngine(recipe, CriticSanityConfig())
    passed, clean_df, quarantine_df, report = engine.execute_pipeline(
        lf, clean_output_path=args.output_clean, quarantine_output_path=args.output_quarantine
    )

    print(f"Stage 1 & 2 Critic Status: {'PASSED' if passed else 'FAILED'}")
    if report.violations:
        print("Critic Violations:")
        for v in report.violations:
            print(f"  - {v}")
    print(f"Clean rows output: {clean_df.height:,} -> {args.output_clean}")
    print(f"Quarantined rows: {quarantine_df.height:,} ({report.quarantine_percentage}%) -> {args.output_quarantine}")

    if not passed:
        sys.exit(2)


if __name__ == "__main__":
    main()
