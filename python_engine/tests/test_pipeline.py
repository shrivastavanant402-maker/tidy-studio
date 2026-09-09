from __future__ import annotations
import unittest
import polars as pl
from python_engine.core.types import (
    CleaningAction,
    CleaningRecipe,
    CriticSanityConfig,
    RuleConfig,
)
from python_engine.core.registry import register_cleaning_rule
from python_engine.pipeline.engine import EnterpriseDataCleaningEngine
from python_engine.core.anomaly import compute_modified_z_score_expr, compute_iqr_outlier_expr
from python_engine.orchestrator.agent import DecoupledLLMOrchestrator


class TestEnterpriseDataCleaningEngine(unittest.TestCase):

    def setUp(self):
        # Create a realistic test LazyFrame with valid and non-conforming rows
        self.sample_data = pl.DataFrame({
            "user_id": [1, 2, 3, 4, 5, 6, 7],
            "signup_date": [
                "2026-01-15",
                "2026-02-20",
                "NOT_A_DATE",  # Should be quarantined
                "2026-03-01",
                "2026-04-12",
                "2026-05-30",
                "2026-06-18",
            ],
            "phone": [
                "555-123-4567",
                "5559876543",
                "555-456-7890",
                "123",  # Invalid phone length -> quarantine
                "(555) 789-0123",
                "555-000-1111",
                "555-222-3333",
            ],
            "amount": [100.0, 150.0, 200.0, 120.0, 180.0, 99999.0, 130.0],  # 99999.0 is extreme outlier
            "state": ["CA", "ca", "California", "NY", "new york", "CA", "TX"],
        }).lazy()

    def test_zero_data_loss_quarantine(self):
        """Verifies that failed records are safely branched into quarantine rather than deleted/nullified."""
        recipe = CleaningRecipe(
            recipe_id="test_zero_loss",
            dataset_name="user_transactions",
            rules=[
                RuleConfig(
                    rule_id="r_date",
                    action=CleaningAction.NORMALIZE_DATETIME,
                    column="signup_date",
                    params={"format": "%Y-%m-%d"},
                    failure_reason="Invalid date format",
                ),
                RuleConfig(
                    rule_id="r_phone",
                    action=CleaningAction.FORMAT_PHONE,
                    column="phone",
                    params={"country_prefix": "+1", "expected_length": 10},
                    failure_reason="Malformed phone number",
                ),
            ],
        )

        engine = EnterpriseDataCleaningEngine(
            recipe,
            CriticSanityConfig(max_quarantine_ratio=0.5, required_columns=["user_id", "signup_date", "phone"]),
        )

        passed, clean_df, quarantine_df, report = engine.execute_pipeline(self.sample_data)

        self.assertTrue(passed)
        # Total rows must be conserved: clean + quarantine == total
        self.assertEqual(clean_df.height + quarantine_df.height, 7)
        # 2 rows should be quarantined: row 3 (NOT_A_DATE) and row 4 (phone "123")
        self.assertEqual(quarantine_df.height, 2)
        self.assertEqual(clean_df.height, 5)

        # Audit columns must exist in quarantine dataset
        self.assertIn("_violated_rule_id", quarantine_df.columns)
        self.assertIn("_quarantine_reason", quarantine_df.columns)

        quarantined_reasons = set(quarantine_df["_quarantine_reason"].to_list())
        self.assertIn("Invalid date format", quarantined_reasons)
        self.assertIn("Malformed phone number", quarantined_reasons)

    def test_critic_stage_1_mandatory_columns(self):
        """Stage 1 Critic must reject execution before processing if required column is missing."""
        recipe = CleaningRecipe(
            recipe_id="test_pre_critic",
            dataset_name="test_ds",
            rules=[],
        )
        engine = EnterpriseDataCleaningEngine(
            recipe,
            CriticSanityConfig(required_columns=["user_id", "non_existent_column"]),
        )
        passed, clean_df, quarantine_df, report = engine.execute_pipeline(self.sample_data)
        self.assertFalse(passed)
        self.assertEqual(report.stage, "stage_1_pre_check")
        self.assertTrue(any("non_existent_column" in v for v in report.violations))

    def test_critic_stage_2_quarantine_budget_breach(self):
        """Stage 2 Critic must fail when quarantine ratio exceeds max budget."""
        recipe = CleaningRecipe(
            recipe_id="test_post_critic",
            dataset_name="test_ds",
            rules=[
                RuleConfig(
                    rule_id="r_strict_phone",
                    action=CleaningAction.FORMAT_PHONE,
                    column="phone",
                    params={"country_prefix": "+1", "expected_length": 10},
                    failure_reason="Malformed phone",
                )
            ],
        )
        # Strictest threshold: at most 5% quarantine allowed (1 of 7 is ~14.3%)
        engine = EnterpriseDataCleaningEngine(
            recipe,
            CriticSanityConfig(max_quarantine_ratio=0.05),
        )
        passed, clean_df, quarantine_df, report = engine.execute_pipeline(self.sample_data)
        self.assertFalse(passed)
        self.assertEqual(report.stage, "stage_2_post_check")
        self.assertTrue(any("Quarantine budget breached" in v for v in report.violations))

    def test_modified_z_score_anomaly_detection(self):
        """Modified Z-score (MAD) must isolate extreme numeric outlier."""
        df = self.sample_data.collect()
        outliers_mad = df.select(compute_modified_z_score_expr("amount", threshold=3.5))
        # Value 99999.0 should be flagged
        flagged = outliers_mad.to_series().to_list()
        self.assertEqual(flagged[5], True)  # Row 6 (index 5) is 99999.0
        self.assertEqual(sum(flagged), 1)

    def test_modular_rule_extension(self):
        """Verify dynamic rule registration without changing engine code."""
        @register_cleaning_rule("custom_uppercase_strip")
        def custom_rule(lf: pl.LazyFrame, params: dict):
            col = params["column"]
            transformed = lf.with_columns(
                pl.col(col).str.to_uppercase().str.strip_chars().alias(col)
            )
            return transformed, None

        recipe = CleaningRecipe(
            recipe_id="test_custom",
            dataset_name="test_ds",
            rules=[
                RuleConfig(
                    rule_id="r_custom",
                    action="custom_uppercase_strip",
                    column="state",
                    failure_reason="Custom check",
                )
            ],
        )

        engine = EnterpriseDataCleaningEngine(recipe, CriticSanityConfig(max_quarantine_ratio=1.0))
        passed, clean_df, _, _ = engine.execute_pipeline(self.sample_data)
        self.assertTrue(passed)
        states = clean_df["state"].to_list()
        self.assertIn("CALIFORNIA", states)
        self.assertIn("NEW YORK", states)

    def test_decoupled_llm_orchestrator(self):
        """Verifies metadata summary generation and structured JSON recipe parsing."""
        metadata = DecoupledLLMOrchestrator.extract_metadata_summary(self.sample_data, sample_limit=10)
        self.assertIn("user_id", metadata)
        self.assertIn("signup_date", metadata)
        self.assertIn("sample_values", metadata["signup_date"])

        prompt = DecoupledLLMOrchestrator.build_recipe_generation_prompt("users", metadata)
        self.assertIn("Available Cleaning Actions", prompt)
        self.assertIn("users", prompt)

        mock_llm_json = """
        ```json
        {
          "recipe_id": "recipe_users_auto",
          "dataset_name": "users",
          "rules": [
            {
              "rule_id": "r1",
              "action": "normalize_datetime",
              "column": "signup_date",
              "params": {"format": "%Y-%m-%d"},
              "quarantine_on_failure": true,
              "failure_reason": "Invalid date"
            }
          ]
        }
        ```
        """
        recipe = DecoupledLLMOrchestrator.parse_recipe_json(mock_llm_json)
        self.assertEqual(recipe.recipe_id, "recipe_users_auto")
        self.assertEqual(len(recipe.rules), 1)
        self.assertEqual(recipe.rules[0].action, CleaningAction.NORMALIZE_DATETIME)


if __name__ == "__main__":
    unittest.main()
