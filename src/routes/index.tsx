import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileCode,
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Upload,
} from "lucide-react";
import { cleanData, defaultOptions, type CleanReport, type QuarantineRow, type Row } from "@/lib/clean";
import type { CriticReport } from "@/lib/critic";
import { parseFileAuto, type DetectedFormat } from "@/lib/parse-file";
import {
  exportToCsv,
  exportToExcelMultiSheet,
  exportToHtml,
  exportToJson,
  exportToJsonl,
  exportToMarkdownReport,
  exportToPdf,
  exportToTsv,
  type ExportFormat,
} from "@/lib/export-data";
import { extractTableFromImage } from "@/lib/extract.functions";
import { SAMPLE_DATASETS } from "@/lib/sample-datasets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tidy Studio — Zero-Loss Data Cleaning & Multi-Format Engine" },
      {
        name: "description",
        content:
          "Upload CSV, Excel, JSON, JSONL, PDF or table images. Clean, profile, isolate anomalies with MAD Z-scores, verify with Critic gates, and export to 7 formats.",
      },
      { property: "og:title", content: "Tidy Studio — Clean your data in seconds" },
      {
        property: "og:description",
        content:
          "Zero-loss streaming data cleaning with autonomous Critic verification and multi-format export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Index() {
  const extract = useServerFn(extractTableFromImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat>("unknown");
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [quarantineRows, setQuarantineRows] = useState<QuarantineRow[]>([]);
  const [critic, setCritic] = useState<CriticReport | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setReport(null);
      setRows([]);
      setQuarantineRows([]);
      setCritic(null);
      setFileName(file.name);
      setStatus(`Ingesting ${file.name}…`);

      try {
        const parsed = await parseFileAuto(file, async (data) => {
          const res = (await extract({ data })) as { rows: Record<string, string>[]; error?: string };
          return { rows: res.rows as Row[], error: res.error };
        });

        setDetectedFormat(parsed.format);
        setStatus("Applying vectorized cleaning & Critic gate…");
        const result = cleanData(parsed.rows, defaultOptions);

        setRawRows(parsed.rows);
        setRows(result.rows);
        setQuarantineRows(result.quarantineRows);
        setCritic(result.critic);
        setReport(result.report);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
        setStatus("");
      }
    },
    [extract],
  );

  const loadSample = useCallback((datasetId: string) => {
    const sample = SAMPLE_DATASETS.find((s) => s.id === datasetId);
    if (!sample) return;

    setBusy(true);
    setError(null);
    setFileName(sample.filename);
    setDetectedFormat(sample.filename.endsWith(".json") ? "json" : sample.filename.endsWith(".xlsx") ? "excel" : "csv");

    const result = cleanData(sample.rows, defaultOptions);
    setRawRows(sample.rows);
    setRows(result.rows);
    setQuarantineRows(result.quarantineRows);
    setCritic(result.critic);
    setReport(result.report);
    setBusy(false);
  }, []);

  const handleExport = (format: ExportFormat, target: "clean" | "quarantine" = "clean") => {
    setShowExportMenu(false);
    const baseName = fileName.replace(/\.[^.]+$/, "") || "cleaned_data";
    const targetRows = target === "quarantine" ? (quarantineRows as unknown as Row[]) : rows;
    const targetSuffix = target === "quarantine" ? "-quarantine-log" : "-cleaned";

    switch (format) {
      case "xlsx":
        exportToExcelMultiSheet({
          cleanRows: rows,
          quarantineRows,
          report,
          critic,
          rawRows,
          filename: `${baseName}${targetSuffix}.xlsx`,
        });
        break;
      case "csv":
        exportToCsv(targetRows, `${baseName}${targetSuffix}.csv`);
        break;
      case "tsv":
        exportToTsv(targetRows, `${baseName}${targetSuffix}.tsv`);
        break;
      case "json":
        exportToJson(targetRows, `${baseName}${targetSuffix}.json`, true);
        break;
      case "jsonl":
        exportToJsonl(targetRows, `${baseName}${targetSuffix}.jsonl`);
        break;
      case "markdown":
        exportToMarkdownReport({
          filename: fileName,
          cleanRows: rows,
          quarantineRows,
          report,
          critic,
        });
        break;
      case "html":
        exportToHtml(targetRows, `${baseName}${targetSuffix}.html`, fileName);
        break;
      case "pdf":
        exportToPdf({
          rows: targetRows,
          filename: `${baseName}${targetSuffix}.pdf`,
          title: `Tidy Studio — ${baseName} (${target === "quarantine" ? "Quarantine Log" : "Cleaned Dataset"})`,
          subtitle: `Dataset: ${fileName} • ${targetRows.length} records`,
          report,
          critic,
        });
        break;
    }
  };

  const headers = report?.columns.map((c) => c.name) ?? (rows.length ? Object.keys(rows[0] ?? {}) : []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1400px] px-6 py-10">
      {/* Hero Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-start gap-4">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 p-2.5 shadow-lg shadow-indigo-500/25 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 drop-shadow-sm">
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="rgba(255,255,255,0.25)" />
              <circle cx="12" cy="12" r="2.5" fill="white" stroke="none" />
            </svg>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-background"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary border border-primary/20">
                Autonomous Data Agent
              </span>
              {detectedFormat !== "unknown" ? (
                <span className="rounded border border-border bg-secondary px-2 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                  {detectedFormat}
                </span>
              ) : null}
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Tidy Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Zero-loss streaming data cleaning with autonomous Critic verification and multi-format export.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-105 hover:opacity-95"
          >
            <Sparkles className="h-4 w-4" />
            <span>Launch Studio Workspace →</span>
          </Link>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx,.xls,.xlsm,.xlsb,.pdf,application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? status || "Processing…" : fileName ? "Replace file" : "Upload file"}
          </button>

          {/* Export Dropdown */}
          {report ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export ({rows.length})</span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showExportMenu ? (
                <div
                  className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-border bg-popover p-1.5 shadow-xl"
                  onMouseLeave={() => setShowExportMenu(false)}
                >
                  <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Export Formats
                  </div>
                  <button
                    onClick={() => handleExport("xlsx")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    <span>Excel (.xlsx) Multi-Sheet</span>
                  </button>
                  <button
                    onClick={() => handleExport("csv")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileText className="h-4 w-4 text-blue-500" />
                    <span>CSV (.csv)</span>
                  </button>
                  <button
                    onClick={() => handleExport("tsv")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileText className="h-4 w-4 text-amber-500" />
                    <span>TSV (.tsv)</span>
                  </button>
                  <button
                    onClick={() => handleExport("json")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileCode className="h-4 w-4 text-purple-500" />
                    <span>JSON (.json)</span>
                  </button>
                  <button
                    onClick={() => handleExport("jsonl")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileCode className="h-4 w-4 text-indigo-500" />
                    <span>JSONL (.jsonl)</span>
                  </button>
                  <button
                    onClick={() => handleExport("markdown")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileText className="h-4 w-4 text-rose-500" />
                    <span>Audit Report (.md)</span>
                  </button>
                  <button
                    onClick={() => handleExport("html")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <TableProperties className="h-4 w-4 text-teal-500" />
                    <span>HTML View (.html)</span>
                  </button>
                  <button
                    onClick={() => handleExport("pdf")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left"
                  >
                    <FileText className="h-4 w-4 text-red-500" />
                    <span>PDF Quality Report (.pdf)</span>
                  </button>

                  {quarantineRows.length > 0 ? (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => handleExport("csv", "quarantine")}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left text-amber-600 dark:text-amber-400"
                      >
                        <FileDown className="h-4 w-4" />
                        <span>Export Quarantine CSV ({quarantineRows.length})</span>
                      </button>
                      <button
                        onClick={() => handleExport("pdf", "quarantine")}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary text-left text-amber-600 dark:text-amber-400"
                      >
                        <FileText className="h-4 w-4" />
                        <span>Export Quarantine PDF ({quarantineRows.length})</span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/* Error Message */}
      {error ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Critic Verification Banner */}
      {critic && report ? (
        <div
          className={`mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
            critic.passed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {critic.passed ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            )}
            <span className="font-semibold">
              {critic.passed
                ? "Critic Dual-Stage Verification: PASSED — Schema invariance, null-shift tolerances, and zero data loss verified."
                : `Critic Warnings: ${critic.violations.join(" | ")}`}
            </span>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground font-mono">
            <span>Quarantined: {quarantineRows.length} ({critic.quarantinePercentage}%)</span>
          </div>
        </div>
      ) : null}

      {/* Upload Zone & Sample Datasets */}
      {!report ? (
        <div className="mt-8 space-y-6">
          <section
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-border bg-card/60 px-6 py-20 text-center transition-all hover:border-primary/50 hover:bg-card"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Drop your files here, or click to upload</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Automatic format detection for CSV, TSV, TXT, Excel (XLSX, XLS), JSON, JSONL, PDF and Images.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {["CSV", "TSV", "XLSX", "JSON", "JSONL", "PDF", "PNG"].map((ext) => (
                <span key={ext} className="rounded border border-border bg-secondary px-2.5 py-0.5 text-[10px] font-mono font-medium">
                  .{ext.toLowerCase()}
                </span>
              ))}
            </div>
          </section>

          {/* 1-Click Sample Datasets */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Try Instant Sample Datasets</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Click any dataset to test zero-loss cleaning, MAD outlier isolation, and Critic verification immediately.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {SAMPLE_DATASETS.map((ds) => (
                <button
                  key={ds.id}
                  onClick={() => loadSample(ds.id)}
                  className="flex flex-col items-start rounded-lg border border-border bg-secondary/50 p-3.5 text-left transition-all hover:border-primary/40 hover:bg-secondary"
                >
                  <span className="font-semibold text-xs text-foreground">{ds.name}</span>
                  <span className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{ds.description}</span>
                  <span className="mt-2 text-[10px] font-mono text-primary">Load {ds.filename} →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Results View */
        <div className="mt-8 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Clean Rows" value={report.rowsAfter.toLocaleString()} />
            <Stat label="Quarantined" value={quarantineRows.length.toLocaleString()} />
            <Stat label="Duplicates Removed" value={report.duplicatesRemoved.toLocaleString()} />
            <Stat label="Blanks Imputed" value={report.cellsFilled.toLocaleString()} />
            <Stat label="Extreme Outliers" value={report.outliers.toLocaleString()} />
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-secondary/30">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cleaned Data Preview (Showing first 100 rows)
              </h3>
              <Link to="/dashboard" className="text-xs font-semibold text-primary hover:underline">
                Open Full Interactive Grid & Analytics →
              </Link>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-secondary font-semibold text-muted-foreground">
                    {headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-[11px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/40">
                      {headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-3 py-2">
                          {r[h] === null || r[h] === undefined ? (
                            <span className="text-muted-foreground italic font-mono">—</span>
                          ) : (
                            String(r[h])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-14 border-t border-border pt-6 text-center text-xs text-muted-foreground">
        Zero Data Loss Engine • Multi-Format Ingestion & Export • Autonomous Critic Gate
      </footer>
    </main>
  );
}
