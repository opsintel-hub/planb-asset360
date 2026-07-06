import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, KeyRound, Link2, RefreshCw, AlertTriangle, CheckCircle2, Table as TableIcon } from "lucide-react";
import { Badge } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getDatabaseSchema, type SchemaTableInfo } from "@/lib/data.functions";

// Mapping ตารางในระบบ → เมนู/หน้าที่ใช้งานจริง
// อัปเดตทุกครั้งที่มีเมนูใหม่หรือ query ตารางเพิ่ม
const TABLE_USAGE: Record<string, { menus: string[]; purpose: string }> = {
  assets: {
    menus: ["ค้นหาป้าย (/search)", "Monitoring", "PM Insights", "Claim Insights", "RCA", "Breakdown"],
    purpose: "ข้อมูลหลักของป้ายทั้งหมด (Sync จาก MSSQL Asset)",
  },
  asset_pm_schedules: {
    menus: ["PM Insights"],
    purpose: "ตารางแผน PM รายป้าย",
  },
  mssql_asset_history: {
    menus: ["ค้นหาป้าย (History)", "Monitoring", "PM Insights", "RCA", "Breakdown"],
    purpose: "ประวัติ PM / Claim / Monitoring ทุก event (แหล่งข้อมูลหลัก)",
  },
  claims: {
    menus: ["Claim Insights"],
    purpose: "รายการ Claim จากระบบภายใน",
  },
  claim_tickets: {
    menus: ["Claim Insights", "Monitoring"],
    purpose: "ตั๋ว Claim Aging จาก API magicticket",
  },
  monitoring_status: {
    menus: ["Monitoring"],
    purpose: "สถานะ Monitoring ปัจจุบันของแต่ละป้าย",
  },
  mv_pm_history: {
    menus: ["PM Insights"],
    purpose: "Materialized view รวม PM+Claim history (refresh อัตโนมัติ)",
  },
  mv_pm_claim_pairs: {
    menus: ["PM Insights"],
    purpose: "Materialized view คู่ PM→Claim สำหรับดูประสิทธิภาพ PM",
  },
  diagram_mappings: {
    menus: ["RCA", "ตั้งค่าระบบ → Diagram Mappings"],
    purpose: "แมปหมวดปัญหา → กลุ่ม Root Cause",
  },
  informed_mapping: {
    menus: ["PM Insights", "ตั้งค่าระบบ → Informed Mapping"],
    purpose: "แมปข้อมูลอ้างอิงสำหรับ PM Insights",
  },
  airtable_connections: {
    menus: ["ตั้งค่าระบบ → Airtable Connections"],
    purpose: "การเชื่อมต่อ Airtable 8 ช่อง",
  },
  app_settings: {
    menus: ["ตั้งค่าระบบ (ทุกส่วน)"],
    purpose: "คีย์-ค่าการตั้งค่าระบบทั้งหมด (endpoint, toggle, schema snapshot)",
  },
  sync_logs: {
    menus: ["ตั้งค่าระบบ → Sync Logs"],
    purpose: "ประวัติการ Sync จากแหล่งข้อมูลภายนอก",
  },
  user_roles: {
    menus: ["จัดการสิทธิ์ (/permissions)"],
    purpose: "บทบาทของผู้ใช้ (admin / viewer ฯลฯ)",
  },
  profiles: {
    menus: ["จัดการสิทธิ์", "ระบบ Auth"],
    purpose: "โปรไฟล์ผู้ใช้ (ผูกกับ auth.users)",
  },
};

