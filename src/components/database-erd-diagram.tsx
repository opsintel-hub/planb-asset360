import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KeyRound, Link2, Table as TableIcon, Sigma } from "lucide-react";
import type { SchemaTableInfo } from "@/lib/data.functions";
import { cn } from "@/lib/utils";

// Materialized view / view → tables ที่ใช้คำนวณ (hardcoded เพราะ Postgres
// ไม่มี FK จริงกับ MV/View; parse จาก refresh_pm_views definition)
const COMPUTED_FROM: Record<string, string[]> = {
  mv_pm_history: ["mssql_asset_history", "assets"],
  mv_pm_claim_pairs: ["mv_pm_history"],
};

type Group = "source" | "view" | "mapping" | "auth";

function detectGroup(t: SchemaTableInfo): Group {
  const n = t.name;
  if (n === "profiles" || n === "user_roles") return "auth";
  if (t.kind === "v" || t.kind === "m" || n.startsWith("mv_")) return "view";
  if (/_(mapping|mappings|settings|connections)$/.test(n)) return "mapping";
  return "source";
}

const GROUP_STYLE: Record<Group, { header: string; ring: string; label: string; order: number }> = {
  source: { header: "bg-sky-500", ring: "ring-sky-500/40", label: "Source Table", order: 0 },
  mapping: { header: "bg-violet-500", ring: "ring-violet-500/40", label: "Config / Mapping", order: 1 },
  view: { header: "bg-emerald-500", ring: "ring-emerald-500/40", label: "View / Materialized", order: 2 },
  auth: { header: "bg-slate-500", ring: "ring-slate-500/40", label: "Auth", order: 3 },
};

type TableNodeData = {
  table: SchemaTableInfo;
  group: Group;
  fkColumns: Set<string>;
};

