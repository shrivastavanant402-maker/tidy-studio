import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const Input = z.object({
  dataUrl: z.string().min(20),
  filename: z.string().default("image"),
  apiKey: z.string().optional(),
});

type TableResult = {
  columns: string[];
  rows: Record<string, string>[];
  error?: string;
};

function failed(message: string): TableResult {
  return { columns: [], rows: [], error: message };
}

function resolveApiKey(clientKey?: string): { type: "gemini" | "lovable"; key: string } | null {
  if (clientKey?.trim()) {
    return { type: "gemini", key: clientKey.trim() };
  }

  let geminiKey = process.env["GEMINI_API_KEY"] || process.env["VITE_GEMINI_API_KEY"];
  let lovableKey = process.env["LOVABLE_API_KEY"] || process.env["VITE_LOVABLE_API_KEY"];

  if (!geminiKey && !lovableKey) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const geminiMatch = content.match(/GEMINI_API_KEY\s*=\s*(.*)/);
        if (geminiMatch?.[1]) geminiKey = geminiMatch[1].trim();
        const lovableMatch = content.match(/LOVABLE_API_KEY\s*=\s*(.*)/);
        if (lovableMatch?.[1]) lovableKey = lovableMatch[1].trim();
      }
    } catch {
      // Ignored if file cannot be read
    }
  }

  if (geminiKey) return { type: "gemini", key: geminiKey };
  if (lovableKey) return { type: "lovable", key: lovableKey };
  return null;
}

