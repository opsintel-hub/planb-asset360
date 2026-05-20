import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, RefreshCw, CheckCircle2, Server } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getAppSettings, getSyncLogs, listAirtableSlots } from "@/lib/data.functions";
import { updateAppSetting, updateAirtableSlot, syncClaimsNow, syncAssetsNow } from "@/lib/admin.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "ตั้งค่าระบบ — Asset History 360" },
      { name: "description", content: "ตั้งค่าการเชื่อมต่อฐานข้อมูล Asset, API Claim Aging และ Airtable" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [active, setActive] = useState<"main" | "airtable">("main");
  const sections = [
    { id: "main", label: "การเชื่อมต่อหลัก", icon: Server },
    { id: "airtable", label: "Airtable Connections", icon: Database },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดค่าการเชื่อมต่อข้อมูลและการ Sync อัตโนมัติ" />

      <div className="flex gap-2">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => setActive(s.id)} className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
              active === s.id ? "bg-primary text-primary-foreground shadow" : "bg-card border hover:bg-accent",
            )}>
              <Icon className="size-4" /> {s.label}
            </button>
          );
        })}
      </div>

      {active === "main" ? <MainSettings /> : <AirtableSection />}
    </div>
  );
}

function MainSettings() {
  const settingsFn = useServerFn(getAppSettings);
  const logsFn = useServerFn(getSyncLogs);
  const updateFn = useServerFn(updateAppSetting);
  const syncFn = useServerFn(syncClaimsNow);
  const qc = useQueryClient();

  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn({}) });
  const { data: logsData, isLoading: logsLoading } = useQuery({ queryKey: ["sync-logs"], queryFn: () => logsFn({}) });

  const settings = settingsData?.settings ?? {};
  const logs = logsData?.logs ?? [];

  const claimEndpoint =
    settings.claim_api_endpoint ?? "https://magicticket.magicsigncloud.com/planb_api/api/Ticket/RemainingClaimTickets";
  const assetHistoryEndpoint =
    settings.asset_history_endpoint ?? "https://uat-magicticket.magicsigncloud.com/planb_api/api/Ticket/AssetHistory?oldCode={id}";
  const claimAutoSync = settings.claim_auto_sync ?? true;

  const assetDb = (settings.asset_db_connection ?? {}) as {
    host?: string; database?: string; username?: string; table?: string;
  };
  const assetDbHost = assetDb.host ?? "magicticket.magicsigncloud.com";
  const assetDbName = assetDb.database ?? "planb";
  const assetDbUser = assetDb.username ?? "planb_viewer";
  const assetDbTable = assetDb.table ?? "Asset";
  const assetSyncDays: number[] = Array.isArray(settings.asset_sync_days) ? settings.asset_sync_days : [];
  

  const saveMutation = useMutation({
    mutationFn: (vars: { key: string; value: unknown }) => updateFn({ data: vars }),
    onSuccess: () => { toast.success("บันทึกแล้ว"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (r) => {
      toast.success(`Sync Claim สำเร็จ: ${r.rows ?? 0} รายการ`);
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
      qc.invalidateQueries({ queryKey: ["claims"] });
    },
    onError: (e: Error) => toast.error(`Sync ล้มเหลว: ${e.message}`),
  });

  const syncAssetsFn = useServerFn(syncAssetsNow);
  const assetSyncMutation = useMutation({
    mutationFn: () => syncAssetsFn({}),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(`ดึงข้อมูลล้มเหลว: ${r.error ?? "ไม่สามารถเชื่อมต่อ MSSQL ได้"}`);
        qc.invalidateQueries({ queryKey: ["sync-logs"] });
        return;
      }
      toast.success(`ดึงข้อมูล Asset สำเร็จ: ${r.rows ?? 0} รายการ`);
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e: Error) => toast.error(`ดึงข้อมูลล้มเหลว: ${e.message}`),
  });

  return (
    <div className="space-y-6">
      <Section title="Modern Corporate Server (Asset Database)" desc="ตั้งค่าการเชื่อมต่อฐานข้อมูล Asset ของระบบ PlanB (รหัสผ่านเก็บอย่างปลอดภัยใน Secret Store)">
        <AssetDbForm
          defaults={{ host: assetDbHost, database: assetDbName, username: assetDbUser, table: assetDbTable }}
          syncDays={assetSyncDays}
          onSave={(payload) => saveMutation.mutate({ key: "asset_db_connection", value: payload })}
          onSaveDays={(days) => saveMutation.mutate({ key: "asset_sync_days", value: days })}
          onTest={() => assetSyncMutation.mutate()}
          testing={assetSyncMutation.isPending}
        />
      </Section>


      <Section title="API ค้นหาประวัติ Asset" desc="ใช้สำหรับดึงประวัติทรัพย์สินจากระบบ PlanB">

        <EditableField
          label="API Endpoint"
          defaultValue={assetHistoryEndpoint}
          onSave={(v) => saveMutation.mutate({ key: "asset_history_endpoint", value: v })}
        />
      </Section>

      <Section title="API Claim Aging" desc="Auto-Sync ทุก 15 นาที (ตั้งจาก pg_cron)">
        <EditableField
          label="API Endpoint"
          defaultValue={claimEndpoint}
          onSave={(v) => saveMutation.mutate({ key: "claim_api_endpoint", value: v })}
        />
        <div className="flex items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              defaultChecked={!!claimAutoSync}
              onChange={(e) => saveMutation.mutate({ key: "claim_auto_sync", value: e.target.checked })}
              className="accent-primary"
            />
            เปิด Auto-Sync (ทุก 15 นาที)
          </label>
          {claimAutoSync && <Badge tone="success"><CheckCircle2 className="inline size-3 mr-1" /> Active</Badge>}
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", syncMutation.isPending && "animate-spin")} /> ทดสอบการ Sync
          </button>
        </div>
      </Section>

      <Section title="Sync Logs (60 ครั้งล่าสุด)" desc="ผลการเชื่อมต่อย้อนหลัง">
        <div className="rounded-lg border overflow-hidden">
          {logsLoading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">ยังไม่มี Sync Log</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5">เวลา</th>
                  <th className="text-left px-4 py-2.5">แหล่ง</th>
                  <th className="text-left px-4 py-2.5">สถานะ</th>
                  <th className="text-left px-4 py-2.5">ข้อความ</th>
                  <th className="text-left px-4 py-2.5">Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 font-mono text-xs">{new Date(l.started_at).toLocaleString("th-TH")}</td>
                    <td className="px-4 py-2.5 text-xs">{l.source}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={l.status === "success" ? "success" : l.status === "warning" ? "warning" : "danger"}>{l.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{l.message ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{l.rows_affected ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>
    </div>
  );
}

function AirtableSection() {
  const listFn = useServerFn(listAirtableSlots);
  const { data, isLoading } = useQuery({ queryKey: ["airtable-slots"], queryFn: () => listFn({}) });
  const slots = data?.slots ?? [];

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <Database className="size-5" />
        </div>
        <div>
          <h3 className="font-semibold">Airtable Connections</h3>
          <p className="text-xs text-muted-foreground">รองรับ 8 ช่องการเชื่อมต่อ</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {slots.map((s) => <AirtableSlotCard key={s.id} slot={s} />)}
        </div>
      )}
    </div>
  );
}

