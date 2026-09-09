import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Activity, BarChart2, CheckCircle2, Flame, Layers, PieChart as PieIcon, Sparkles, TrendingUp, Zap } from "lucide-react";
import type { CleanReport, Row } from "@/lib/clean";
import { calculateModifiedZScoreOutliers } from "@/lib/anomaly";

interface LiveVisualizerProps {
  rows: Row[];
  report: CleanReport | null;
  quarantineCount: number;
}

const PALETTE = [
  "#6366f1", // Indigo
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#8b5cf6", // Purple
  "#3b82f6", // Sky Blue
];

const customTooltip = {
  backgroundColor: "rgba(15, 23, 42, 0.94)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "12px",
  color: "#f8fafc",
  boxShadow: "0 12px 30px -4px rgba(0, 0, 0, 0.4)",
  fontSize: "12px",
  padding: "8px 12px",
  backdropFilter: "blur(12px)",
};

export function LiveVisualizer({ rows, report, quarantineCount }: LiveVisualizerProps) {
  const numericColumns = useMemo(
    () => (report?.columns ?? []).filter((c) => c.type === "number").map((c) => c.name),
    [report],
  );

  const categoricalColumns = useMemo(
    () =>
      (report?.columns ?? [])
        .filter((c) => c.type === "text" || c.type === "email" || c.type === "boolean")
        .map((c) => c.name),
    [report],
  );

  const [selectedNumCol, setSelectedNumCol] = useState<string>(() => numericColumns[0] || "");
  const [selectedCatCol, setSelectedCatCol] = useState<string>(() => categoricalColumns[0] || "");
  const [chartMode, setChartMode] = useState<"trend" | "distribution" | "outliers">("trend");

  // Keep selected columns up to date if report changes
  useMemo(() => {
    if (!numericColumns.includes(selectedNumCol) && numericColumns.length > 0) {
      setSelectedNumCol(numericColumns[0]!);
    }
    if (!categoricalColumns.includes(selectedCatCol) && categoricalColumns.length > 0) {
      setSelectedCatCol(categoricalColumns[0]!);
    }
  }, [numericColumns, categoricalColumns, selectedNumCol, selectedCatCol]);

  // Numeric trend / timeline data
  const trendData = useMemo(() => {
    if (!selectedNumCol || rows.length === 0) return [];
    return rows
      .slice(0, 40)
      .map((r, i) => ({
        index: i + 1,
        value: Number(r[selectedNumCol]) || 0,
      }))
      .filter((d) => !isNaN(d.value));
  }, [rows, selectedNumCol]);

  // Outlier scatter clusters (MAD Z-Scores)
  const outlierScatterData = useMemo(() => {
    if (!selectedNumCol || rows.length === 0) return [];
    const values = rows.map((r) => Number(r[selectedNumCol])).filter((n) => !isNaN(n));
    const analysis = calculateModifiedZScoreOutliers(values, 3.5);

    return analysis.slice(0, 50).map((a, i) => ({
      index: i + 1,
      value: a.value,
      zScore: Number(a.zScore.toFixed(2)),
      isOutlier: a.isOutlier,
    }));
  }, [rows, selectedNumCol]);

  // Categorical frequency breakdown
  const categoryData = useMemo(() => {
    if (!selectedCatCol || rows.length === 0) return [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      const val = String(r[selectedCatCol] ?? "Missing").trim() || "Empty";
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, count]) => ({ name, count }));
  }, [rows, selectedCatCol]);

  // Live telemetry summary
  const completenessScore = useMemo(() => {
    if (!report || report.columns.length === 0) return 100;
    const totalCells = report.rowsAfter * report.columnsAfter;
    const missingCells = report.columns.reduce((a, c) => a + c.missingAfter, 0);
    return totalCells > 0 ? Math.max(0, Math.round(((totalCells - missingCells) / totalCells) * 100)) : 100;
  }, [report]);

  return (
    <div className="space-y-5">
      {/* Top Glassmorphic Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-card/80 to-card p-4 backdrop-blur-md shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-emerald-500">
            <span>Completeness</span>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-bold font-display text-foreground tracking-tight">
            {completenessScore}%
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${completenessScore}%` }} />
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-cyan-500/10 via-card/80 to-card p-4 backdrop-blur-md shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-cyan-500">
            <span>Active Columns</span>
            <Layers className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-bold font-display text-foreground tracking-tight">
            {report?.columnsAfter ?? rows.length ? Object.keys(rows[0] ?? {}).length : 0}
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {numericColumns.length} num • {categoricalColumns.length} cat
          </span>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-amber-500/10 via-card/80 to-card p-4 backdrop-blur-md shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-amber-500">
            <span>Quarantine Log</span>
            <Activity className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-bold font-display text-foreground tracking-tight">
            {quarantineCount}
          </div>
          <span className="text-[11px] text-muted-foreground">Zero loss audit trail</span>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-indigo-500/10 via-card/80 to-card p-4 backdrop-blur-md shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-indigo-500">
            <span>MAD Outliers</span>
            <Flame className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-bold font-display text-foreground tracking-tight">
            {report?.outliers ?? 0}
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">Tukey & MAD fences</span>
        </div>
      </div>

      {/* Main Dynamic Chart Studio */}
      <div className="rounded-2xl border border-border/80 bg-card/90 p-5 shadow-lg backdrop-blur-xl">
        {/* Studio Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Dynamic Live Chart Studio
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Numeric Column Picker */}
            {numericColumns.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-[11px]">Metric:</span>
                <select
                  value={selectedNumCol}
                  onChange={(e) => setSelectedNumCol(e.target.value)}
                  className="rounded-lg border border-border bg-secondary/80 px-2.5 py-1 text-xs font-medium font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {numericColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* Mode Switcher */}
            <div className="flex rounded-lg border border-border bg-secondary/60 p-0.5">
              <button
                type="button"
                onClick={() => setChartMode("trend")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  chartMode === "trend" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Gradient Trend
              </button>
              <button
                type="button"
                onClick={() => setChartMode("distribution")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  chartMode === "distribution" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Distribution
              </button>
              <button
                type="button"
                onClick={() => setChartMode("outliers")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  chartMode === "outliers" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                MAD Anomaly Scatter
              </button>
            </div>
          </div>
        </div>

        {/* Chart Canvas */}
        <div className="mt-4 h-72 w-full">
          {chartMode === "trend" && trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
                <XAxis dataKey="index" stroke="#94a3b8" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} tickLine={false} />
                <Tooltip contentStyle={customTooltip} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#trendGradient)"
                  activeDot={{ r: 6, fill: "#6366f1", stroke: "#ffffff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : null}

          {chartMode === "distribution" && trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
                <XAxis dataKey="index" stroke="#94a3b8" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} tickLine={false} />
                <Tooltip contentStyle={customTooltip} />
                <Bar dataKey="value" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : null}

          {chartMode === "outliers" && outlierScatterData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                <XAxis dataKey="index" stroke="#94a3b8" tick={{ fontSize: 10 }} name="Row Index" />
                <YAxis dataKey="value" stroke="#94a3b8" tick={{ fontSize: 10 }} name="Value" />
                <ZAxis dataKey="zScore" range={[60, 240]} name="MAD Z-Score" />
                <Tooltip contentStyle={customTooltip} />
                <Scatter name="Points" data={outlierScatterData}>
                  {outlierScatterData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.isOutlier ? "#ef4444" : "#10b981"}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : null}

          {trendData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No numeric columns found in this dataset. Select a categorical view below.
            </div>
          ) : null}
        </div>
      </div>

      {/* Categorical Breakdown & Donut */}
      {categoricalColumns.length > 0 && categoryData.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Donut Distribution */}
          <div className="rounded-2xl border border-border/80 bg-card/90 p-5 shadow-md backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <PieIcon className="h-4 w-4 text-emerald-500" />
                <h4 className="text-xs font-semibold text-foreground">Category Proportions</h4>
              </div>
              <select
                value={selectedCatCol}
                onChange={(e) => setSelectedCatCol(e.target.value)}
                className="rounded-lg border border-border bg-secondary/80 px-2 py-1 text-[11px] font-mono"
              >
                {categoricalColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={3}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cat-${entry.name}`} fill={PALETTE[index % PALETTE.length]} stroke="rgba(0,0,0,0.2)" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={customTooltip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ranking Bars */}
          <div className="rounded-2xl border border-border/80 bg-card/90 p-5 shadow-md backdrop-blur-xl">
            <div className="flex items-center gap-2 border-b border-border/60 pb-3">
              <BarChart2 className="h-4 w-4 text-cyan-500" />
              <h4 className="text-xs font-semibold text-foreground">Top Frequency Rankings</h4>
            </div>

            <div className="mt-3 space-y-2.5 text-xs">
              {categoryData.map((cat, i) => {
                const maxCount = categoryData[0]?.count || 1;
                const pct = Math.round((cat.count / maxCount) * 100);
                return (
                  <div key={cat.name} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-medium text-foreground truncate max-w-[200px]">{cat.name}</span>
                      <span className="font-mono text-muted-foreground">{cat.count.toLocaleString()}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: PALETTE[i % PALETTE.length],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