export const extractTableFromImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<TableResult> => {
    const keyConfig = resolveApiKey(data.apiKey);
    if (!keyConfig) {
      return failed(
        "AI is not configured. Please add GEMINI_API_KEY to your .env file or enter an API key in the studio settings.",
      );
    }

    let mime = /^data:([^;,]+)/i.exec(data.dataUrl)?.[1]?.toLowerCase() || "image/png";
    if (mime === "image/svg+xml") {
      return failed("SVG files cannot be read as data tables. Please upload a PNG, JPG, WEBP, or PDF instead.");
    }
    // Normalize JPEG mimes
    if (mime === "image/jpg" || mime === "image/pjpeg") {
      mime = "image/jpeg";
    }

    let raw = "";
    let lastError: string | null = null;

    if (keyConfig.type === "gemini") {
      const candidateModels = ["gemini-3.6-flash", "gemini-flash-latest"];
      const base64Data = data.dataUrl.replace(/^data:[^;]+;base64,/, "").trim();

      for (const model of candidateModels) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);

            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyConfig.key}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        {
                          text: "You extract tabular data from images and PDF documents. Return ONLY strict JSON of the shape {\"columns\":[string],\"rows\":[object]} where each row object uses the column names as keys. Preserve original values as strings. If there is no table, return {\"columns\":[],\"rows\":[]}. No markdown commentary.",
                        },
                        {
                          inlineData: {
                            mimeType: mime === "application/pdf" ? "application/pdf" : mime,
                            data: base64Data,
                          },
                        },
                      ],
                    },
                  ],
                }),
              },
            );

            clearTimeout(timeoutId);

            if (res.ok) {
              const json = (await res.json()) as {
                candidates?: { content?: { parts?: { text?: string }[] } }[];
              };
              raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
              if (raw) break;
            } else {
              const body = await res.text();
              if (res.status === 429) {
                lastError = "Rate limit reached. Please wait a moment and try again.";
              } else if (res.status === 403 || res.status === 401) {
                return failed("Invalid or expired GEMINI_API_KEY. Please check your API key in .env.");
              } else if (res.status === 503 || res.status === 500) {
                lastError = `Google Gemini service temporarily overloaded (${res.status}). Retrying...`;
                await new Promise((r) => setTimeout(r, 600 * attempt));
                continue;
              } else {
                lastError = `Gemini API error (${res.status}): ${body.slice(0, 180)}`;
              }
            }
          } catch (fetchErr: any) {
            const isTimeout = fetchErr?.name === "AbortError";
            const code = fetchErr?.cause?.code || fetchErr?.cause?.message || "";
            lastError = isTimeout
              ? "The table extraction request timed out after 35 seconds. Please try a smaller image or clean export."
              : `Connection to AI service temporarily interrupted${code ? ` (${code})` : ""}. Retrying...`;
            console.warn(`[AI Extractor] ${model} attempt ${attempt} failed:`, fetchErr?.message, code);
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }
        if (raw) break;
      }

      if (!raw && lastError) {
        return failed(lastError);
      }
    } else {
      // Lovable Gateway fallback
      try {
        const mediaBlock =
          mime === "application/pdf"
            ? {
                type: "file",
                file: { filename: data.filename, file_data: data.dataUrl },
              }
            : { type: "image_url", image_url: { url: data.dataUrl } };

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keyConfig.key}`,
          },
          signal: AbortSignal.timeout(35000),
          body: JSON.stringify({
            model: "google/gemini-3.6-flash",
            messages: [
              {
                role: "system",
                content:
                  "You extract tabular data from images and PDF documents. Return ONLY strict JSON of the shape {\"columns\":[string],\"rows\":[object]} where each row object uses the column names as keys. Preserve original values as strings. If there is no table, return {\"columns\":[],\"rows\":[]}. No markdown, no commentary.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Extract every visible row and column from the table as JSON." },
                  mediaBlock,
                ],
              },
            ],
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429) return failed("Too many requests right now. Please try again shortly.");
          if (res.status === 402) return failed("AI credits are exhausted for this workspace.");
          return failed(`Could not read the file (${res.status}). ${body.slice(0, 200)}`);
        }

        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        raw = (json.choices?.[0]?.message?.content ?? "").trim();
      } catch (gatewayErr: any) {
        return failed(`AI gateway is temporarily unreachable: ${gatewayErr?.message || "Network error"}`);
      }
    }

    if (!raw) return failed("The AI extractor returned nothing. Please try a clearer picture of the table.");

    // Strip markdown fences, then take the outermost JSON object or array.
    const unfenced = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const objMatch = unfenced.match(/\{[\s\S]*\}/);
    const arrMatch = unfenced.match(/\[[\s\S]*\]/);
    const candidate =
      objMatch && (!arrMatch || objMatch.index! <= arrMatch.index!) ? objMatch[0] : arrMatch?.[0];
    if (!candidate) return failed("No table could be found. Please use a clear, straight-on picture of the table.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return failed("The table could not be read. Please try a clearer image or export it as CSV or Excel.");
    }

    // Accept several shapes: {columns,rows}, {data:[...]}, [...] , or rows of arrays.
    let columns: string[] = [];
    let rawRows: unknown[] = [];
    if (Array.isArray(parsed)) {
      rawRows = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj["columns"])) columns = (obj["columns"] as unknown[]).map(String);
      const listKey = ["rows", "data", "table", "records", "items"].find((k) => Array.isArray(obj[k]));
      if (listKey) rawRows = obj[listKey] as unknown[];
      else {
        const firstList = Object.values(obj).find((v) => Array.isArray(v));
        if (Array.isArray(firstList)) rawRows = firstList;
      }
    }

    const rows: Record<string, string>[] = [];
    for (const r of rawRows) {
      if (Array.isArray(r)) {
        const cells = r.map((c) => (c == null ? "" : String(c)));
        if (!columns.length) {
          columns = cells.map((c, i) => c || `Column ${i + 1}`);
          continue;
        }
        const row: Record<string, string> = {};
        columns.forEach((c, i) => (row[c] = cells[i] ?? ""));
        rows.push(row);
      } else if (r && typeof r === "object") {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
          row[k] = v == null ? "" : String(v);
        }
        if (Object.keys(row).length) rows.push(row);
      }
    }

    if (rows.length === 0) {
      return failed(
        "No table rows were found. Please upload a clear picture or PDF that shows a table with visible rows and columns.",
      );
    }

    return { columns: columns.length ? columns : Object.keys(rows[0] ?? {}), rows };
  });