function TableNode({ data }: NodeProps<Node<TableNodeData>>) {
  const { table, group, fkColumns } = data;
  const style = GROUP_STYLE[group];
  const pkSet = new Set(table.primary_key);

  return (
    <div
      className={cn(
        "rounded-lg bg-card border shadow-lg ring-1 w-[260px] overflow-hidden",
        style.ring,
      )}
    >
      {/* handles (invisible) ทั้ง 4 ทิศ ให้เส้นเชื่อมได้ */}
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Top} id="t" className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Bottom} id="b" className="!bg-transparent !border-0" />

      <div className={cn("px-3 py-2 flex items-center gap-2 text-white", style.header)}>
        <TableIcon className="size-3.5 shrink-0" />
        <span className="font-mono font-semibold text-xs truncate">{table.name}</span>
        <span className="ml-auto text-[10px] opacity-80">
          {table.kind === "m" ? "MV" : table.kind === "v" ? "VIEW" : "TBL"}
        </span>
      </div>

      <div className="divide-y divide-border/60 max-h-[280px] overflow-y-auto text-[11px]">
        {table.columns.map((c) => {
          const isPk = pkSet.has(c.name);
          const isFk = fkColumns.has(c.name);
          return (
            <div key={c.name} className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-accent/40">
              {isPk ? (
                <KeyRound className="size-3 text-amber-500 shrink-0" />
              ) : isFk ? (
                <Link2 className="size-3 text-primary shrink-0" />
              ) : (
                <span className="size-1.5 rounded-full bg-muted-foreground/40 shrink-0 ml-[6px] mr-[6px]" />
              )}
              <span
                className={cn(
                  "font-mono truncate",
                  isPk && "font-semibold text-amber-700 dark:text-amber-300",
                  isFk && !isPk && "text-primary",
                )}
              >
                {c.name}
              </span>
              <span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground truncate max-w-[80px]">
                {shortType(c.type)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortType(t: string): string {
  return t
    .replace(/timestamp with time zone/i, "timestamptz")
    .replace(/timestamp without time zone/i, "timestamp")
    .replace(/character varying/i, "varchar")
    .replace(/double precision/i, "float8")
    .replace(/\(.*\)/, "");
}

const NODE_TYPES = { table: TableNode };

const NODE_W = 260;
const COL_GAP = 120;
const ROW_H = 360;
const ROW_GAP = 60;

export function DatabaseErdDiagram({ tables }: { tables: SchemaTableInfo[] }) {
  const { nodes, edges } = useMemo(() => {
    // จัดกลุ่ม → คอลัมน์
    const grouped = new Map<Group, SchemaTableInfo[]>();
    for (const t of tables) {
      const g = detectGroup(t);
      const arr = grouped.get(g) ?? [];
      arr.push(t);
      grouped.set(g, arr);
    }

    // เรียงคอลัมน์ตาม order
    const columns = (Object.keys(GROUP_STYLE) as Group[])
      .sort((a, b) => GROUP_STYLE[a].order - GROUP_STYLE[b].order)
      .filter((g) => (grouped.get(g)?.length ?? 0) > 0);

    // สร้าง set FK columns ต่อ table
    const fkColsByTable = new Map<string, Set<string>>();
    for (const t of tables) {
      fkColsByTable.set(t.name, new Set(t.foreign_keys.map((fk) => fk.column)));
    }

    const nodes: Node<TableNodeData>[] = [];
    columns.forEach((g, colIdx) => {
      const list = (grouped.get(g) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((t, rowIdx) => {
        nodes.push({
          id: t.name,
          type: "table",
          position: {
            x: colIdx * (NODE_W + COL_GAP),
            y: rowIdx * (ROW_H + ROW_GAP),
          },
          data: {
            table: t,
            group: g,
            fkColumns: fkColsByTable.get(t.name) ?? new Set(),
          },
        });
      });
    });

    const tableNames = new Set(tables.map((t) => t.name));
    const edges: Edge[] = [];

    // เส้น FK จริง (solid)
    for (const t of tables) {
      for (const fk of t.foreign_keys) {
        if (!tableNames.has(fk.references_table)) continue;
        edges.push({
          id: `fk-${t.name}-${fk.column}-${fk.references_table}`,
          source: t.name,
          target: fk.references_table,
          label: "n → 1",
          type: "smoothstep",
          animated: false,
          style: { stroke: "hsl(var(--primary))", strokeWidth: 1.5 },
          labelStyle: { fontSize: 10, fontFamily: "monospace" },
          labelBgStyle: { fill: "hsl(var(--background))" },
        });
      }
    }

    // เส้น computed-from (dashed) สำหรับ MV/View
    for (const [viewName, sources] of Object.entries(COMPUTED_FROM)) {
      if (!tableNames.has(viewName)) continue;
      for (const src of sources) {
        if (!tableNames.has(src)) continue;
        edges.push({
          id: `cf-${viewName}-${src}`,
          source: src,
          target: viewName,
          label: "computed",
          type: "smoothstep",
          animated: true,
          style: { stroke: "#10b981", strokeWidth: 1.5, strokeDasharray: "6 4" },
          labelStyle: { fontSize: 10, fontFamily: "monospace", fill: "#10b981" },
          labelBgStyle: { fill: "hsl(var(--background))" },
        });
      }
    }

    return { nodes, edges };
  }, [tables]);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.keys(GROUP_STYLE) as Group[]).map((g) => (
          <div key={g} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded", GROUP_STYLE[g].header)} />
            <span className="text-muted-foreground">{GROUP_STYLE[g].label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <KeyRound className="size-3 text-amber-500" />
          <span className="text-muted-foreground">Primary Key</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Link2 className="size-3 text-primary" />
          <span className="text-muted-foreground">Foreign Key</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sigma className="size-3 text-emerald-500" />
          <span className="text-muted-foreground">Computed From (เส้นประ)</span>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20" style={{ height: 700 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const g = (n.data as TableNodeData | undefined)?.group ?? "source";
              const map: Record<Group, string> = {
                source: "#0ea5e9",
                view: "#10b981",
                mapping: "#8b5cf6",
                auth: "#64748b",
              };
              return map[g];
            }}
          />
        </ReactFlow>
      </div>

      <p className="text-[11px] text-muted-foreground">
        แผนผังนี้ดึงข้อมูล schema จากฐานข้อมูลแบบสดผ่าน <code className="font-mono">pg_catalog</code> —
        ตารางใหม่ / ความสัมพันธ์ใหม่จะขึ้นในแผนผังเองอัตโนมัติเมื่อ refresh
      </p>
    </div>
  );
}
