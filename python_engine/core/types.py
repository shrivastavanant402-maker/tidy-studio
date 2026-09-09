from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class CleaningAction(str, Enum):
    NORMALIZE_DATETIME = "normalize_datetime"
    FORMAT_PHONE = "format_phone"
    CLAMP_NUMERIC = "clamp_numeric"
    STANDARDIZE_CATEGORICAL = "standardize_categorical"
    OUTLIER_QUARANTINE = "outlier_quarantine"
    DEDUPLICATE_FUZZY = "deduplicate_fuzzy"
    CUSTOM_EXPRESSION = "custom_expression"


class RuleConfig(BaseModel):
    rule_id: str
    action: Union[CleaningAction, str]
    column: str
    params: Dict[str, Any] = Field(default_factory=dict)
    quarantine_on_failure: bool = True
    failure_reason: str = "Constraint violation"


class CleaningRecipe(BaseModel):
    recipe_id: str
    dataset_name: str
    version: str = "2.0.0"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    rules: List[RuleConfig]


class CriticSanityConfig(BaseModel):
    max_null_shift_ratio: float = 0.05  # Maximum 5% increase in null ratio allowed
    max_quarantine_ratio: float = 0.15  # Maximum 15% rows can fail before stage 2 alerts
    required_columns: List[str] = Field(default_factory=list)
    enforce_strict_types: bool = True


class CriticReport(BaseModel):
    stage: str
    passed: bool
    total_rows: int
    quarantined_rows: int
    quarantine_percentage: float = 0.0
    null_percentages: Dict[str, float] = Field(default_factory=dict)
    violations: List[str] = Field(default_factory=list)
    executed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class QuarantineRecord(BaseModel):
    record_id: str
    violated_rule_id: str
    failure_reason: str
    raw_payload: Dict[str, Any]
    quarantined_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
