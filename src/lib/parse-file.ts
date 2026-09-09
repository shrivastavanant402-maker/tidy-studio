import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Row } from "./clean";

export type DetectedFormat = "csv" | "tsv" | "excel" | "json" | "jsonl" | "image" | "pdf" | "unknown";

export type ParsedFileResult = {
  name: string;
  format: DetectedFormat;
  sizeBytes: number;
  rows: Row[];
};

export async function parseCsv(file: File): Promise<Row[]> {
  const text = await file.text();
  const res = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  return res.data.filter((r) => r && typeof r === "object");
}

export async function parseTsv(file: File): Promise<Row[]> {
  const text = await file.text();
  const res = Papa.parse<Row>(text, {
    header: true,
    delimiter: "\t",
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  return res.data.filter((r) => r && typeof r === "object");
}

export async function parseExcel(file: File): Promise<Row[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: false });
}

export async function parseJson(file: File): Promise<Row[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === "object") as Row[];
  }
  if (parsed && typeof parsed === "object") {
    // If it's a wrapper object like { data: [...] } or { rows: [...] }
    const candidate = parsed.data || parsed.rows || parsed.records || parsed.items;
    if (Array.isArray(candidate)) {
      return candidate.filter((r) => r && typeof r === "object") as Row[];
    }
    return [parsed as Row];
  }
  return [];
}

export async function parseJsonl(file: File): Promise<Row[]> {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object") {
        rows.push(obj as Row);
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  return rows;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Could not read the file"));
    fr.readAsDataURL(file);
  });
}

/**
 * Optimizes high-resolution image files before sending to AI to prevent payload size socket crashes.
 * Retains sharp text resolution while reducing multi-megabyte photos to lightweight web payloads.
 */
export async function optimizeImageForAi(file: File, maxDim = 2048, quality = 0.90): Promise<string> {
  if (typeof window === "undefined" || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return fileToDataUrl(file);
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fileToDataUrl(file).then(resolve);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        fileToDataUrl(file).then(resolve);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fileToDataUrl(file).then(resolve);
    };
    img.src = url;
  });
}

/**
 * Universal auto-detecting parser dispatcher.
 * Intelligently routes file types to the optimal parser.
 */
export async function parseFileAuto(
  file: File,
  extractImageFn?: (data: { dataUrl: string; filename: string }) => Promise<{ rows: Row[]; error?: string }>,
): Promise<ParsedFileResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const sizeBytes = file.size;
  let format: DetectedFormat = "unknown";
  let rows: Row[] = [];

  if (ext === "csv" || ext === "txt") {
    format = "csv";
    rows = await parseCsv(file);
  } else if (ext === "tsv") {
    format = "tsv";
    rows = await parseTsv(file);
  } else if (["xlsx", "xls", "xlsm", "xlsb"].includes(ext)) {
    format = "excel";
    rows = await parseExcel(file);
  } else if (ext === "json") {
    format = "json";
    rows = await parseJson(file);
  } else if (ext === "jsonl" || ext === "ndjson") {
    format = "jsonl";
    rows = await parseJsonl(file);
  } else if (file.type.startsWith("image/") || ext === "pdf" || file.type === "application/pdf") {
    format = ext === "pdf" ? "pdf" : "image";
    if (!extractImageFn) {
      throw new Error("AI Table extractor is required for reading images or PDF documents.");
    }
    const dataUrl = await optimizeImageForAi(file);
    const res = await extractImageFn({ dataUrl, filename: file.name });
    if (res.error) throw new Error(res.error);
    rows = res.rows;
  } else {
    // Fallback: try parsing as CSV
    try {
      rows = await parseCsv(file);
      format = "csv";
    } catch {
      throw new Error(
        `Unsupported file type: "${ext}". Supported formats: CSV, TSV, TXT, Excel (XLSX, XLS), JSON, JSONL, PDF, and Images.`,
      );
    }
  }

  if (rows.length === 0) {
    throw new Error(`We could not extract any tabular rows from "${file.name}". Please check the file contents.`);
  }

  return {
    name: file.name,
    format,
    sizeBytes,
    rows,
  };
}

export function rowsToWorkbookBlob(sheets: { name: string; rows: Row[] }[]): Blob {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
