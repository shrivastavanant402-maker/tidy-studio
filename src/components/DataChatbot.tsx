import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  User,
  Wand2,
  X,
} from "lucide-react";
import { chatWithData } from "@/lib/chat.functions";
import type { CleanReport, Row } from "@/lib/clean";
import type { DataMutationAction } from "@/lib/data-mutator";

interface DataChatbotProps {
  datasetName: string;
  rows: Row[];
  report: CleanReport | null;
  onApplyMutation: (action: DataMutationAction) => void;
  onUndoMutation?: () => void;
  canUndo?: boolean;
}

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mutation?: DataMutationAction;
  applied?: boolean;
  timestamp: string;
};

const SUGGESTIONS = [
  "📊 Summarize key trends & metrics",
  "🚨 Find anomalies in the dataset",
  "🧹 Filter out negative amounts",
  "🔤 Capitalize state names",
  "🔍 Who are the top 3 records by value?",
];

export function DataChatbot({
  datasetName,
  rows,
  report,
  onApplyMutation,
  onUndoMutation,
  canUndo,
}: DataChatbotProps) {
  const chatFn = useServerFn(chatWithData);
  const [isOpen, setIsOpen] = useState(false);
  const [inputQuery, setInputQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Hello! I am your **AI Data Co-Pilot**. I can answer analytical queries about **${datasetName}**, calculate metrics, or **directly modify the data** (filter, replace, format, compute) based on your natural language instructions.`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSend = async (queryText?: string) => {
    const text = (queryText || inputQuery).trim();
    if (!text || loading) return;

    setInputQuery("");
    const userMsgId = `user-${Date.now()}`;
    const newMsg: Message = {
      id: userMsgId,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, newMsg]);
    setLoading(true);

    try {
      const columnSummaries = (report?.columns ?? []).map((c) => ({
        name: c.name,
        type: c.type,
        missing: c.missingAfter,
        unique: c.unique,
        min: c.min,
        max: c.max,
        mean: c.mean,
      }));

      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await chatFn({
        data: {
          query: text,
          datasetName,
          columns: columnSummaries,
          sampleRows: rows.slice(0, 15),
          history,
        },
      });

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: res.answer,
        mutation: res.mutation,
        applied: false,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If a mutation was proposed, automatically apply it to give instant magic
      if (res.mutation) {
        onApplyMutation(res.mutation);
        assistantMsg.applied = true;
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `⚠️ Failed to query AI: ${err instanceof Error ? err.message : "Network error"}. Check that GEMINI_API_KEY is configured.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-xs font-semibold shadow-2xl transition-all duration-300 ${
          isOpen
            ? "bg-secondary text-foreground hover:bg-secondary/80"
            : "bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 text-white hover:opacity-95 hover:scale-105"
        }`}
      >
        <Sparkles className="h-4 w-4" />
        <span>{isOpen ? "Close Co-Pilot" : "Ask AI Co-Pilot"}</span>
        {canUndo ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">
            1
          </span>
        ) : null}
      </button>

      {/* Slide-Over Drawer Panel */}
      {isOpen ? (
        <div className="fixed bottom-20 right-6 z-50 flex h-[580px] w-full max-w-[420px] flex-col rounded-2xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-5 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white shadow-sm">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-foreground">AI Data Co-Pilot</h3>
                <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Grounded in Cleaned Data
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {canUndo && onUndoMutation ? (
                <button
                  type="button"
                  onClick={onUndoMutation}
                  className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-secondary/80 transition-colors"
                  title="Undo last AI modification"
                >
                  <Undo2 className="h-3 w-3" />
                  <span>Undo</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white"
                  }`}
                >
                  {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </div>

                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-none"
                      : "bg-secondary/80 border border-border/60 text-foreground rounded-tl-none"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>

                  {/* Executed Data Mutation Action Card */}
                  {m.mutation ? (
                    <div className="mt-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-800 dark:text-emerald-300">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold flex items-center gap-1">
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                          Live Transformation Executed
                        </span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] uppercase">
                          {m.mutation.type}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[10px]">{m.mutation.description}</p>
                    </div>
                  ) : null}

                  <span className="mt-1 block text-[9px] opacity-60 text-right font-mono">{m.timestamp}</span>
                </div>
              </div>
            ))}

            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500" />
                <span>Analyzing data and calculating response…</span>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestion Chips */}
          <div className="border-t border-border/40 px-3 py-2 bg-secondary/20">
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
              {SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSend(s)}
                  className="whitespace-nowrap rounded-full border border-border/60 bg-secondary/80 px-2.5 py-1 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all shrink-0"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Query Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="border-t border-border/60 p-3 bg-card"
          >
            <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40 transition-all">
              <input
                type="text"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder="Ask query or modify data (e.g. 'remove negative amounts')..."
                className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                type="submit"
                disabled={!inputQuery.trim() || loading}
                className="rounded-lg bg-primary p-1.5 text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
