import * as XLSX from "xlsx";
import Papa from "papaparse";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CleanReport, QuarantineRow, Row } from "./clean";
import type { CriticReport } from "./critic";

export type ExportFormat = "xlsx" | "csv" | "tsv" | "json" | "jsonl" | "markdown" | "html" | "pdf";

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportToCsv(rows: Row[], filename = "cleaned-data.csv"): void {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportToTsv(rows: Row[], filename = "cleaned-data.tsv"): void {
  const tsv = Papa.unparse(rows, { delimiter: "\t" });
  const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportToJson(rows: Row[], filename = "cleaned-data.json", pretty = true): void {
  const jsonStr = pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportToJsonl(rows: Row[], filename = "cleaned-data.jsonl"): void {
  const jsonlStr = rows.map((r) => JSON.stringify(r)).join("\n");
  const blob = new Blob([jsonlStr], { type: "application/x-ndjson;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportToExcelMultiSheet(params: {
  cleanRows: Row[];
  quarantineRows: QuarantineRow[];
  report: CleanReport | null;
  critic: CriticReport | null;
  rawRows?: Row[];
  filename?: string;
}): void {
  const { cleanRows, quarantineRows, report, critic, rawRows = [], filename = "cleaned-dataset.xlsx" } = params;
  const wb = XLSX.utils.book_new();

  // 1. Cleaned Data Sheet
  const cleanWs = XLSX.utils.json_to_sheet(cleanRows.length ? cleanRows : [{}]);
  XLSX.utils.book_append_sheet(wb, cleanWs, "Cleaned Data");

  // 2. Quarantine Log Sheet (Zero Data Loss Audit)
  if (quarantineRows.length > 0) {
    const quarWs = XLSX.utils.json_to_sheet(quarantineRows as unknown as Row[]);
    XLSX.utils.book_append_sheet(wb, quarWs, "Quarantine Log");
  }

  // 3. Summary Sheet
  if (report) {
    const summaryRows: Row[] = [
      { Metric: "Rows before cleaning", Value: report.rowsBefore },
      { Metric: "Rows after cleaning", Value: report.rowsAfter },
      { Metric: "Columns before", Value: report.columnsBefore },
      { Metric: "Columns after", Value: report.columnsAfter },
      { Metric: "Duplicates removed", Value: report.duplicatesRemoved },
      { Metric: "Empty rows removed", Value: report.emptyRowsRemoved },
      { Metric: "Empty columns removed", Value: report.emptyColumnsRemoved },
      { Metric: "Missing cells filled", Value: report.cellsFilled },
      { Metric: "Strings trimmed", Value: report.cellsTrimmed },
      { Metric: "Values reformatted / coerced", Value: report.cellsCoerced },
      { Metric: "Spellings unified", Value: report.valuesUnified },
      { Metric: "Quarantined records", Value: quarantineRows.length },
      { Metric: "Extreme outliers flagged (MAD)", Value: report.outliers },
      { Metric: "Critic validation status", Value: critic?.passed ? "PASSED" : "FLAGGED" },
    ];
    const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary Audit");

    // 4. Column Profiling Sheet
    const colRows: Row[] = report.columns.map((c) => ({
      Column: c.name,
      Type: c.type,
      "Missing Before": c.missingBefore,
      "Missing After": c.missingAfter,
      Filled: c.filled,
      Tidied: c.trimmed,
      Reformatted: c.coerced,
      "Spellings Unified": c.unified,
      "Invalidated / Quarantined": c.invalidated,
      "Extreme Outliers": c.outliers,
      "Unique Values": c.unique,
      Min: c.min ?? "",
      Max: c.max ?? "",
      Mean: c.mean !== undefined ? Number(c.mean.toFixed(3)) : "",
    }));
    const colWs = XLSX.utils.json_to_sheet(colRows);
    XLSX.utils.book_append_sheet(wb, colWs, "Column Profiles");
  }

  // 5. Original Data Sheet
  if (rawRows.length > 0) {
    const rawWs = XLSX.utils.json_to_sheet(rawRows);
    XLSX.utils.book_append_sheet(wb, rawWs, "Original Data");
  }

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename);
}

export function exportToMarkdownReport(params: {
  filename: string;
  cleanRows: Row[];
  quarantineRows: QuarantineRow[];
  report: CleanReport | null;
  critic: CriticReport | null;
}): void {
  const { filename, cleanRows, quarantineRows, report, critic } = params;

  let md = `# Data Reliability & Cleaning Audit Report\n\n`;
  md += `**Dataset Source**: \`${filename}\`  \n`;
  md += `**Audit Timestamp**: \`${new Date().toISOString()}\`  \n`;
  md += `**Critic Status**: **${critic?.passed ? "PASSED (Certified Zero Loss)" : "FLAGGED WITH VIOLATIONS"}**  \n\n`;

  if (critic && !critic.passed) {
    md += `### ⚠️ Critic Violations Detected\n`;
    for (const v of critic.violations) {
      md += `- ${v}\n`;
    }
    md += `\n`;
  }

  md += `## 📊 Executive Summary Metrics\n\n`;
  md += `| Metric | Count / Ratio |\n`;
  md += `|---|---|\n`;
  md += `| Rows Before Cleaning | ${report?.rowsBefore ?? cleanRows.length + quarantineRows.length} |\n`;
  md += `| Clean Rows Retained | ${cleanRows.length} |\n`;
  md += `| Quarantined Records | ${quarantineRows.length} (${report ? ((quarantineRows.length / (report.rowsBefore || 1)) * 100).toFixed(1) : 0}%) |\n`;
  md += `| Duplicate Rows Pruned | ${report?.duplicatesRemoved ?? 0} |\n`;
  md += `| Missing Values Imputed | ${report?.cellsFilled ?? 0} |\n`;
  md += `| Outliers Isolated (MAD) | ${report?.outliers ?? 0} |\n\n`;

  if (quarantineRows.length > 0) {
    md += `## 🛡️ Quarantine Log (Sample of Isolated Records)\n\n`;
    md += `| Violated Column | Reason | Original Value |\n`;
    md += `|---|---|---|\n`;
    for (const q of quarantineRows.slice(0, 10)) {
      md += `| \`${q._violatedColumn}\` | ${q._quarantineReason} | \`${String(q._originalValue)}\` |\n`;
    }
    if (quarantineRows.length > 10) {
      md += `\n*... and ${quarantineRows.length - 10} more quarantined records.*\n`;
    }
    md += `\n`;
  }

  if (report?.columns) {
    md += `## 📐 Column Invariance & Profiling\n\n`;
    md += `| Column | Inferred Type | Missing Before | Missing After | Outliers (MAD) | Unique |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const c of report.columns) {
      md += `| **${c.name}** | \`${c.type}\` | ${c.missingBefore} | ${c.missingAfter} | ${c.outliers} | ${c.unique} |\n`;
    }
  }

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
  triggerDownload(blob, `${filename.replace(/\.[^.]+$/, "") || "dataset"}-audit-report.md`);
}

export function exportToHtml(rows: Row[], filename = "cleaned-data.html", title = "Cleaned Dataset View"): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 2rem; background: #fafafa; color: #222; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .table-container { max-height: 80vh; overflow: auto; border: 1px solid #ddd; border-radius: 8px; background: white; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left; }
    th { background: #f4f4f5; position: sticky; top: 0; padding: 10px 12px; font-weight: 600; border-bottom: 2px solid #e4e4e7; }
    td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; white-space: nowrap; }
    tr:hover { background: #f9f9fb; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated by Tidy Studio • ${rows.length.toLocaleString()} records</p>
  <div class="table-container">
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr>${headers.map((h) => `<td>${r[h] === null || r[h] === undefined ? "—" : String(r[h])}</td>`).join("")}</tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportToPdf(params: {
  rows: Row[];
  filename?: string;
  title?: string;
  subtitle?: string;
  report?: CleanReport | null;
  critic?: CriticReport | null;
}): void {
  const {
    rows,
    filename = "cleaned-data.pdf",
    title = "Tidy Studio — Data Quality & Certification Report",
    subtitle,
    report,
    critic,
  } = params;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  // Top Dark Slate Branding Bar
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 842, 54, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("TIDY STUDIO", 40, 33);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text("Zero-Loss Data Architecture • Quality & Audit Certification", 155, 33);

  const timestamp = new Date().toLocaleString();
  doc.text(`Generated: ${timestamp}`, 660, 33);

  // Document Heading
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, 40, 80);

  let currentY = 96;
  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, 40, currentY);
    currentY += 16;
  }

  // Summary Metrics Banner
  if (report) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, currentY, 762, 34, 4, 4, "FD");

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Clean Records: ${report.rowsAfter.toLocaleString()}    |    Duplicates Removed: ${report.duplicatesRemoved}    |    MAD Outliers: ${report.outliers}    |    Critic Gate: ${critic?.passed ? "PASSED (Certified)" : "FLAGGED"}`,
      52,
      currentY + 21,
    );
    currentY += 46;
  }

  if (rows.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text("No records available for this export.", 40, currentY + 20);
    doc.save(filename);
    return;
  }

  const columns = Object.keys(rows[0] ?? {});
  const tableData = rows.slice(0, 500).map((r) =>
    columns.map((col) => {
      const val = r[col];
      return val === null || val === undefined ? "" : String(val);
    }),
  );

  autoTable(doc, {
    startY: currentY,
    head: [columns],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: [99, 102, 241], // Indigo
      textColor: [255, 255, 255],
      fontSize: 8.5,
      fontStyle: "bold",
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [30, 41, 59],
      cellPadding: 4,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const pageStr = `Page ${doc.internal.pages.length - 1}`;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(pageStr, 770, 575);
    },
  });

  doc.save(filename);
}

