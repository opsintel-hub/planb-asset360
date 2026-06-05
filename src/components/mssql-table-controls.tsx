import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, RefreshCw, Database, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mssqlListTables, mssqlPreviewTable, updateAppSetting } from "@/lib/admin.functions";

export type TablesEnabled = {
  asset?: boolean;
  pmSchedule?: boolean;
  assetHistory?: boolean;
};

type TableEntry = {
  key: "asset" | "pmSchedule" | "assetHistory";
  label: string;
  table: string;
  hasSync: true;
  desc: string;
};

export function MssqlTableControls({
  assetTable,
  pmTable,
  historyTable,
  enabled,
}: {
  assetTable: string;
  pmTable: string;
  historyTable: string;
  enabled: TablesEnabled;
}) {
  const updFn = useServerFn(updateAppSetting);
  const qc = useQueryClient();
  const [previewTarget, setPreviewTarget] = useState<{ table: string; label: string } | null>(null);

  // Local optimistic state for instant feedback
  const [local, setLocal] = useState<TablesEnabled>(enabled);

  const saveMutation = useMutation({
    mutationFn: (next: TablesEnabled) =>
      updFn({ data: { key: "asset_sync_tables_enabled", value: next } }),
    onMutate: (next) => setLocal(next),
    onSuccess: () => {
      toast.success("บันทึกการเปิด/ปิดตารางแล้ว");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error, _vars, ctx) => {
      toast.error(`บันทึกล้มเหลว: ${e.message}`);
      setLocal(enabled); // rollback
      void ctx;
    },
  });

  const entries: TableEntry[] = [
    {
      key: "asset",
      label: "Asset (รายการป้าย)",
      table: assetTable,
      hasSync: true,
      desc: "ข้อมูลหลักของป้ายทั้งหมด",
    },
    {
      key: "pmSchedule",
      label: "Asset PM Schedule",
      table: pmTable,
      hasSync: true,
      desc: "ตารางวันที่ต้องทำ PM",
    },
    {
      key: "assetHistory",
      label: "AssetHistory",
      table: historyTable,
      hasSync: true,
      desc: "ประวัติ PM / Claim / Monitoring",
    },
  ];

  const toggle = (key: keyof TablesEnabled, value: boolean) => {
    const next = { ...local, [key]: value };
    saveMutation.mutate(next);
  };

  return (
    <>
      <div className="space-y-2 rounded-lg border bg-background/50 p-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-medium">เปิด/ปิดการ Sync ต่อตาราง</div>
            <div className="text-xs text-muted-foreground">
              ตัวที่ปิดอยู่จะถูกข้ามทั้งการกดทดสอบและ Auto-Sync ตาม Schedule
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {entries.map((e) => {
            const on = local[e.key] !== false; // default ON
            return (
              <div
                key={e.key}
                className={cn(
                  "rounded-lg border p-3 space-y-2 transition",
                  on ? "border-success/40 bg-success/5" : "border-border bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{e.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate font-mono">{e.table}</div>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(ev) => toggle(e.key, ev.target.checked)}
                      className="accent-primary size-4"
                    />
                    <span className={on ? "text-success font-medium" : "text-muted-foreground"}>
                      {on ? "เปิด" : "ปิด"}
                    </span>
                  </label>
                </div>
                <div className="text-[11px] text-muted-foreground">{e.desc}</div>
                <button
                  type="button"
                  onClick={() => setPreviewTarget({ table: e.table, label: e.label })}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border bg-card text-xs px-2 py-1.5 hover:bg-accent transition"
                >
                  <Eye className="size-3.5" /> ดูตัวอย่าง 10 แถว
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ExploreAllTablesPanel
        onPreview={(table) => setPreviewTarget({ table, label: table })}
      />

      <PreviewDialog
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
      />
    </>
  );
}

function ExploreAllTablesPanel({ onPreview }: { onPreview: (table: string) => void }) {
  const [opened, setOpened] = useState(false);
  const listFn = useServerFn(mssqlListTables);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["mssql-tables"],
    queryFn: () => listFn({}),
    enabled: opened,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-2 rounded-lg border bg-background/50 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            <Database className="size-4" /> ตารางอื่นในต้นทาง (ดูได้อย่างเดียว)
          </div>
          <div className="text-xs text-muted-foreground">
            ตารางที่ยังไม่มี Sync Function — list ชื่อและ preview ได้ แต่ยังไม่ดึงเข้า Lovable Cloud
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setOpened(true);
              if (opened) refetch();
            }}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            {opened ? "โหลดใหม่" : "แสดงตารางทั้งหมด"}
          </button>
        </div>
      </div>

      {opened && (
        <div className="rounded-md border bg-card overflow-hidden">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7" />
              ))}
            </div>
          ) : !data?.ok ? (
            <div className="p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4" />
              {data?.error ?? "ดึงรายการไม่สำเร็จ"}
            </div>
          ) : data.tables.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">ไม่พบตารางใน database นี้</div>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Schema</th>
                    <th className="text-left px-3 py-2">Table</th>
                    <th className="text-right px-3 py-2">Rows</th>
                    <th className="text-right px-3 py-2">Cols</th>
                    <th className="text-right px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.tables.map((t) => {
                    const ident = t.schema === "dbo" ? t.table : `${t.schema}.${t.table}`;
                    return (
                      <tr key={`${t.schema}.${t.table}`} className="hover:bg-accent/30">
                        <td className="px-3 py-1.5 text-muted-foreground">{t.schema}</td>
                        <td className="px-3 py-1.5 font-mono">{t.table}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number(t.row_count).toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{t.column_count}</td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => onPreview(ident)}
                            className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-accent"
                          >
                            <Eye className="size-3" /> Preview
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewDialog({
  target,
  onClose,
}: {
  target: { table: string; label: string } | null;
  onClose: () => void;
}) {
  const previewFn = useServerFn(mssqlPreviewTable);
  const { data, isLoading } = useQuery({
    queryKey: ["mssql-preview", target?.table],
    queryFn: () => previewFn({ data: { table: target!.table, limit: 10 } }),
    enabled: !!target,
    staleTime: 30_000,
  });

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="size-4" />
            ตัวอย่างข้อมูล: <span className="font-mono">{target?.label}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="size-4 animate-spin" /> กำลังดึงข้อมูล...
          </div>
        ) : !data?.ok ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" /> {data?.error ?? "ดึงข้อมูลไม่สำเร็จ"}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <Badge tone="info">{data.columns.length} columns</Badge>
              <Badge tone={data.rows.length ? "success" : "warning"}>{data.rows.length} rows</Badge>
            </div>

            <div className="rounded-md border overflow-auto max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.name} className="text-left px-3 py-2 whitespace-nowrap">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{c.type}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-accent/30">
                      {data.columns.map((c) => {
                        const v = row[c.name];
                        const s = v == null ? "" : String(v);
                        return (
                          <td key={c.name} className="px-3 py-1.5 font-mono whitespace-nowrap max-w-[260px] truncate" title={s}>
                            {v == null ? <span className="text-muted-foreground italic">NULL</span> : s}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={data.columns.length} className="px-3 py-6 text-center text-muted-foreground">
                        ไม่มีข้อมูลในตารางนี้
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
