import { useMemo, useState } from "react";
import { Copy, Check, FileCode } from "lucide-react";
import type { SchemaTableInfo } from "@/lib/data.functions";
import { cn } from "@/lib/utils";

function quoteIdent(n: string) {
  return /^[a-z_][a-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`;
}

function buildTableDDL(t: SchemaTableInfo): string {
  const kindLabel =
    t.kind === "m" ? "MATERIALIZED VIEW" : t.kind === "v" ? "VIEW" : "TABLE";
  const header = `-- ${kindLabel}: public.${t.name}  (${t.column_count} cols, ~${Number(
    t.est_rows,
  ).toLocaleString()} rows)`;

  if (t.kind === "v" || t.kind === "m") {
    // View definitions ไม่มีใน schema info — แสดง column list เป็น comment
    const cols = t.columns
      .map((c) => `--   ${quoteIdent(c.name)}  ${c.type}${c.nullable ? "" : "  NOT NULL"}`)
      .join("\n");
    return `${header}\n-- (definition ไม่แสดง — ดูจาก migration / refresh function)\n${cols}`;
  }

  const colLines = t.columns.map((c) => {
    const nn = c.nullable ? "" : " NOT NULL";
    return `  ${quoteIdent(c.name)} ${c.type}${nn}`;
  });

  const constraints: string[] = [];
  if (t.primary_key.length > 0) {
    constraints.push(
      `  CONSTRAINT ${t.name}_pkey PRIMARY KEY (${t.primary_key.map(quoteIdent).join(", ")})`,
    );
  }

  const body = [...colLines, ...constraints].join(",\n");
  return `${header}\nCREATE TABLE public.${quoteIdent(t.name)} (\n${body}\n);`;
}

function buildForeignKeysDDL(tables: SchemaTableInfo[]): string {
  const lines: string[] = [];
  for (const t of tables) {
    for (const fk of t.foreign_keys) {
      const cname = `${t.name}_${fk.column}_fkey`;
      lines.push(
        `ALTER TABLE public.${quoteIdent(t.name)}\n  ADD CONSTRAINT ${quoteIdent(cname)} FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES public.${quoteIdent(fk.references_table)}(${quoteIdent(fk.references_column)});`,
      );
    }
  }
  return lines.length > 0
    ? `-- ========== FOREIGN KEYS ==========\n${lines.join("\n\n")}`
    : "-- (no foreign keys)";
}

export function DatabaseSqlDdl({ tables }: { tables: SchemaTableInfo[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.name.localeCompare(b.name)),
    [tables],
  );

  const allSql = useMemo(() => {
    const tableBlocks = sorted.map(buildTableDDL).join("\n\n");
    const fkBlock = buildForeignKeysDDL(sorted);
    return `-- ========== TABLES / VIEWS ==========\n\n${tableBlocks}\n\n${fkBlock}\n`;
  }, [sorted]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // noop
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileCode className="size-4" />
          SQL DDL สังเคราะห์จาก schema สด — ก๊อปไปตรวจสอบ / diff ได้
        </div>
        <button
          type="button"
          onClick={() => copy("all", allSql)}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          {copied === "all" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied === "all" ? "ก๊อปแล้ว" : "ก๊อปทั้งหมด"}
        </button>
      </div>

      <div className="space-y-3">
        {sorted.map((t) => {
          const ddl = buildTableDDL(t);
          const key = `t-${t.name}`;
          return (
            <div key={t.name} className="rounded-lg border bg-background overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40">
                <span className="font-mono text-xs font-semibold">{t.name}</span>
                <button
                  type="button"
                  onClick={() => copy(key, ddl)}
                  className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-[11px] hover:bg-accent"
                >
                  {copied === key ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copied === key ? "ก๊อปแล้ว" : "ก๊อป"}
                </button>
              </div>
              <pre className={cn(
                "text-[11px] font-mono leading-relaxed p-3 overflow-x-auto",
                "bg-muted/10 whitespace-pre",
              )}>
{ddl}
              </pre>
            </div>
          );
        })}

        {/* FK block */}
        <div className="rounded-lg border bg-background overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40">
            <span className="font-mono text-xs font-semibold">FOREIGN KEYS ทั้งหมด</span>
            <button
              type="button"
              onClick={() => copy("fk", buildForeignKeysDDL(sorted))}
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-[11px] hover:bg-accent"
            >
              {copied === "fk" ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
              {copied === "fk" ? "ก๊อปแล้ว" : "ก๊อป"}
            </button>
          </div>
          <pre className="text-[11px] font-mono leading-relaxed p-3 overflow-x-auto bg-muted/10 whitespace-pre">
{buildForeignKeysDDL(sorted)}
          </pre>
        </div>
      </div>
    </div>
  );
}
