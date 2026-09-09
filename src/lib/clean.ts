import { DualStageCritic, type CriticReport, type CriticSanityConfig } from "./critic";
import { calculateModifiedZScoreOutliers } from "./anomaly";

export type Row = Record<string, unknown>;

export type ColumnType = "number" | "date" | "text" | "boolean" | "email" | "empty";

export type ColumnReport = {
  name: string;
  type: ColumnType;
  missingBefore: number;
  missingAfter: number;
  filled: number;
  trimmed: number;
  coerced: number;
  /** values that could not be a valid number/date/email and were blanked or quarantined */
  invalidated: number;
  /** spelling/casing variants merged into one label */
  unified: number;
  /** extreme numeric values identified mathematically via MAD / Modified Z-Score */
  outliers: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
};

export type CleanReport = {
  rowsBefore: number;
  rowsAfter: number;
  columnsBefore: number;
  columnsAfter: number;
  duplicatesRemoved: number;
  emptyRowsRemoved: number;
  emptyColumnsRemoved: number;
  cellsFilled: number;
  cellsTrimmed: number;
  cellsCoerced: number;
  cellsInvalidated: number;
  valuesUnified: number;
  outliers: number;
  quarantinedRowsCount: number;
  columns: ColumnReport[];
};

export type QuarantineRow = Row & {
  _quarantineReason: string;
  _violatedColumn: string;
  _originalValue: unknown;
  _quarantinedAt: string;
};

export type CleanResult = {
  rows: Row[];
  quarantineRows: QuarantineRow[];
  report: CleanReport;
  critic: CriticReport;
};

const MISSING = new Set(["", "na", "n/a", "null", "none", "nan", "-", "--", "?", "undefined"]);

const isMissing = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && MISSING.has(v.trim().toLowerCase())) ||
  (typeof v === "number" && Number.isNaN(v));

const normalizeHeader = (h: string, i: number) => {
  const clean = String(h ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\w %/().-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || `column_${i + 1}`;
};

const parseNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[\s,_]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  let pct = false;
  if (s.endsWith("%")) {
    pct = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/^[$€£₹]/, "");
  if (s === "" || !/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (pct) n = n / 100;
  return neg ? -n : n;
};

const parseBool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["true", "yes", "y"].includes(s)) return true;
  if (["false", "no", "n"].includes(s)) return false;
  return null;
};

/** Builds a date only when the calendar day really exists (no 2024-02-30 rollover). */
const makeDate = (year: number, month: number, day: number): Date | null => {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return null;
  return d;
};

const parseDate = (v: unknown): Date | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 6) return null;

  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    const y = Number(parts[3]!.length === 2 ? `20${parts[3]}` : parts[3]);
    return a > 12 ? makeDate(y, b, a) : makeDate(y, a, b);
  }

  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const nums = s.match(/\d+/g);
  if (nums && nums.length >= 3) {
    const dayLike = nums.map(Number).find((n) => n > 12 && n <= 31);
    if (dayLike !== undefined && d.getUTCDate() !== dayLike && d.getDate() !== dayLike) return null;
  }
  return d;
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

const median = (nums: number[]) => {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const mode = (vals: string[]) => {
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let n = -1;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
};

const looksEmailish = (v: unknown) =>
  typeof v === "string" && /@|\[at\]|\(at\)/i.test(v) && !/\s{2,}/.test(v);

const normalizeEmail = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\[at\]|\(at\)/g, "@").replace(/\s+/g, "");
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : null;
};

const isIdHeader = (h: string) =>
  /(^|[\s_])(id|ids|uuid|code|sku|zip|zipcode|postcode|postal ?code|phone|mobile|account|invoice|order ?no|number)([\s_)]|$)/i.test(
    h,
  );

const canonKey = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

export type CleanOptions = {
  dropDuplicates: boolean;
  fillMissing: boolean;
  trimText: boolean;
  standardizeCase: boolean;
  /** When true, rows with unparseable values are safely quarantined rather than blanked */
  quarantineInvalid?: boolean;
  /** Dual-stage Critic threshold configuration */
  criticConfig?: CriticSanityConfig;
  /** user-defined column rules; when present they win over guessing */
  dictionary?: import("./dictionary").DictColumn[];
};

