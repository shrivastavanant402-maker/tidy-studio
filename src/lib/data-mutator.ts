import type { Row } from "./clean";

export type DataMutationAction =
  | {
      type: "filter_rows";
      column: string;
      operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "not_contains" | "is_not_null";
      value?: unknown;
      description: string;
    }
  | {
      type: "replace_values";
      column: string;
      targetValue: unknown;
      replacementValue: unknown;
      description: string;
    }
  | {
      type: "transform_text";
      column: string;
      operation: "uppercase" | "lowercase" | "trim" | "titlecase";
      description: string;
    }
  | {
      type: "math_expression";
      column: string;
      operation: "multiply" | "add" | "subtract" | "divide" | "round";
      operand: number;
      description: string;
    }
  | {
      type: "drop_column";
      column: string;
      description: string;
    }
  | {
      type: "rename_column";
      oldName: string;
      newName: string;
      description: string;
    }
  | {
      type: "impute_missing";
      column: string;
      strategy: "median" | "mean" | "mode" | "constant";
      constantValue?: unknown;
      description: string;
    };

export type MutationResult = {
  rows: Row[];
  affectedCount: number;
  description: string;
};

export function applyDataMutation(rows: Row[], action: DataMutationAction): MutationResult {
  let affected = 0;
  let newRows = [...rows.map((r) => ({ ...r }))];

  switch (action.type) {
    case "filter_rows": {
      const { column, operator, value } = action;
      const initialCount = newRows.length;

      newRows = newRows.filter((row) => {
        const cell = row[column];
        if (operator === "is_not_null") {
          return cell !== null && cell !== undefined && String(cell).trim() !== "";
        }
        if (operator === "greater_than") {
          const num = Number(cell);
          const valNum = Number(value);
          return !isNaN(num) && !isNaN(valNum) ? num > valNum : true;
        }
        if (operator === "less_than") {
          const num = Number(cell);
          const valNum = Number(value);
          return !isNaN(num) && !isNaN(valNum) ? num < valNum : true;
        }
        if (operator === "equals") {
          return String(cell).toLowerCase() === String(value).toLowerCase();
        }
        if (operator === "not_equals") {
          return String(cell).toLowerCase() !== String(value).toLowerCase();
        }
        if (operator === "contains") {
          return String(cell ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
        }
        if (operator === "not_contains") {
          return !String(cell ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
        }
        return true;
      });

      affected = initialCount - newRows.length;
      break;
    }

    case "replace_values": {
      const { column, targetValue, replacementValue } = action;
      for (const row of newRows) {
        if (String(row[column]).toLowerCase() === String(targetValue).toLowerCase()) {
          row[column] = replacementValue;
          affected++;
        }
      }
      break;
    }

    case "transform_text": {
      const { column, operation } = action;
      for (const row of newRows) {
        const cell = row[column];
        if (typeof cell === "string") {
          let updated = cell;
          if (operation === "uppercase") updated = cell.toUpperCase();
          else if (operation === "lowercase") updated = cell.toLowerCase();
          else if (operation === "trim") updated = cell.trim().replace(/\s+/g, " ");
          else if (operation === "titlecase") {
            updated = cell.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          }

          if (updated !== cell) {
            row[column] = updated;
            affected++;
          }
        }
      }
      break;
    }

    case "math_expression": {
      const { column, operation, operand } = action;
      for (const row of newRows) {
        const cell = row[column];
        const num = Number(cell);
        if (!isNaN(num) && cell !== null && cell !== undefined) {
          let computed = num;
          if (operation === "multiply") computed = num * operand;
          else if (operation === "add") computed = num + operand;
          else if (operation === "subtract") computed = num - operand;
          else if (operation === "divide" && operand !== 0) computed = num / operand;
          else if (operation === "round") computed = Number(num.toFixed(operand || 2));

          row[column] = computed;
          affected++;
        }
      }
      break;
    }

    case "drop_column": {
      const { column } = action;
      for (const row of newRows) {
        if (column in row) {
          delete row[column];
          affected++;
        }
      }
      break;
    }

    case "rename_column": {
      const { oldName, newName } = action;
      for (const row of newRows) {
        if (oldName in row) {
          row[newName] = row[oldName];
          delete row[oldName];
          affected++;
        }
      }
      break;
    }

    case "impute_missing": {
      const { column, strategy, constantValue } = action;
      let fillVal: unknown = constantValue ?? "N/A";

      if (strategy === "mean" || strategy === "median") {
        const nums = newRows
          .map((r) => Number(r[column]))
          .filter((n) => !isNaN(n) && n !== null && n !== undefined);
        if (nums.length > 0) {
          if (strategy === "mean") {
            fillVal = Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
          } else {
            const sorted = [...nums].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            fillVal = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
          }
        }
      }

      for (const row of newRows) {
        if (row[column] === null || row[column] === undefined || String(row[column]).trim() === "") {
          row[column] = fillVal;
          affected++;
        }
      }
      break;
    }
  }

  return {
    rows: newRows,
    affectedCount: affected,
    description: action.description,
  };
}