export function DatabaseSchemaSection() {
  const fn = useServerFn(getDatabaseSchema);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["db-schema"],
    queryFn: () => fn({}),
    staleTime: 30_000,
  });

  const tables = data?.tables ?? [];

  // นับ inbound references (ใครอ้างถึงตารางนี้บ้าง)
  const inboundByTable = useMemo(() => {
    const map = new Map<string, Array<{ from_table: string; from_column: string; to_column: string }>>();
    for (const t of tables) {
      for (const fk of t.foreign_keys) {
        const arr = map.get(fk.references_table) ?? [];
        arr.push({ from_table: t.name, from_column: fk.column, to_column: fk.references_column });
        map.set(fk.references_table, arr);
      }
    }
    return map;
  }, [tables]);

  const unusedTables = tables.filter((t) => !TABLE_USAGE[t.name]);
  const usedTables = tables.filter((t) => TABLE_USAGE[t.name]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3 mb-4 flex-wrap">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Database className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold">Database Schema</h3>
            <p className="text-xs text-muted-foreground">
              รายการตารางทั้งหมดใน Lovable Cloud — Primary Key, ความสัมพันธ์ (Foreign Keys) และเมนูที่ใช้งาน
              ข้อมูลอัปเดตอัตโนมัติทุกครั้งที่มีการเปลี่ยน schema
            </p>
            {data?.fetchedAt && (
              <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                อัปเดตล่าสุด: {new Date(data.fetchedAt).toLocaleString("th-TH")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4" /> {(error as Error).message}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatCard label="ตารางทั้งหมด" value={tables.length} tone="info" />
              <StatCard label="มีการใช้งาน" value={usedTables.length} tone="success" />
              <StatCard label="ยังไม่ถูกใช้งาน" value={unusedTables.length} tone={unusedTables.length ? "warning" : "success"} />
              <StatCard
                label="ความสัมพันธ์ทั้งหมด"
                value={tables.reduce((s, t) => s + t.foreign_keys.length, 0)}
                tone="info"
              />
            </div>

            {unusedTables.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">
                  <AlertTriangle className="size-4" /> ตารางที่ยังไม่ถูกใช้งานในเมนูใดๆ
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unusedTables.map((t) => (
                    <span key={t.name} className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30">
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {tables.map((t) => (
                <TableCard
                  key={t.name}
                  table={t}
                  usage={TABLE_USAGE[t.name]}
                  inbound={inboundByTable.get(t.name) ?? []}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "info" | "success" | "warning" }) {
  const toneCls =
    tone === "success"
      ? "border-success/40 bg-success/5 text-success"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-primary/30 bg-primary/5 text-primary";
  return (
    <div className={cn("rounded-lg border p-3", toneCls)}>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}

function TableCard({
  table,
  usage,
  inbound,
}: {
  table: SchemaTableInfo;
  usage?: { menus: string[]; purpose: string };
  inbound: Array<{ from_table: string; from_column: string; to_column: string }>;
}) {
  const isView = table.kind === "v" || table.kind === "m";
  const isUsed = !!usage;

  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-4 space-y-3",
        !isUsed && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <TableIcon className="size-4 text-primary" />
            <span className="font-mono font-semibold text-sm">{table.name}</span>
            {isView && <Badge tone="info">{table.kind === "m" ? "Materialized View" : "View"}</Badge>}
            {isUsed ? (
              <Badge tone="success">
                <CheckCircle2 className="inline size-3 mr-0.5" /> ใช้งานอยู่
              </Badge>
            ) : (
              <Badge tone="warning">
                <AlertTriangle className="inline size-3 mr-0.5" /> ยังไม่ถูกใช้งาน
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              {table.column_count} คอลัมน์ • ~{Number(table.est_rows).toLocaleString()} แถว
            </span>
          </div>
          {usage && <p className="text-xs text-muted-foreground mt-1">{usage.purpose}</p>}
        </div>
      </div>

      {/* Primary Key */}
      <div className="flex items-start gap-2 text-xs">
        <KeyRound className="size-3.5 text-amber-500 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <span className="font-medium text-muted-foreground">Primary Key: </span>
          {table.primary_key.length > 0 ? (
            table.primary_key.map((k) => (
              <span
                key={k}
                className="font-mono bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/30 px-1.5 py-0.5 rounded mr-1"
              >
                {k}
              </span>
            ))
          ) : (
            <span className="italic text-muted-foreground">ไม่มี</span>
          )}
        </div>
      </div>

      {/* Foreign Keys (outbound) */}
      {table.foreign_keys.length > 0 && (
        <div className="flex items-start gap-2 text-xs">
          <Link2 className="size-3.5 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <span className="font-medium text-muted-foreground">อ้างถึงตาราง: </span>
            {table.foreign_keys.map((fk, i) => (
              <div key={i} className="font-mono text-[11px]">
                <span className="text-foreground">{fk.column}</span>
                <span className="text-muted-foreground"> → </span>
                <span className="text-primary">
                  {fk.references_table}.{fk.references_column}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inbound references */}
      {inbound.length > 0 && (
        <div className="flex items-start gap-2 text-xs">
          <Link2 className="size-3.5 text-success mt-0.5 shrink-0 rotate-180" />
          <div className="min-w-0 space-y-0.5">
            <span className="font-medium text-muted-foreground">ถูกอ้างจาก: </span>
            {inbound.map((fk, i) => (
              <div key={i} className="font-mono text-[11px]">
                <span className="text-success">
                  {fk.from_table}.{fk.from_column}
                </span>
                <span className="text-muted-foreground"> → {fk.to_column}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menus that use this table */}
      {usage && (
        <div className="text-xs">
          <span className="font-medium text-muted-foreground">ใช้งานในเมนู: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {usage.menus.map((m) => (
              <span
                key={m}
                className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[11px] font-medium"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Columns (compact) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
          ดูคอลัมน์ทั้งหมด ({table.columns.length})
        </summary>
        <div className="mt-2 rounded border overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1">คอลัมน์</th>
                <th className="text-left px-2 py-1">ชนิด</th>
                <th className="text-left px-2 py-1">Nullable</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {table.columns.map((c) => {
                const isPk = table.primary_key.includes(c.name);
                return (
                  <tr key={c.name} className="hover:bg-accent/30">
                    <td className="px-2 py-1 font-mono">
                      {isPk && <KeyRound className="inline size-3 text-amber-500 mr-1" />}
                      {c.name}
                    </td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{c.type}</td>
                    <td className="px-2 py-1 text-muted-foreground">{c.nullable ? "yes" : "no"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
