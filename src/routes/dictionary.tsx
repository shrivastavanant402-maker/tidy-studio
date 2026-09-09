import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  emptyEntry,
  loadDictionary,
  saveDictionary,
  type DictColumn,
  type DictType,
} from "@/lib/dictionary";

export const Route = createFileRoute("/dictionary")({
  head: () => ({
    meta: [
      { title: "Data dictionary — Tell Tidy what your columns mean" },
      {
        name: "description",
        content:
          "Define column names, types and acceptable values once, and Tidy cleans every upload to your rules instead of guessing.",
      },
      { property: "og:title", content: "Data dictionary — your rules, not guesswork" },
      {
        property: "og:description",
        content:
          "Set the name, kind of data and allowed values for each column so every file is cleaned the same way.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DictionaryPage,
});

const TYPES: { value: DictType; label: string }[] = [
  { value: "auto", label: "Work it out" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / no" },
  { value: "email", label: "Email" },
];

const field =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/40";

function DictionaryPage() {
  const [entries, setEntries] = useState<DictColumn[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = loadDictionary();
    setEntries(stored.length ? stored : [emptyEntry()]);
  }, []);

  const update = (i: number, patch: Partial<DictColumn>) => {
    setSaved(false);
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  };

  const save = () => {
    const cleaned = entries.filter((e) => e.column.trim());
    saveDictionary(cleaned);
    setEntries(cleaned.length ? cleaned : [emptyEntry()]);
    setSaved(true);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1100px] px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Tidy</p>
          <h1 className="mt-2 text-3xl">Data dictionary</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Describe your columns once. Every upload is then cleaned to these rules instead of
            being guessed at.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Workspace
          </Link>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Save className="h-4 w-4" />
            Save rules
          </button>
        </div>
      </header>

      {saved ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Saved — your next upload in the workspace will follow these rules.
        </p>
      ) : null}

      <section className="mt-8 space-y-4">
        {entries.map((e, i) => (
          <div key={i} className="panel grid gap-4 p-5 md:grid-cols-[1fr_1fr_170px_auto]">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Column in your file
              </span>
              <input
                className={`${field} mt-1`}
                value={e.column}
                placeholder="e.g. Order Status"
                onChange={(ev) => update(i, { column: ev.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Rename to (optional)
              </span>
              <input
                className={`${field} mt-1`}
                value={e.rename ?? ""}
                placeholder="e.g. Status"
                onChange={(ev) => update(i, { rename: ev.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Kind of data
              </span>
              <select
                className={`${field} mt-1`}
                value={e.type}
                onChange={(ev) => update(i, { type: ev.target.value as DictType })}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Remove this column rule"
              onClick={() => {
                setSaved(false);
                setEntries((prev) => prev.filter((_, idx) => idx !== i));
              }}
              className="self-end rounded-md border border-border p-2.5 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <label className="block md:col-span-4">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Acceptable values (optional, separated by commas)
              </span>
              <input
                className={`${field} mt-1`}
                value={(e.allowed ?? []).join(", ")}
                placeholder="e.g. Shipped, Pending, Cancelled"
                onChange={(ev) =>
                  update(i, { allowed: ev.target.value.split(",").map((v) => v.trim()) })
                }
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Close matches are corrected to the value you list; anything else is left blank.
              </span>
            </label>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setEntries((prev) => [...prev, emptyEntry()])}
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-2.5 text-sm transition-colors hover:bg-secondary"
        >
          <Plus className="h-4 w-4" />
          Add a column
        </button>
      </section>

      <footer className="mt-14 border-t border-border pt-6 text-xs text-muted-foreground">
        Your rules stay on this device.
      </footer>
    </main>
  );
}
