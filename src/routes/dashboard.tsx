import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  FileCode,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Loader2,
  Moon,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  TableProperties,
  Undo2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useCleaner, type PipelineStage } from "@/hooks/use-cleaner";
import { SAMPLE_DATASETS } from "@/lib/sample-datasets";
import type { ExportFormat } from "@/lib/export-data";
import { LiveVisualizer } from "@/components/LiveVisualizer";
import { DataChatbot } from "@/components/DataChatbot";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Workspace — Enterprise Data Cleaning Studio" },
      {
        name: "description",
        content:
          "Multi-format ingestion, zero-loss streaming cleaning, dual-stage Critic verification, live Recharts visualization, and conversational AI data mutations.",
      },
    ],
  }),
  component: Dashboard,
});

function PipelineStepper({ stage }: { stage: PipelineStage }) {
  const steps: { key: PipelineStage; label: string }[] = [
    { key: "reading", label: "Ingestion" },
    { key: "profiling", label: "Profiling" },
    { key: "cleaning", label: "Vectorized Clean" },
    { key: "critic", label: "Critic Gate" },
    { key: "ready", label: "Certified Ready" },
  ];

  const stageOrder = ["idle", "reading", "profiling", "cleaning", "critic", "ready"];
  const currentIdx = stageOrder.indexOf(stage);

  return (
    <div className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-card/60 px-4 py-2.5 text-xs backdrop-blur-md">
      {steps.map((step, idx) => {
        const stepOrderIdx = stageOrder.indexOf(step.key);
        const isDone = currentIdx > stepOrderIdx || stage === "ready";
        const isCurrent = stage === step.key;

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-all duration-300 ${
                isDone
                  ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                  : isCurrent
                    ? "animate-pulse bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {isDone ? "✓" : idx + 1}
            </div>
            <span
              className={`hidden sm:inline font-medium text-[11px] ${
                isDone
                  ? "text-emerald-500 font-semibold"
                  : isCurrent
                    ? "text-primary font-bold"
                    : "text-muted-foreground"
              }`}
            >
              {step.label}
            </span>
            {idx < steps.length - 1 ? <span className="text-border/60 mx-1 hidden sm:inline">→</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function Dashboard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"grid" | "quarantine" | "visuals">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<{
    row: Record<string, unknown>;
    source: "clean" | "quarantine";
    index: number;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setIsDark(document.documentElement.classList.contains("dark"));
    }
  }, []);

  const toggleTheme = () => {
    if (typeof document !== "undefined") {
      const next = !isDark;
      setIsDark(next);
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  };

  const {
    busy,
    status,
    pipelineStage,
    detectedFormat,
    error,
    fileName,
    rows,
    quarantineRows,
    critic,
    report,
    options,
    activeRulesCount,
    canUndo,
    updateOptions,
    handleFile,
    loadSample,
    applyMutation,
    undoLastMutation,
    updateCleanRow,
    updateQuarantineRow,
    exportData,
  } = useCleaner();

  const headers = report?.columns.map((c) => c.name) ?? (rows.length ? Object.keys(rows[0] ?? {}) : []);

  const columnTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of report?.columns ?? []) {
      map.set(c.name, c.type);
    }
    return map;
  }, [report]);

  const handleSelectRow = (
    row: Record<string, unknown>,
    source: "clean" | "quarantine",
    startEditing = false,
  ) => {
    const idx =
      source === "clean"
        ? rows.indexOf(row as any)
        : quarantineRows.indexOf(row as any);
    setSelectedRecord({ row, source, index: idx >= 0 ? idx : 0 });
    const initialVals: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      initialVals[k] = v === null || v === undefined ? "" : String(v);
    }
    setEditValues(initialVals);
    setIsEditing(startEditing);
    setSaveToast(null);
  };

  const handleSaveEdit = (promoteQuarantineToClean = false) => {
    if (!selectedRecord) return;
    const { source, index } = selectedRecord;

    const updatedRow: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editValues)) {
      const type = columnTypeMap.get(k);
      const strVal = v.trim();
      if (strVal === "") {
        updatedRow[k] = null;
      } else if (type === "number" && !isNaN(Number(strVal))) {
        updatedRow[k] = Number(strVal);
      } else if (type === "boolean") {
        updatedRow[k] = strVal.toLowerCase() === "true";
      } else {
        updatedRow[k] = strVal;
      }
    }

    if (source === "clean") {
      updateCleanRow(index, updatedRow);
      setSaveToast("Clean record updated successfully!");
      setSelectedRecord((prev) => (prev ? { ...prev, row: updatedRow } : null));
      setIsEditing(false);
    } else {
      if (promoteQuarantineToClean) {
        updateQuarantineRow(index, updatedRow, true);
        setSaveToast("Record re-validated and moved to Clean Data!");
        setTimeout(() => setSelectedRecord(null), 1200);
      } else {
        updateQuarantineRow(index, updatedRow, false);
        setSaveToast("Quarantine record updated successfully!");
        setSelectedRecord((prev) => (prev ? { ...prev, row: updatedRow } : null));
        setIsEditing(false);
      }
    }
    setTimeout(() => setSaveToast(null), 3000);
  };

  // Filter rows based on search query
  const filteredRows = rows.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q));
  });

  const filteredQuarantineRows = quarantineRows.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r._quarantineReason.toLowerCase().includes(q) ||
      r._violatedColumn.toLowerCase().includes(q) ||
      String(r._originalValue ?? "").toLowerCase().includes(q)
    );
  });

  const handleExportSelect = (format: ExportFormat, target: "clean" | "quarantine" = "clean") => {
    setShowExportMenu(false);
    exportData(format, target);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1680px] px-6 py-6 font-sans">
      {/* Top Navigation & App Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 p-2 shadow-md shadow-indigo-500/25 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 drop-shadow-sm">
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="rgba(255,255,255,0.25)" />
              <circle cx="12" cy="12" r="2.5" fill="white" stroke="none" />
            </svg>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-card"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground font-display">
                Tidy Studio
              </h1>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-primary border border-primary/25 uppercase font-mono">
                Data Agent
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 border border-emerald-500/20">
                v2.5 Live
              </span>
              {detectedFormat !== "unknown" ? (
                <span className="rounded-full border border-border/80 bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
                  {detectedFormat}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Enterprise Data Cleaning • Live Visualization • Conversational Co-Pilot
            </p>
          </div>
        </div>

        {/* Global Action Tools */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            to="/"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline mr-1"
          >
            Home
          </Link>
          <Link
            to="/dictionary"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline mr-2"
          >
            Dictionary{activeRulesCount ? ` (${activeRulesCount})` : ""}
          </Link>

          {/* Quick Demo Dataset Dropdown */}
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                loadSample(e.target.value);
                e.target.value = "";
              }
            }}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary cursor-pointer transition-colors"
            title="Load sample dataset"
          >
            <option value="" disabled>
              ⚡ Load Demo…
            </option>
            {SAMPLE_DATASETS.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name}
              </option>
            ))}
          </select>

          {/* Theme Mode Switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
          </button>

          {/* Hidden File Input */}
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

          {/* Undo Action Pill */}
          {canUndo ? (
            <button
              type="button"
              onClick={undoLastMutation}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/20 transition-all shadow-sm"
              title="Undo last AI modification"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Undo Last AI Edit</span>
            </button>
          ) : null}

          {/* Upload Button */}
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {busy ? status || "Processing…" : fileName ? "Replace File" : "Upload File"}
          </button>

          {/* Pipeline Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowSettingsDrawer(!showSettingsDrawer)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Rules</span>
          </button>

          {/* Multi-Format Export Center */}
          {report ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:opacity-95"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Multi-Format</span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showExportMenu ? (
                <div
                  className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-white/10 bg-card/95 p-2 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
                  onMouseLeave={() => setShowExportMenu(false)}
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Available Data Formats
                  </div>
                  <button
                    onClick={() => handleExportSelect("xlsx")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                    <div>
                      <div className="font-semibold">Excel Multi-Sheet (.xlsx)</div>
                      <div className="text-[10px] text-muted-foreground">Clean, Quarantine & Audit</div>
                    </div>
                  </button>
                  <button
                    onClick={() => handleExportSelect("csv")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileText className="h-4 w-4 text-blue-500" />
                    <span>CSV (.csv)</span>
                  </button>
                  <button
                    onClick={() => handleExportSelect("tsv")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileText className="h-4 w-4 text-amber-500" />
                    <span>TSV (.tsv)</span>
                  </button>
                  <button
                    onClick={() => handleExportSelect("json")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileCode className="h-4 w-4 text-purple-500" />
                    <span>JSON Formatted (.json)</span>
                  </button>
                  <button
                    onClick={() => handleExportSelect("jsonl")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileCode className="h-4 w-4 text-indigo-500" />
                    <span>JSONL Stream (.jsonl)</span>
                  </button>
                  <button
                    onClick={() => handleExportSelect("markdown")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileText className="h-4 w-4 text-rose-500" />
                    <span>Markdown Audit (.md)</span>
                  </button>
                  <button
                    onClick={() => handleExportSelect("html")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <TableProperties className="h-4 w-4 text-teal-500" />
                    <span>HTML View (.html)</span>
                  </button>
                  <button
                    onClick={() => handleExportSelect("pdf")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary transition-colors text-left"
                  >
                    <FileText className="h-4 w-4 text-red-500" />
                    <div>
                      <div className="font-semibold">PDF Quality Report (.pdf)</div>
                      <div className="text-[10px] text-muted-foreground">Certified printable document</div>
                    </div>
                  </button>

                  {quarantineRows.length > 0 ? (
                    <>
                      <div className="my-1.5 border-t border-border/60" />
                      <button
                        onClick={() => handleExportSelect("csv", "quarantine")}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors text-left"
                      >
                        <FileDown className="h-4 w-4" />
                        <span className="font-semibold">Export Quarantine CSV ({quarantineRows.length})</span>
                      </button>
                      <button
                        onClick={() => handleExportSelect("pdf", "quarantine")}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors text-left"
                      >
                        <FileText className="h-4 w-4" />
                        <span className="font-semibold">Export Quarantine PDF ({quarantineRows.length})</span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/* Pipeline Status Stepper */}
      {busy || report ? (
        <div className="mt-4">
          <PipelineStepper stage={pipelineStage} />
        </div>
      ) : null}

      {/* Error Message */}
      {error ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Rules Config Drawer */}
      {showSettingsDrawer ? (
        <div className="mt-4 rounded-2xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur-xl animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-bold text-foreground">Reactive Cleaning Rules</h3>
            </div>
            <button
              onClick={() => setShowSettingsDrawer(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={options.dropDuplicates}
                onChange={(e) => updateOptions({ dropDuplicates: e.target.checked })}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span>Deduplicate exact rows</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={options.fillMissing}
                onChange={(e) => updateOptions({ fillMissing: e.target.checked })}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span>Impute missing values</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={options.trimText}
                onChange={(e) => updateOptions({ trimText: e.target.checked })}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span>Trim extra whitespace</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={options.standardizeCase}
                onChange={(e) => updateOptions({ standardizeCase: e.target.checked })}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span>Harmonize category casing</span>
            </label>
          </div>
        </div>
      ) : null}

      {/* Critic Verification Card */}
      {critic && report ? (
        <div
          className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs shadow-sm backdrop-blur-md ${
            critic.passed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {critic.passed ? (
              <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
            )}
            <span className="font-semibold">
              {critic.passed
                ? "Critic Dual-Stage Verification: PASSED — Schema invariance, null-shift tolerances, and zero data loss verified."
                : `Critic Warning: ${critic.violations.join(" | ")}`}
            </span>
          </div>

          <div className="flex items-center gap-3 text-muted-foreground font-mono">
            <span>Quarantine Rate: {critic.quarantinePercentage}%</span>
            {quarantineRows.length > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab("quarantine")}
                className="font-bold text-amber-600 dark:text-amber-400 underline hover:opacity-80"
              >
                Inspect Quarantined ({quarantineRows.length})
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Main Content Area */}
      {!report ? (
        /* Empty Upload Screen with Sample Datasets */
        <div className="mt-8 space-y-6">
          <section
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-3xl border-2 border-dashed border-border/80 bg-gradient-to-b from-card/70 to-card/40 px-6 py-20 text-center transition-all hover:border-primary/50 hover:bg-card/90 shadow-xl backdrop-blur-xl"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-indigo-500/20 to-purple-500/20 text-primary border border-primary/20 shadow-inner">
              <Upload className="h-8 w-8" />
            </div>
            <h2 className="mt-5 text-xl font-bold tracking-tight text-foreground font-display">
              Drop your raw data file here
            </h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
              Automated ingestion for CSV, TSV, TXT, Excel (XLSX, XLS), JSON, JSONL, PDF, and image tables.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {["CSV", "TSV", "XLSX", "JSON", "JSONL", "PDF", "PNG"].map((ext) => (
                <span
                  key={ext}
                  className="rounded-full border border-border/80 bg-secondary/80 px-3 py-0.5 text-[10px] font-mono font-medium text-foreground"
                >
                  .{ext.toLowerCase()}
                </span>
              ))}
            </div>
          </section>

          {/* Sample Datasets */}
          <div className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-lg backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">1-Click Demonstration Datasets</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Experience zero-loss data cleaning, live charts, and AI data mutations immediately:
            </p>

            <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
              {SAMPLE_DATASETS.map((ds) => (
                <button
                  key={ds.id}
                  onClick={() => loadSample(ds.id)}
                  className="group flex flex-col items-start rounded-xl border border-border/70 bg-secondary/40 p-4 text-left transition-all hover:border-primary/50 hover:bg-secondary/70 hover:shadow-md"
                >
                  <span className="font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                    {ds.name}
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                    {ds.description}
                  </span>
                  <span className="mt-2 text-[10px] font-mono text-primary flex items-center gap-1">
                    Load {ds.filename} →
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Populated Studio Workspace Layout */
        <div className="mt-6 space-y-6">
          {/* Studio Navigation Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("grid")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === "grid"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <TableProperties className="h-3.5 w-3.5" />
                <span>Cleaned Data ({rows.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("quarantine")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === "quarantine"
                    ? "bg-amber-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Quarantine Log ({quarantineRows.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("visuals")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === "visuals"
                    ? "bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>Live Charts & Analytics</span>
              </button>
            </div>

            {/* In-table Quick Search */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search across columns & rows…"
                className="w-full rounded-lg border border-border/80 bg-secondary/50 py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>

          {/* TAB 1: Cleaned Data Grid */}
          {activeTab === "grid" ? (
            <div className="rounded-2xl border border-border/80 bg-card/90 shadow-xl backdrop-blur-xl overflow-hidden">
              <div className="max-h-[62vh] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-secondary/90 font-semibold text-muted-foreground uppercase tracking-wider backdrop-blur-md">
                      <th className="px-3.5 py-2.5 text-[10px] w-12 text-center font-mono">#</th>
                      {headers.map((h) => {
                        const colType = columnTypeMap.get(h) || "text";
                        return (
                          <th key={h} className="whitespace-nowrap px-3.5 py-2.5 text-[11px] font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-foreground">{h}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-medium lowercase ${
                                  colType === "number"
                                    ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                                    : colType === "date"
                                      ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"
                                      : colType === "email"
                                        ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                                        : colType === "boolean"
                                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                          : "bg-slate-500/15 text-slate-600 dark:text-slate-400"
                                }`}
                              >
                                {colType === "number"
                                  ? "# num"
                                  : colType === "date"
                                    ? "📅 date"
                                    : colType === "email"
                                      ? "✉ email"
                                      : colType === "boolean"
                                        ? "✓ bool"
                                        : "Aa txt"}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 150).map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => handleSelectRow(r, "clean")}
                        className="group border-b border-border/40 hover:bg-secondary/60 cursor-pointer transition-colors"
                      >
                        <td className="px-3.5 py-2 font-mono text-[10px] text-muted-foreground text-center relative">
                          <span className="group-hover:hidden">{i + 1}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectRow(r, "clean", true);
                            }}
                            className="hidden group-hover:inline-flex items-center justify-center text-primary hover:scale-110 transition-all"
                            title="Edit Record Values"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        {headers.map((h) => {
                          const colType = columnTypeMap.get(h);
                          const val = r[h];
                          const isNull = val === null || val === undefined || String(val).trim() === "";
                          return (
                            <td key={h} className="whitespace-nowrap px-3.5 py-2 text-foreground font-mono">
                              {isNull ? (
                                <span className="inline-block rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/70 italic font-sans">
                                  null
                                </span>
                              ) : colType === "number" ? (
                                <span className="font-mono tabular-nums text-foreground font-medium">
                                  {isNaN(Number(val)) ? String(val) : Number(val).toLocaleString()}
                                </span>
                              ) : colType === "boolean" ? (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    String(val).toLowerCase() === "true"
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {String(val)}
                                </span>
                              ) : (
                                <span className="truncate max-w-[280px] inline-block font-sans text-xs">
                                  {String(val)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground bg-secondary/20">
                <span>
                  Showing {Math.min(filteredRows.length, 150)} of {filteredRows.length.toLocaleString()} clean rows
                  {searchQuery ? ` (filtered from ${rows.length})` : ""}
                </span>
                <span className="font-medium text-primary flex items-center gap-1.5">
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Click any row to inspect & edit values</span>
                </span>
              </div>
            </div>
          ) : null}

          {/* TAB 2: Quarantine Log Grid */}
          {activeTab === "quarantine" ? (
            <div className="rounded-2xl border border-border/80 bg-card/90 shadow-xl backdrop-blur-xl overflow-hidden">
              {quarantineRows.length === 0 ? (
                <div className="p-16 text-center text-xs text-muted-foreground">
                  <ShieldCheck className="mx-auto h-10 w-10 text-emerald-500 mb-2" />
                  <p className="font-bold text-sm text-foreground">Zero Quarantined Records</p>
                  <p className="mt-1">All dataset records conformed to cleaning specifications without violation.</p>
                </div>
              ) : (
                <>
                  <div className="max-h-[62vh] overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-border bg-amber-500/10 font-semibold text-amber-900 dark:text-amber-200 uppercase tracking-wider text-[11px] backdrop-blur-md">
                          <th className="px-3.5 py-2.5 w-10 text-center font-mono">#</th>
                          <th className="px-3.5 py-2.5">Quarantine Reason</th>
                          <th className="px-3.5 py-2.5">Violated Column</th>
                          <th className="px-3.5 py-2.5">Original Untouched Value</th>
                          <th className="px-3.5 py-2.5">Timestamp</th>
                          <th className="px-3.5 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQuarantineRows.slice(0, 150).map((r, i) => (
                          <tr
                            key={i}
                            onClick={() => handleSelectRow(r, "quarantine")}
                            className="group border-b border-border/40 hover:bg-amber-500/5 cursor-pointer transition-colors"
                          >
                            <td className="px-3.5 py-2.5 font-mono text-[10px] text-muted-foreground text-center">
                              {i + 1}
                            </td>
                            <td className="px-3.5 py-2.5 font-medium text-destructive">{r._quarantineReason}</td>
                            <td className="px-3.5 py-2.5 font-mono font-bold text-foreground">{r._violatedColumn}</td>
                            <td className="px-3.5 py-2.5 text-muted-foreground font-mono">{String(r._originalValue)}</td>
                            <td className="px-3.5 py-2.5 text-[10px] text-muted-foreground font-mono">
                              {r._quarantinedAt.slice(11, 19)}
                            </td>
                            <td className="px-3.5 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectRow(r, "quarantine", true);
                                }}
                                className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all shadow-sm"
                                title="Edit or fix record values"
                              >
                                <Edit3 className="h-3 w-3" />
                                <span>Edit / Fix</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground bg-amber-500/5">
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{quarantineRows.length} non-conforming records preserved. Click any row to inspect & edit values.</span>
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => exportData("csv", "quarantine")}
                        className="font-bold text-amber-600 dark:text-amber-400 hover:underline"
                      >
                        Download CSV →
                      </button>
                      <button
                        onClick={() => exportData("pdf", "quarantine")}
                        className="font-bold text-red-600 dark:text-red-400 hover:underline"
                      >
                        Download PDF Report →
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* TAB 3: Live Visualizer */}
          {activeTab === "visuals" ? (
            <LiveVisualizer rows={rows} report={report} quarantineCount={quarantineRows.length} />
          ) : null}
        </div>
      )}

      {/* Row Inspector & Manual Value Editor Modal */}
      {selectedRecord ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => {
            setSelectedRecord(null);
            setIsEditing(false);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-card p-6 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3.5">
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-bold text-foreground font-display">
                  {isEditing ? "Edit Record Values" : "Record Field Inspector"}
                </h3>
                {selectedRecord.source === "clean" ? (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    Clean Record #{selectedRecord.index + 1}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Quarantined Record #{selectedRecord.index + 1}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!isEditing ? (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-sm"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Edit Values</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/80 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Cancel</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      JSON.stringify(isEditing ? editValues : selectedRecord.row, null, 2),
                    );
                    setCopiedJson(true);
                    setTimeout(() => setCopiedJson(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/80 px-2.5 py-1 text-xs text-foreground hover:bg-secondary transition-colors"
                  title="Copy as JSON"
                >
                  {copiedJson ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedJson ? "Copied" : "JSON"}</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedRecord(null);
                    setIsEditing(false);
                  }}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Notification banner on save */}
            {saveToast ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                <Check className="h-4 w-4 shrink-0" />
                <span>{saveToast}</span>
              </div>
            ) : null}

            {/* Quarantine Reason banner */}
            {selectedRecord.source === "quarantine" ? (
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <div>
                    <span className="font-bold">Quarantine Cause: </span>
                    <span>{String(selectedRecord.row._quarantineReason || "Validation violation")}</span>
                    {selectedRecord.row._violatedColumn ? (
                      <span className="block mt-0.5 font-mono text-[11px] opacity-80">
                        Violated Column: <strong>{String(selectedRecord.row._violatedColumn)}</strong> • Original Value: <code>{String(selectedRecord.row._originalValue)}</code>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Modal Body */}
            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              {!isEditing ? (
                /* READ-ONLY VIEW */
                <div className="space-y-2">
                  {Object.entries(selectedRecord.row).map(([k, v]) => {
                    const isAuditFlag = k.startsWith("_");
                    return (
                      <div
                        key={k}
                        className={`flex items-center justify-between rounded-lg border px-3.5 py-2 text-xs transition-colors ${
                          isAuditFlag
                            ? "border-amber-500/20 bg-amber-500/5 text-amber-900 dark:text-amber-200"
                            : "border-border/60 bg-secondary/30 hover:bg-secondary/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-muted-foreground">{k}</span>
                          {columnTypeMap.has(k) ? (
                            <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
                              {columnTypeMap.get(k)}
                            </span>
                          ) : null}
                        </div>
                        <span className="font-mono font-medium text-foreground max-w-sm truncate text-right">
                          {v === null || v === undefined ? (
                            <span className="italic text-muted-foreground/60">null</span>
                          ) : (
                            String(v)
                          )}
                        </span>
                      </div>
                    );
                  })}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 py-2.5 text-xs font-bold text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Edit3 className="h-4 w-4" />
                      <span>Edit These Values Manually</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* INTERACTIVE EDIT FORM */
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveEdit(false);
                  }}
                  className="space-y-3"
                >
                  <p className="text-[11px] text-muted-foreground">
                    Modify cell values directly. Numerical and date formats are preserved automatically.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.keys(selectedRecord.row)
                      .filter((k) => !k.startsWith("_"))
                      .map((k) => {
                        const colType = columnTypeMap.get(k) || "text";
                        return (
                          <div key={k} className="space-y-1">
                            <label className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                              <span className="font-mono">{k}</span>
                              <span className="text-[9px] font-mono lowercase opacity-70">({colType})</span>
                            </label>
                            <input
                              type="text"
                              value={editValues[k] ?? ""}
                              onChange={(e) =>
                                setEditValues((prev) => ({ ...prev, [k]: e.target.value }))
                              }
                              placeholder="Enter value or leave blank for null…"
                              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        );
                      })}
                  </div>

                  {/* Form Action Buttons */}
                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSaveEdit(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-all"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Save Changes</span>
                    </button>

                    {selectedRecord.source === "quarantine" ? (
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 hover:opacity-95 transition-all"
                        title="Re-validate against cleaning rules and promote to clean dataset"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Save & Move to Clean Data</span>
                      </button>
                    ) : null}
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Embedded AI Data Co-Pilot Chatbot */}
      {report ? (
        <DataChatbot
          datasetName={fileName || "Dataset"}
          rows={rows}
          report={report}
          onApplyMutation={applyMutation}
          onUndoMutation={undoLastMutation}
          canUndo={canUndo}
        />
      ) : null}

      <footer className="mt-14 border-t border-border/80 pt-6 text-center text-xs text-muted-foreground">
        Tidy Studio • Autonomous Zero-Loss Data Architecture • AI Data Co-Pilot Powered by Gemini
      </footer>
    </main>
  );
}
