import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cleanData,
  defaultOptions,
  type CleanOptions,
  type CleanReport,
  type QuarantineRow,
  type Row,
} from "@/lib/clean";
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
import { loadDictionary, type DictColumn } from "@/lib/dictionary";
import { SAMPLE_DATASETS } from "@/lib/sample-datasets";
import { applyDataMutation, type DataMutationAction } from "@/lib/data-mutator";

export type PipelineStage = "idle" | "reading" | "profiling" | "cleaning" | "critic" | "ready";

export function useCleaner() {
  const extract = useServerFn(extractTableFromImage);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [quarantineRows, setQuarantineRows] = useState<QuarantineRow[]>([]);
  const [critic, setCritic] = useState<CriticReport | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [undoStack, setUndoStack] = useState<Row[][]>([]);
  const [dictionaryRules, setDictionaryRules] = useState<DictColumn[]>(() => loadDictionary());
  const [options, setOptions] = useState<CleanOptions>(() => ({
    ...defaultOptions,
    quarantineInvalid: true,
  }));

  const applyAnalysis = useCallback((_name: string, _cleanedRows: Row[]) => {}, []);

  const runCleaningPipeline = useCallback(
    (inputRows: Row[], customOpts?: CleanOptions, customDict?: DictColumn[]) => {
      if (inputRows.length === 0) return;
      setPipelineStage("profiling");
      setStatus("Profiling schema & statistical distributions…");

      setTimeout(() => {
        setPipelineStage("cleaning");
        setStatus("Applying vectorized transformations & anomaly detection…");

        try {
          const dict = customDict ?? dictionaryRules;
          const opts: CleanOptions = {
            ...(customOpts ?? options),
            dictionary: dict,
          };

          const result = cleanData(inputRows, opts);

          setPipelineStage("critic");
          setStatus("Running autonomous Dual-Stage Critic validation…");

          setTimeout(() => {
            setRows(result.rows);
            setQuarantineRows(result.quarantineRows);
            setCritic(result.critic);
            setReport(result.report);
            setPipelineStage("ready");
            setStatus("");
            setBusy(false);
            applyAnalysis(fileName || "Dataset", result.rows);
          }, 80);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Pipeline execution failed.");
          setPipelineStage("idle");
          setBusy(false);
          setStatus("");
        }
      }, 60);
    },
    [dictionaryRules, options, fileName, applyAnalysis],
  );

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<DictColumn[]>;
      const next = customEvent.detail ?? loadDictionary();
      setDictionaryRules(next);
      if (rawRows.length > 0) {
        setBusy(true);
        runCleaningPipeline(rawRows, options, next);
      }
    };
    window.addEventListener("tidy:dictionary-updated", handleUpdate);
    return () => window.removeEventListener("tidy:dictionary-updated", handleUpdate);
  }, [rawRows, options, runCleaningPipeline]);

  const updateOptions = useCallback(
    (newOpts: Partial<CleanOptions>) => {
      setOptions((prev) => {
        const next = { ...prev, ...newOpts };
        if (rawRows.length > 0) {
          setBusy(true);
          runCleaningPipeline(rawRows, next);
        }
        return next;
      });
    },
    [rawRows, runCleaningPipeline],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setReport(null);
      setRows([]);
      setQuarantineRows([]);
      setCritic(null);
      setUndoStack([]);
      setFileName(file.name);
      setFileSize(file.size);
      setPipelineStage("reading");
      setStatus(`Ingesting ${file.name}…`);

      try {
        const parsedResult = await parseFileAuto(file, async (data) => {
          const res = (await extract({ data })) as { rows: Record<string, string>[]; error?: string };
          return { rows: res.rows as Row[], error: res.error };
        });

        setDetectedFormat(parsedResult.format);
        setRawRows(parsedResult.rows);
        runCleaningPipeline(parsedResult.rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read file.");
        setPipelineStage("idle");
        setBusy(false);
        setStatus("");
      }
    },
    [extract, runCleaningPipeline],
  );

  const loadSample = useCallback(
    (datasetId: string) => {
      const sample = SAMPLE_DATASETS.find((s) => s.id === datasetId);
      if (!sample) return;

      setBusy(true);
      setError(null);
      setFileName(sample.filename);
      setFileSize(JSON.stringify(sample.rows).length);
      setUndoStack([]);
      setDetectedFormat(sample.filename.endsWith(".json") ? "json" : sample.filename.endsWith(".xlsx") ? "excel" : "csv");
      setRawRows(sample.rows);
      runCleaningPipeline(sample.rows);
    },
    [runCleaningPipeline],
  );

  // In-place Data Mutation via AI Co-Pilot
  const applyMutation = useCallback(
    (action: DataMutationAction) => {
      if (rows.length === 0) return;
      // Push snapshot to undo stack
      setUndoStack((prev) => [...prev, [...rows]]);
      const mutationResult = applyDataMutation(rows, action);
      // Re-run report on mutated rows
      const freshResult = cleanData(mutationResult.rows, options);
      setRows(freshResult.rows);
      setReport(freshResult.report);
      setCritic(freshResult.critic);
    },
    [rows, options],
  );

  // Undo last mutation
  const undoLastMutation = useCallback(() => {
    if (undoStack.length === 0) return;
    const previousSnapshot = undoStack[undoStack.length - 1]!;
    setUndoStack((prev) => prev.slice(0, -1));
    const freshResult = cleanData(previousSnapshot, options);
    setRows(freshResult.rows);
    setReport(freshResult.report);
    setCritic(freshResult.critic);
  }, [undoStack, options]);

  // Manually edit a clean row
  const updateCleanRow = useCallback(
    (index: number, updatedRow: Row) => {
      if (index < 0 || index >= rows.length) return;
      setUndoStack((prev) => [...prev, [...rows]]);
      const nextRows = [...rows];
      nextRows[index] = updatedRow;
      const freshResult = cleanData(nextRows, options);
      setRows(freshResult.rows);
      setReport(freshResult.report);
      setCritic(freshResult.critic);
    },
    [rows, options],
  );

  // Manually edit a quarantine row or promote to clean
  const updateQuarantineRow = useCallback(
    (index: number, updatedRow: Record<string, unknown>, promoteToClean = false) => {
      if (index < 0 || index >= quarantineRows.length) return;
      if (promoteToClean) {
        const cleanCopy: Row = {};
        for (const [k, v] of Object.entries(updatedRow)) {
          if (
            !k.startsWith("_quarantine") &&
            !k.startsWith("_violated") &&
            !k.startsWith("_original") &&
            !k.startsWith("_quarantined")
          ) {
            cleanCopy[k] = v;
          }
        }
        setUndoStack((prev) => [...prev, [...rows]]);
        const nextQuarantine = quarantineRows.filter((_, i) => i !== index);
        const combined = [...rows, cleanCopy];
        const freshResult = cleanData(combined, options);
        setRows(freshResult.rows);
        setQuarantineRows([...nextQuarantine, ...freshResult.quarantineRows]);
        setReport(freshResult.report);
        setCritic(freshResult.critic);
      } else {
        const nextQuarantine = [...quarantineRows];
        nextQuarantine[index] = updatedRow as unknown as QuarantineRow;
        setQuarantineRows(nextQuarantine);
      }
    },
    [rows, quarantineRows, options],
  );

  const exportData = useCallback(
    (format: ExportFormat, target: "clean" | "quarantine" = "clean") => {
      const baseName = fileName.replace(/\.[^.]+$/, "") || "dataset";
      const targetRows = target === "quarantine" ? (quarantineRows as unknown as Row[]) : rows;
      const targetSuffix = target === "quarantine" ? "-quarantine-log" : "-cleaned";

      if (targetRows.length === 0 && format !== "xlsx" && format !== "markdown") {
        setError(`No ${target} rows available to export.`);
        return;
      }

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
          exportToHtml(targetRows, `${baseName}${targetSuffix}.html`, `${fileName} (${target})`);
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
    },
    [fileName, rows, quarantineRows, rawRows, report, critic],
  );

  const missingChart = useMemo(
    () =>
      (report?.columns ?? [])
        .map((c) => ({ name: c.name, before: c.missingBefore, after: c.missingAfter }))
        .filter((c) => c.before > 0)
        .slice(0, 12),
    [report],
  );

  const typeChart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of report?.columns ?? []) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    return Array.from(counts, ([name, value]) => ({ name, value }));
  }, [report]);

  const numericChart = useMemo(
    () =>
      (report?.columns ?? [])
        .filter((c) => c.mean !== undefined)
        .slice(0, 10)
        .map((c) => ({ name: c.name, average: Number((c.mean ?? 0).toFixed(2)) })),
    [report],
  );

  const activeRulesCount = useMemo(
    () => dictionaryRules.filter((r) => r.column.trim().length > 0).length,
    [dictionaryRules],
  );

  return {
    busy,
    status,
    pipelineStage,
    detectedFormat,
    error,
    fileName,
    fileSize,
    rawRows,
    rows,
    quarantineRows,
    critic,
    report,
    options,
    dictionaryRules,
    activeRulesCount,
    canUndo: undoStack.length > 0,
    updateOptions,
    handleFile,
    loadSample,
    applyMutation,
    undoLastMutation,
    updateCleanRow,
    updateQuarantineRow,
    exportData,
    missingChart,
    typeChart,
    numericChart,
  };
}