export const defaultOptions: CleanOptions = {
  dropDuplicates: true,
  fillMissing: true,
  trimText: true,
  standardizeCase: true,
  quarantineInvalid: true,
};

export function cleanData(input: Row[], opts: CleanOptions = defaultOptions): CleanResult {
  const rowsBefore = input.length;
  const rawHeaders = Array.from(
    input.reduce<Set<string>>((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set()),
  );
  const columnsBefore = rawHeaders.length;

  // Stage 1 Critic check
  const critic = new DualStageCritic(opts.criticConfig);
  critic.stage1PreCheck(rawHeaders);

  // Data dictionary rules, matched loosely on the column name
  const dict = new Map<string, NonNullable<CleanOptions["dictionary"]>[number]>();
  for (const e of opts.dictionary ?? []) {
    if (e.column?.trim()) dict.set(canonKey(e.column), e);
  }
  const ruleFor = (name: string) => dict.get(canonKey(name));

  // Normalize + dedupe headers (dictionary renames win)
  const headerMap = new Map<string, string>();
  const used = new Set<string>();
  rawHeaders.forEach((h, i) => {
    const base = ruleFor(h)?.rename?.trim() || normalizeHeader(h, i);
    let name = base;
    let k = 2;
    while (used.has(name)) name = `${base}_${k++}`;
    used.add(name);
    headerMap.set(h, name);
  });
  for (const [raw, name] of headerMap) {
    const r = ruleFor(raw);
    if (r) dict.set(canonKey(name), r);
  }

  let rows: Row[] = input.map((r) => {
    const out: Row = {};
    for (const [raw, name] of headerMap) out[name] = r[raw];
    return out;
  });

  let headers = Array.from(headerMap.values());

  // Record baseline null ratios for Stage 2 Critic
  const baselineNullRatios: Record<string, number> = {};
  for (const h of headers) {
    const nulls = rows.filter((r) => isMissing(r[h])).length;
    baselineNullRatios[h] = rows.length > 0 ? nulls / rows.length : 0;
  }

  // Drop empty columns
  const emptyCols = headers.filter((h) => rows.every((r) => isMissing(r[h])));
  if (emptyCols.length) {
    headers = headers.filter((h) => !emptyCols.includes(h));
    rows = rows.map((r) => {
      const o: Row = {};
      headers.forEach((h) => (o[h] = r[h]));
      return o;
    });
  }

  // Drop empty rows
  const beforeEmptyRows = rows.length;
  rows = rows.filter((r) => headers.some((h) => !isMissing(r[h])));
  const emptyRowsRemoved = beforeEmptyRows - rows.length;

  let cellsTrimmed = 0;
  let cellsCoerced = 0;
  let cellsFilled = 0;
  let cellsInvalidated = 0;
  let valuesUnified = 0;

  const colReports: ColumnReport[] = [];
  const quarantineRows: QuarantineRow[] = [];
  const quarantinedRowIndices = new Set<number>();

  for (const h of headers) {
    let trimmed = 0;
    let coerced = 0;
    let invalidated = 0;
    let unified = 0;

    // trim strings
    if (opts.trimText) {
      for (const r of rows) {
        const v = r[h];
        if (typeof v === "string") {
          const t = v.replace(/\s+/g, " ").trim();
          if (t !== v) {
            trimmed++;
            r[h] = t;
          }
        }
      }
    }

    const present = rows.map((r) => r[h]).filter((v) => !isMissing(v));
    const missingBefore = rows.length - present.length;

    const numCount = present.filter((v) => parseNumber(v) !== null).length;
    const boolCount = present.filter((v) => parseBool(v) !== null).length;
    const dateCount = present.filter((v) => parseDate(v) !== null).length;
    const emailCount = present.filter((v) => looksEmailish(v)).length;

    const rule = ruleFor(h);
    const idLike = isIdHeader(h);
    const dateHeader = /(date|day|time|month|year|dob)/i.test(h);

    let type: ColumnType = "text";
    if (present.length === 0) type = "empty";
    else if (emailCount / present.length >= 0.6) type = "email";
    else if (idLike) type = "text";
    else if (numCount / present.length >= 0.8) type = "number";
    else if (boolCount / present.length >= 0.8) type = "boolean";
    else if (dateCount / present.length >= (dateHeader ? 0.4 : 0.8)) type = "date";
    if (rule && rule.type && rule.type !== "auto") type = rule.type;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const v = r[h];
      if (isMissing(v)) {
        r[h] = null;
        continue;
      }

      if (type === "number") {
        const n = parseNumber(v);
        if (n !== null) {
          if (typeof v !== "number") coerced++;
          r[h] = n;
        } else {
          invalidated++;
          if (opts.quarantineInvalid && !quarantinedRowIndices.has(i)) {
            quarantinedRowIndices.add(i);
            quarantineRows.push({
              ...r,
              _violatedColumn: h,
              _originalValue: v,
              _quarantineReason: `Unparseable number format: "${String(v)}"`,
              _quarantinedAt: new Date().toISOString(),
            });
          }
          r[h] = null;
        }
      } else if (type === "boolean") {
        const b = parseBool(v);
        if (b !== null) {
          if (typeof v !== "boolean") coerced++;
          r[h] = b;
        } else {
          invalidated++;
          r[h] = null;
        }
      } else if (type === "date") {
        const d = parseDate(v);
        if (d) {
          const s = fmtDate(d);
          if (s !== v) coerced++;
          r[h] = s;
        } else {
          invalidated++;
          if (opts.quarantineInvalid && !quarantinedRowIndices.has(i)) {
            quarantinedRowIndices.add(i);
            quarantineRows.push({
              ...r,
              _violatedColumn: h,
              _originalValue: v,
              _quarantineReason: `Unparseable date representation: "${String(v)}"`,
              _quarantinedAt: new Date().toISOString(),
            });
          }
          r[h] = null;
        }
      } else if (type === "email") {
        const e = normalizeEmail(v);
        if (e) {
          if (e !== v) coerced++;
          r[h] = e;
        } else {
          invalidated++;
          if (opts.quarantineInvalid && !quarantinedRowIndices.has(i)) {
            quarantinedRowIndices.add(i);
            quarantineRows.push({
              ...r,
              _violatedColumn: h,
              _originalValue: v,
              _quarantineReason: `Malformed email address: "${String(v)}"`,
              _quarantinedAt: new Date().toISOString(),
            });
          }
          r[h] = null;
        }
      } else if (opts.standardizeCase && typeof v === "string") {
        const isAllCaps = v === v.toUpperCase() && /[a-z]/i.test(v) && v.length > 3;
        if (isAllCaps) {
          r[h] = v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          coerced++;
        }
      }
    }

    // Acceptable values from data dictionary
    const allowed = (rule?.allowed ?? []).map((a) => a.trim()).filter(Boolean);
    if (allowed.length) {
      const canon = new Map(allowed.map((a) => [canonKey(a), a]));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const v = r[h];
        if (v === null || v === undefined) continue;
        const s = String(v);
        const target = canon.get(canonKey(s));
        if (target) {
          if (target !== v) {
            r[h] = target;
            unified++;
          }
        } else {
          invalidated++;
          if (opts.quarantineInvalid && !quarantinedRowIndices.has(i)) {
            quarantinedRowIndices.add(i);
            quarantineRows.push({
              ...r,
              _violatedColumn: h,
              _originalValue: v,
              _quarantineReason: `Value "${s}" not permitted by data dictionary rule`,
              _quarantinedAt: new Date().toISOString(),
            });
          }
          r[h] = null;
        }
      }
    }

    // Unify category spellings (low-cardinality text)
    const textVals = rows.map((r) => r[h]).filter((v): v is string => typeof v === "string");
    const lowerUnique = new Set(textVals.map((v) => v.toLowerCase())).size;
    const isCategory =
      (type === "text" || type === "email") &&
      textVals.length > 0 &&
      lowerUnique <= Math.max(3, textVals.length * 0.8) &&
      lowerUnique <= 40;

    if (opts.standardizeCase && type === "text" && isCategory && !allowed.length) {
      const groups = new Map<string, Map<string, number>>();
      for (const v of textVals) {
        const key = canonKey(v);
        const g = groups.get(key) ?? new Map<string, number>();
        g.set(v, (g.get(v) ?? 0) + 1);
        groups.set(key, g);
      }
      const canonical = new Map<string, string>();
      for (const [key, g] of groups) {
        let best = "";
        let n = -1;
        for (const [val, c] of g) if (c > n || (c === n && val < best)) [best, n] = [val, c];
        canonical.set(key, best);
      }
      for (const r of rows) {
        const v = r[h];
        if (typeof v !== "string") continue;
        const target = canonical.get(canonKey(v));
        if (target && target !== v) {
          r[h] = target;
          unified++;
        }
      }
    }

    // Free text check
    const freeText =
      (type === "text" || type === "email") &&
      textVals.length > 0 &&
      new Set(textVals).size / textVals.length > 0.6;

    // Impute missing values
    let filled = 0;
    if (opts.fillMissing && !idLike && !freeText) {
      if (type === "number") {
        const nums = rows.map((r) => r[h]).filter((v): v is number => typeof v === "number");
        if (nums.length) {
          const allInts = nums.every((n) => Number.isInteger(n));
          const raw = median(nums) ?? 0;
          const med = allInts ? Math.round(raw) : Number(raw.toFixed(6));
          for (const r of rows) {
            if (r[h] === null) {
              r[h] = med;
              filled++;
            }
          }
        }
      } else if (type === "text" || type === "boolean") {
        const vals = rows.map((r) => r[h]).filter((v) => v !== null).map(String);
        if (vals.length) {
          const m = mode(vals);
          for (const r of rows) {
            if (r[h] === null) {
              r[h] = type === "boolean" ? m === "true" : m;
              filled++;
            }
          }
        }
      }
    }

    const finalVals = rows.map((r) => r[h]);
    const missingAfter = finalVals.filter((v) => v === null).length;
    const nums = finalVals.filter((v): v is number => typeof v === "number");

    // Mathematically robust outlier detection using Median Absolute Deviation (MAD)
    let columnOutliers = 0;
    if (nums.length >= 4 && !idLike) {
      const outlierResults = calculateModifiedZScoreOutliers(nums, 3.5);
      columnOutliers = outlierResults.filter((o) => o.isOutlier).length;
    }

    const rep: ColumnReport = {
      name: h,
      type,
      missingBefore,
      missingAfter,
      filled,
      trimmed,
      coerced,
      invalidated,
      unified,
      outliers: columnOutliers,
      unique: new Set(finalVals.map((v) => JSON.stringify(v))).size,
    };
    if (nums.length && !idLike) {
      rep.min = Math.min(...nums);
      rep.max = Math.max(...nums);
      rep.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    colReports.push(rep);

    cellsTrimmed += trimmed;
    cellsCoerced += coerced + unified;
    cellsFilled += filled;
    cellsInvalidated += invalidated;
    valuesUnified += unified;
  }

  // Deduplication
  let duplicatesRemoved = 0;
  if (opts.dropDuplicates) {
    const seen = new Set<string>();
    const kept: Row[] = [];
    for (const r of rows) {
      const key = JSON.stringify(headers.map((h) => r[h]));
      if (seen.has(key)) duplicatesRemoved++;
      else {
        seen.add(key);
        kept.push(r);
      }
    }
    rows = kept;
  }

  // Stage 2 Critic validation
  const criticReport = critic.stage2PostCheck({
    cleanRows: rows,
    quarantineRows,
    headers,
    baselineNullRatios,
  });

  return {
    rows,
    quarantineRows,
    report: {
      rowsBefore,
      rowsAfter: rows.length,
      columnsBefore,
      columnsAfter: headers.length,
      duplicatesRemoved,
      emptyRowsRemoved,
      emptyColumnsRemoved: emptyCols.length,
      cellsFilled,
      cellsTrimmed,
      cellsCoerced,
      cellsInvalidated,
      valuesUnified,
      outliers: colReports.reduce((a, c) => a + c.outliers, 0),
      quarantinedRowsCount: quarantineRows.length,
      columns: colReports,
    },
    critic: criticReport,
  };
}
