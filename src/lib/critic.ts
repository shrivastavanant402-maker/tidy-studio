export type CriticSanityConfig = {
  maxNullShiftRatio?: number; // default 0.05 (5%)
  maxQuarantineRatio?: number; // default 0.15 (15%)
  requiredColumns?: string[];
  enforceStrictTypes?: boolean;
};

export type CriticReport = {
  stage: "pre_check" | "post_check" | "unified";
  passed: boolean;
  totalRows: number;
  quarantinedRows: number;
  quarantinePercentage: number;
  nullPercentages: Record<string, number>;
  violations: string[];
  executedAt: string;
};

export class DualStageCritic {
  private config: Required<CriticSanityConfig>;

  constructor(config?: CriticSanityConfig) {
    this.config = {
      maxNullShiftRatio: config?.maxNullShiftRatio ?? 0.05,
      maxQuarantineRatio: config?.maxQuarantineRatio ?? 0.15,
      requiredColumns: config?.requiredColumns ?? [],
      enforceStrictTypes: config?.enforceStrictTypes ?? true,
    };
  }

  /** Stage 1: Pre-execution Sanity Critic */
  public stage1PreCheck(headers: string[]): { passed: boolean; violations: string[] } {
    const violations: string[] = [];
    const headerSet = new Set(headers.map((h) => h.toLowerCase().trim()));

    for (const req of this.config.requiredColumns) {
      if (!headerSet.has(req.toLowerCase().trim())) {
        violations.push(`Mandatory column missing from dataset schema: "${req}"`);
      }
    }

    if (headers.length === 0) {
      violations.push("Dataset schema has 0 columns.");
    }

    return { passed: violations.length === 0, violations };
  }

  /** Stage 2: Post-execution Quality Critic */
  public stage2PostCheck(params: {
    cleanRows: Record<string, unknown>[];
    quarantineRows: Record<string, unknown>[];
    headers: string[];
    baselineNullRatios: Record<string, number>;
  }): CriticReport {
    const { cleanRows, quarantineRows, headers, baselineNullRatios } = params;
    const totalRows = cleanRows.length + quarantineRows.length;
    const violations: string[] = [];

    if (totalRows === 0) {
      return {
        stage: "post_check",
        passed: false,
        totalRows: 0,
        quarantinedRows: 0,
        quarantinePercentage: 0,
        nullPercentages: {},
        violations: ["Total processed row count is 0."],
        executedAt: new Date().toISOString(),
      };
    }

    // 1. Quarantine Budget Assertion
    const quarantineRatio = quarantineRows.length / totalRows;
    if (quarantineRatio > this.config.maxQuarantineRatio) {
      violations.push(
        `Quarantine budget breached: ${(quarantineRatio * 100).toFixed(1)}% of records failed cleaning rules (tolerance limit: ${(this.config.maxQuarantineRatio * 100).toFixed(1)}%)`,
      );
    }

    // 2. Null Drift Assertion
    const currentNulls: Record<string, number> = {};
    for (const h of headers) {
      const nullCount = cleanRows.filter((r) => r[h] === null || r[h] === undefined).length;
      const currentRatio = cleanRows.length > 0 ? nullCount / cleanRows.length : 0;
      currentNulls[h] = currentRatio;

      const baseline = baselineNullRatios[h] ?? 0;
      const shift = currentRatio - baseline;
      if (shift > this.config.maxNullShiftRatio) {
        violations.push(
          `Excessive null-value inflation on column "${h}": baseline ${(baseline * 100).toFixed(1)}% -> current ${(currentRatio * 100).toFixed(1)}% (shift +${(shift * 100).toFixed(1)}% > tolerance ${(this.config.maxNullShiftRatio * 100).toFixed(1)}%)`,
        );
      }
    }

    return {
      stage: "post_check",
      passed: violations.length === 0,
      totalRows,
      quarantinedRows: quarantineRows.length,
      quarantinePercentage: Number((quarantineRatio * 100).toFixed(2)),
      nullPercentages: currentNulls,
      violations,
      executedAt: new Date().toISOString(),
    };
  }
}