function AirtableSlotCard({ slot }: { slot: { id: number; name: string | null; base_id: string | null; table_name: string | null; enabled: boolean } }) {
  const fn = useServerFn(updateAirtableSlot);
  const qc = useQueryClient();
  type SlotUpdate = { id: number; name?: string; base_id?: string; table_name?: string; enabled?: boolean };
  const m = useMutation({
    mutationFn: (vars: SlotUpdate) => fn({ data: vars }),
    onSuccess: () => { toast.success("บันทึกการเชื่อมต่อแล้ว"); qc.invalidateQueries({ queryKey: ["airtable-slots"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [name, setName] = useState(slot.name ?? "");
  const [baseId, setBaseId] = useState(slot.base_id ?? "");
  const [tableName, setTableName] = useState(slot.table_name ?? "");

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1">
          <span className="size-7 rounded-md bg-primary/10 text-primary grid place-items-center text-xs font-bold">{slot.id}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อการเชื่อมต่อ"
            className="bg-transparent text-sm font-medium focus:outline-none placeholder:text-muted-foreground flex-1"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={slot.enabled}
            onChange={(e) => m.mutate({ id: slot.id, enabled: e.target.checked })}
            className="accent-primary"
          />
          {slot.enabled ? "เปิด" : "ปิด"}
        </label>
      </div>
      <input
        value={baseId}
        onChange={(e) => setBaseId(e.target.value)}
        placeholder="Base ID (เช่น appXXXXXXXX)"
        className="w-full h-9 rounded-md border bg-card px-3 text-sm"
      />
      <input
        value={tableName}
        onChange={(e) => setTableName(e.target.value)}
        placeholder="Table Name"
        className="w-full h-9 rounded-md border bg-card px-3 text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={() => m.mutate({ id: slot.id, name, base_id: baseId, table_name: tableName })}
          disabled={m.isPending}
          className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 font-medium hover:opacity-90 disabled:opacity-50"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function EditableField({ label, defaultValue, onSave }: { label: string; defaultValue: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 h-10 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={() => onSave(value)}
          className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

function AssetDbForm({
  defaults,
  syncDays,
  onSave,
  onSaveDays,
  onTest,
  testing,
}: {
  defaults: { host: string; database: string; username: string; table: string };
  syncDays: number[];
  onSave: (v: { host: string; database: string; username: string; table: string; password_updated_at?: string }) => void;
  onSaveDays: (days: number[]) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const [host, setHost] = useState(defaults.host);
  const [database, setDatabase] = useState(defaults.database);
  const [username, setUsername] = useState(defaults.username);
  const [table, setTable] = useState(defaults.table);
  const [password, setPassword] = useState("");
  const [days, setDays] = useState<number[]>(syncDays);


  const toggleDay = (d: number) => {
    setDays((prev) => {
      if (prev.includes(d)) return prev.filter((x) => x !== d);
      if (prev.length >= 4) {
        toast.error("เลือกได้สูงสุด 4 วันต่อเดือน");
        return prev;
      }
      return [...prev, d].sort((a, b) => a - b);
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Modern Corporate Server (host:port)" value={host} onChange={setHost} />
        <Field label="Database" value={database} onChange={setDatabase} />
        <Field label="User" value={username} onChange={setUsername} />
        <Field label="Table" value={table} onChange={setTable} />
        <div className="md:col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Password <span className="text-muted-foreground/70">(เก็บใน Secret Store — เว้นว่างถ้าไม่ต้องการเปลี่ยน)</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full h-10 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border bg-background/50 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Auto-Sync (เซิร์ฟเวอร์รันอัตโนมัติ)</div>
            <div className="text-xs text-muted-foreground">เลือกวันที่ในเดือน (สูงสุด 4 วัน) — รันเวลา 04:00 น.</div>
          </div>
          <Badge tone={days.length > 0 ? "success" : "warning"}>{days.length}/4 วัน</Badge>
        </div>
        <div className="grid grid-cols-7 sm:grid-cols-10 md:grid-cols-16 gap-1.5">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
            const active = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={cn(
                  "h-9 rounded-md text-xs font-medium border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow"
                    : "bg-card hover:bg-accent border-border",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
        {days.length > 0 && (
          <div className="text-xs text-muted-foreground">
            จะรันในวันที่ {days.join(", ")} ของทุกเดือน เวลา 04:00 น.
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="text-sm font-medium">เชื่อมต่อ MSSQL โดยตรง (Supabase Edge Function)</div>
        <p className="text-xs text-muted-foreground">
          ระบบใช้ Lovable Cloud Function เชื่อมต่อ MS SQL Server ตรงด้วยค่า host/database/user/password ด้านบน
          ไม่ต้องมี HTTP gateway คั่นกลาง — ใช้ทั้งการกด "ทดสอบ" และ Auto-Sync เวลา 04:00 น.
        </p>
        <p className="text-xs text-muted-foreground">
          หาก timeout ที่พอร์ต 1433 ให้ตรวจ firewall/allowlist ของ Modern Corporate Server เพื่อเปิดทางเชื่อมต่อจาก Lovable Cloud
        </p>
        <button
          onClick={onTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4", testing && "animate-spin")} />
          {testing ? "กำลังดึงข้อมูล..." : "ทดสอบดึงข้อมูล Asset"}
        </button>
      </div>


      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <button
          onClick={() => {
            const payload: { host: string; database: string; username: string; table: string; password_updated_at?: string } = {
              host, database, username, table,
            };
            if (password) payload.password_updated_at = new Date().toISOString();
            onSave(payload);
            if (password) {
              toast.info("รหัสผ่านถูกอัปเดตในตั้งค่า; ค่าจริงเก็บใน Secret Store");
              setPassword("");
            }
          }}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          บันทึกการเชื่อมต่อ
        </button>
        <button
          onClick={() => onSaveDays(days)}
          className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          บันทึกตารางเวลา Auto-Sync
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
