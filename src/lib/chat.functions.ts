import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { DataMutationAction } from "./data-mutator";

const ChatInput = z.object({
  query: z.string().min(1),
  datasetName: z.string().default("Dataset"),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      missing: z.number().optional(),
      unique: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      mean: z.number().optional(),
    }),
  ),
  sampleRows: z.array(z.record(z.unknown())).max(20),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional(),
});

type ChatResponse = {
  answer: string;
  mutation?: DataMutationAction;
  error?: string;
};

function getGeminiKey(): string | null {
  let key = process.env["GEMINI_API_KEY"] || process.env["VITE_GEMINI_API_KEY"];
  if (!key) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/GEMINI_API_KEY\s*=\s*(.*)/);
        if (match?.[1]) key = match[1].trim();
      }
    } catch {
      // Ignored
    }
  }
  return key || null;
}

export const chatWithData = createServerFn({ method: "POST" })
  .validator((input: unknown) => ChatInput.parse(input))
  .handler(async ({ data }): Promise<ChatResponse> => {
    const apiKey = getGeminiKey();
    if (!apiKey) {
      return {
        answer: "AI Co-Pilot is not configured. Please ensure GEMINI_API_KEY is present in your environment or .env file.",
        error: "Missing API Key",
      };
    }

    const schemaSummary = data.columns
      .map(
        (c) =>
          `- ${c.name} (${c.type}): ${c.unique ?? "?"} unique, ${c.missing ?? 0} missing${
            c.mean !== undefined ? `, mean: ${c.mean}, min: ${c.min}, max: ${c.max}` : ""
          }`,
      )
      .join("\n");

    const sampleJson = JSON.stringify(data.sampleRows.slice(0, 8), null, 2);

    const systemPrompt = `You are the Elite AI Data Co-Pilot embedded in Data Refine Studio.
You have real-time access to the user's cleaned dataset '${data.datasetName}'.

Dataset Columns & Profiles:
${schemaSummary}

Sample Dataset Rows:
${sampleJson}

CAPABILITIES:
1. Answer analytical, statistical, and business questions with concise, high-clarity markdown. Use bullet points and bold highlights.
2. If the user asks to modify, clean, filter, mutate, or transform data (e.g. "remove negative amounts", "make states uppercase", "drop order_id", "replace status pending with In Progress", "fill missing phone numbers"), you MUST propose an executable mutation.

If proposing a mutation, include a JSON block at the very end of your response in the exact format:
\`\`\`json
{
  "mutation": {
    "type": "filter_rows" | "replace_values" | "transform_text" | "math_expression" | "drop_column" | "rename_column" | "impute_missing",
    "column": "<column_name>",
    "operator": "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "not_contains" | "is_not_null",
    "value": "<value>",
    "targetValue": "<old_value>",
    "replacementValue": "<new_value>",
    "operation": "uppercase" | "lowercase" | "trim" | "titlecase" | "multiply" | "add" | "subtract" | "divide" | "round",
    "operand": <number>,
    "oldName": "<col>",
    "newName": "<col>",
    "strategy": "median" | "mean" | "mode" | "constant",
    "constantValue": "<val>",
    "description": "<Concise user-facing summary of change>"
  }
}
\`\`\`
Only include the JSON mutation block if the user explicitly asked to change, filter, update, clean, or mutate the data. Otherwise, provide purely analytical insight.`;

    const contents = [
      {
        parts: [
          { text: systemPrompt },
          ...(data.history || []).map((h) => ({
            text: `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`,
          })),
          { text: `User: ${data.query}` },
        ],
      },
    ];

    const candidateModels = ["gemini-3.6-flash", "gemini-flash-latest"];
    let rawText = "";
    let lastError: string | null = null;

    for (const model of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000);

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({ contents }),
            },
          );

          clearTimeout(timeoutId);

          if (res.ok) {
            const json = await res.json();
            rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (rawText) break;
          } else {
            const errorBody = await res.text();
            if (res.status === 503 || res.status === 500) {
              lastError = `Google Gemini service temporarily overloaded (${res.status}). Retrying...`;
              await new Promise((r) => setTimeout(r, 600 * attempt));
              continue;
            } else {
              lastError = `Gemini API returned an error (${res.status}): ${errorBody.slice(0, 150)}`;
            }
          }
        } catch (e: any) {
          const isTimeout = e?.name === "AbortError";
          const code = e?.cause?.code || e?.cause?.message || "";
          lastError = isTimeout
            ? "Request timed out after 35 seconds."
            : `Network failure connecting to Gemini AI${code ? ` (${code})` : ""}.`;
          console.warn(`[AI Chatbot] ${model} attempt ${attempt} failed:`, e?.message, code);
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
      if (rawText) break;
    }

    if (!rawText) {
      return {
        answer: lastError || "Could not generate response from AI Co-Pilot.",
        error: "Generation failed",
      };
    }

    // Check if response contains a mutation action JSON block
    let answer = rawText;
    let mutation: DataMutationAction | undefined;

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?\{[\s\S]*?"mutation"[\s\S]*?\})\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.mutation) {
          mutation = parsed.mutation as DataMutationAction;
          // Remove the raw JSON block from the displayed answer text for clean UI
          answer = rawText.replace(jsonMatch[0], "").trim();
        }
      } catch {
        // Failed to parse mutation, fallback to displaying raw text
      }
    }

    return { answer, mutation };
  });
