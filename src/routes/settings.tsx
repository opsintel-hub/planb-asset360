import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, RefreshCw, CheckCircle2, Server, AlertTriangle, Tag, FileSpreadsheet } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getAppSettings, getSyncLogs, listAirtableSlots, getSchemaStatus } from "@/lib/data.functions";
import {
  updateAppSetting,
  updateAirtableSlot,
  syncClaimsNow,
  syncAssetsNow,
  syncAssetHistoryBatchNow,
  syncMssqlAssetHistoryNow,
  syncPmSchedulesNow,
  getMssqlCronSchedules,
  updateMssqlCronSchedule,
} from "@/lib/admin.functions";

import { Skeleton } from "@/components/ui/skeleton";
import { DiagramMappingsSection } from "@/components/diagram-mappings-section";
import { MappingImportExport } from "@/components/mapping-import-export";
import { MssqlTableControls, type TablesEnabled } from "@/components/mssql-table-controls";

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
  const [active, setActive] = useState<"main" | "airtable" | "mappings" | "informed">("main");
  const sections = [
    { id: "main", label: "การเชื่อมต่อหลัก", icon: Server },
    { id: "airtable", label: "Airtable Connections", icon: Database },
    { id: "mappings", label: "Diagram Mappings", icon: Tag },
    { id: "informed", label: "Informed Mapping (PM Insights)", icon: FileSpreadsheet },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดค่าการเชื่อมต่อข้อมูลและการ Sync อัตโนมัติ" />

      <div className="flex gap-2 flex-wrap">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
                active === s.id ? "bg-primary text-primary-foreground shadow" : "bg-card border hover:bg-accent",
              )}
            >
              <Icon className="size-4" /> {s.label}
            </button>
          );
        })}
      </div>

      {active === "main" ? (
        <MainSettings />
      ) : active === "airtable" ? (
        <AirtableSection />
      ) : active === "mappings" ? (
        <DiagramMappingsSection />
      ) : (
        <MappingImportExport />
      )}
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
    settings.asset_history_endpoint ??
    "https://uat-magicticket.magicsigncloud.com/planb_api/api/Ticket/AssetHistory?oldCode={id}";
  const claimAutoSync = settings.claim_auto_sync ?? true;

  const assetDb = (settings.asset_db_connection ?? {}) as {
    host?: string;
    server?: string;
    port?: number | string;
    database?: string;
    username?: string;
    table?: string;
    pmScheduleTable?: string;
    historyTable?: string;
  };
  const [legacyServer, legacyPort] = String(assetDb.host ?? "magicticket.magicsigncloud.com").split(":");
  const assetDbServer = assetDb.server ?? legacyServer;
  const assetDbPort = String(assetDb.port ?? legacyPort ?? 1433);
  const assetDbName = assetDb.database ?? "planb";
  const assetDbUser = assetDb.username ?? "planb_viewer";
  const assetDbTable = assetDb.table ?? "Asset";
  const assetDbPmTable = assetDb.pmScheduleTable ?? "Asset_PM_Schedule";
  const assetDbHistoryTable = assetDb.historyTable ?? "AssetHistory";
  const tablesEnabled = (settings.asset_sync_tables_enabled ?? {}) as TablesEnabled;
  const isOn = (k: keyof TablesEnabled) => tablesEnabled[k] !== false; // default ON

  const saveMutation = useMutation({
    mutationFn: (vars: { key: string; value: unknown }) => updateFn({ data: vars }),
    onSuccess: () => {
      toast.success("บันทึกแล้ว");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
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

  const syncHistoryFn = useServerFn(syncMssqlAssetHistoryNow);
  const historySyncMutation = useMutation({
    mutationFn: (vars: { reset: boolean }) => syncHistoryFn({ data: { reset: vars.reset } }),
    onSuccess: (r, vars) => {
      if (!r.ok) {
        toast.error(`ดึงข้อมูล Asset History ล้มเหลว: ${r.error ?? "ไม่สำเร็จ"}`);
        qc.invalidateQueries({ queryKey: ["sync-logs"] });
        return;
      }
      toast.success(
        vars.reset
          ? "เริ่ม Full Reset Asset History — ล้างตารางและดึงใหม่ทั้งหมด (ทำงานเบื้องหลัง)"
          : "เริ่ม Incremental Sync — ดึงเฉพาะแถวใหม่/แก้ไขตั้งแต่ครั้งล่าสุด (ทำงานเบื้องหลัง)",
      );
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: Error) => toast.error(`ดึงข้อมูลล้มเหลว: ${e.message}`),
  });

  const syncPmFn = useServerFn(syncPmSchedulesNow);
  const pmSyncMutation = useMutation({
    mutationFn: () => syncPmFn({}),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(`ดึงข้อมูล PM Schedule ล้มเหลว: ${r.error ?? "ไม่สำเร็จ"}`);
        qc.invalidateQueries({ queryKey: ["sync-logs"] });
        return;
      }
      toast.success(`ดึงข้อมูล PM Schedule สำเร็จ: ${r.rows ?? 0} รายการ`);
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: Error) => toast.error(`ดึงข้อมูลล้มเหลว: ${e.message}`),
  });



  return (
    <div className="space-y-6">
      <Section
        title="ตั้งเวลาดึงข้อมูล MSSQL อัตโนมัติ (รายวัน)"
        desc="ตัวกำหนดเวลาหลักสำหรับงาน Sync จาก Modern Corporate Server — แก้เวลาได้ตามที่ทีมต้นทางพร้อมส่งข้อมูล"
      >
        <MssqlCronScheduleEditor />
      </Section>

      <Section
        title="Modern Corporate Server (Asset Database)"
        desc="ค่าการเชื่อมต่อ MSSQL — Server, Database, ชื่อตาราง และปุ่มทดสอบดึงข้อมูล (รหัสผ่านเก็บใน Secret Store)"
      >
        <AssetDbForm
          defaults={{
            server: assetDbServer,
            port: assetDbPort,
            database: assetDbName,
            username: assetDbUser,
            table: assetDbTable,
            pmScheduleTable: assetDbPmTable,
            historyTable: assetDbHistoryTable,
          }}
          tablesEnabled={tablesEnabled}
          onSave={(payload) => saveMutation.mutate({ key: "asset_db_connection", value: payload })}
          onTest={() => {
            if (!isOn("asset")) { toast.error("ปิดการ Sync ตาราง Asset ไว้ — เปิดก่อนถึงจะทดสอบได้"); return; }
            assetSyncMutation.mutate();
          }}
          testing={assetSyncMutation.isPending}
          onTestHistory={(reset) => {
            if (!isOn("assetHistory")) { toast.error("ปิดการ Sync ตาราง AssetHistory ไว้ — เปิดก่อนถึงจะทดสอบได้"); return; }
            historySyncMutation.mutate({ reset });
          }}
          testingHistory={historySyncMutation.isPending}
          onTestPm={() => {
            if (!isOn("pmSchedule")) { toast.error("ปิดการ Sync ตาราง PM Schedule ไว้ — เปิดก่อนถึงจะทดสอบได้"); return; }
            pmSyncMutation.mutate();
          }}
          testingPm={pmSyncMutation.isPending}
        />

      </Section>


      <SchemaAlertSection />

      {/* Legacy "API ค้นหาประวัติ Asset (รายป้าย — HTTP fallback)" section was
          removed. ระบบใช้ MSSQL bulk sync เป็นแหล่งเดียวสำหรับ Asset History
          เพื่อไม่ให้ตัวเลขในหน้า Monitor / Search / PM Insights ขัดกัน */}


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
          {claimAutoSync && (
            <Badge tone="success">
              <CheckCircle2 className="inline size-3 mr-1" /> Active
            </Badge>
          )}
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
            <div className="p-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
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
                      <Badge tone={l.status === "success" ? "success" : l.status === "warning" ? "warning" : "danger"}>
                        {l.status}
                      </Badge>
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
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {slots.map((s) => (
            <AirtableSlotCard key={s.id} slot={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function AirtableSlotCard({
  slot,
}: {
  slot: { id: number; name: string | null; base_id: string | null; table_name: string | null; enabled: boolean };
}) {
  const fn = useServerFn(updateAirtableSlot);
  const qc = useQueryClient();
  type SlotUpdate = { id: number; name?: string; base_id?: string; table_name?: string; enabled?: boolean };
  const m = useMutation({
    mutationFn: (vars: SlotUpdate) => fn({ data: vars }),
    onSuccess: () => {
      toast.success("บันทึกการเชื่อมต่อแล้ว");
      qc.invalidateQueries({ queryKey: ["airtable-slots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [name, setName] = useState(slot.name ?? "");
  const [baseId, setBaseId] = useState(slot.base_id ?? "");
  const [tableName, setTableName] = useState(slot.table_name ?? "");

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1">
          <span className="size-7 rounded-md bg-primary/10 text-primary grid place-items-center text-xs font-bold">
            {slot.id}
          </span>
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

function EditableField({
  label,
  defaultValue,
  onSave,
}: {
  label: string;
  defaultValue: string;
  onSave: (v: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  // Sync when upstream value changes (e.g. settings query finishes loading after first paint)
  useEffect(() => { setValue(defaultValue); }, [defaultValue]);
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
  tablesEnabled,
  onSave,
  onTest,
  testing,
  onTestHistory,
  testingHistory,
  onTestPm,
  testingPm,
}: {
  defaults: {
    server: string;
    port: string;
    database: string;
    username: string;
    table: string;
    pmScheduleTable: string;
    historyTable: string;
  };
  tablesEnabled: TablesEnabled;
  onSave: (v: {
    server: string;
    port: number;
    database: string;
    username: string;
    table: string;
    pmScheduleTable: string;
    historyTable: string;
  }) => void;
  onTest: () => void;
  testing: boolean;
  onTestHistory: (reset: boolean) => void;
  testingHistory: boolean;
  onTestPm: () => void;
  testingPm: boolean;
}) {
  const [server, setServer] = useState(defaults.server);
  const [port, setPort] = useState(defaults.port);
  const [database, setDatabase] = useState(defaults.database);
  const [username, setUsername] = useState(defaults.username);
  const [table, setTable] = useState(defaults.table);
  const [pmScheduleTable, setPmScheduleTable] = useState(defaults.pmScheduleTable);
  const [historyTable, setHistoryTable] = useState(defaults.historyTable);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Server Name" value={server} onChange={setServer} />
        <Field label="Port" value={port} onChange={setPort} />
        <Field label="Database" value={database} onChange={setDatabase} />
        <Field label="User" value={username} onChange={setUsername} />
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Password</label>
          <input
            type="password"
            value="••••••••••••"
            readOnly
            className="w-full h-10 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground cursor-not-allowed"
          />
          <p className="text-[11px] text-muted-foreground">
            เก็บไว้ใน Secret Store (MODERN_CORP_DB_PASSWORD) — แจ้งแอดมินเพื่ออัปเดต
          </p>
        </div>
        <Field label="Table (Asset)" value={table} onChange={setTable} />
        <Field label="Table (PM Schedule)" value={pmScheduleTable} onChange={setPmScheduleTable} />
        <Field label="Table (Asset History)" value={historyTable} onChange={setHistoryTable} />
      </div>

      <MssqlTableControls
        assetTable={table}
        pmTable={pmScheduleTable}
        historyTable={historyTable}
        enabled={tablesEnabled}
      />

      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div>
          <div className="text-sm font-medium">ทดสอบดึงข้อมูลด้วยตนเอง (Manual Sync)</div>
          <p className="text-xs text-muted-foreground">
            ใช้สำหรับทดสอบการเชื่อมต่อหรือดึงข้อมูลทันทีโดยไม่ต้องรอ Cron — เวลาดึงอัตโนมัติรายวันตั้งได้ที่ส่วน
            "ตั้งเวลาดึงข้อมูล MSSQL อัตโนมัติ" ด้านบน
          </p>
        </div>

        <div className="rounded-md border border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
          <div className="font-semibold">พฤติกรรมการ Sync</div>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>Asset / PM Schedule</b> = Full Refresh (ล้างตารางและดึงใหม่ทั้งหมด)</li>
            <li><b>Asset History</b> = Incremental — ดึงเฉพาะแถวใหม่/แก้ไขตั้งแต่ cursor ครั้งล่าสุด (12 เดือนล่าสุด, batch 5,000 แถว, chain ต่อเนื่อง)</li>
            <li><b>Full Reset</b> สีแดง = ล้างตารางและ cursor แล้วดึงใหม่ทั้งหมด (ใช้เมื่อข้อมูลเพี้ยนเท่านั้น)</li>
            <li>อย่ากดซ้ำขณะที่ Sync Logs ยังเป็นสถานะ <code>running</code></li>
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", testing && "animate-spin")} />
            {testing ? "กำลังดึงข้อมูล..." : "ดึง Asset (Full Refresh)"}
          </button>
          <button
            onClick={onTestPm}
            disabled={testingPm}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-card text-primary px-4 py-2 text-sm font-medium hover:bg-primary/10 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", testingPm && "animate-spin")} />
            {testingPm ? "กำลังดึงข้อมูล..." : "ดึง PM Schedule (Full Refresh)"}
          </button>
          <button
            onClick={() => onTestHistory(false)}
            disabled={testingHistory}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-card text-primary px-4 py-2 text-sm font-medium hover:bg-primary/10 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", testingHistory && "animate-spin")} />
            {testingHistory ? "กำลังดึงข้อมูล..." : "Sync Asset History (Incremental)"}
          </button>
          <button
            onClick={() => {
              if (!confirm("Full Reset จะล้างตาราง mssql_asset_history ทั้งหมดและดึงใหม่จากต้นทาง — ใช้เวลานาน ต้องการดำเนินการต่อหรือไม่?")) return;
              onTestHistory(true);
            }}
            disabled={testingHistory}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive px-4 py-2 text-sm font-medium hover:bg-destructive/20 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", testingHistory && "animate-spin")} />
            Asset History — Full Reset
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          หาก timeout ที่พอร์ต 1433 ให้ตรวจ firewall / allowlist ของ Modern Corporate Server เพื่อเปิดทางเชื่อมต่อจาก Lovable Cloud
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <button
          onClick={() => {
            const parsedPort = Number(port);
            if (!server.trim() || !database.trim() || !username.trim() || !table.trim()) {
              toast.error("กรุณากรอก Server, Database, User และ Table ให้ครบ");
              return;
            }
            if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
              toast.error("Port ต้องเป็นตัวเลขระหว่าง 1-65535");
              return;
            }
            const payload = {
              server: server.trim(),
              port: parsedPort,
              database: database.trim(),
              username: username.trim(),
              table: table.trim(),
              pmScheduleTable: pmScheduleTable.trim(),
              historyTable: historyTable.trim(),
            };
            onSave(payload);
          }}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          บันทึกการเชื่อมต่อ
        </button>
      </div>
    </div>
  );
}


function SchemaAlertSection() {
  const fn = useServerFn(getSchemaStatus);
  const updFn = useServerFn(updateAppSetting);
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["schema-status"], queryFn: () => fn({}) });

  const acceptMutation = useMutation({
    mutationFn: () =>
      updFn({
        data: {
          key: "asset_schema_snapshot",
          value: { keys: data?.currentKeys ?? [], takenAt: new Date().toISOString() },
        },
      }),
    onSuccess: () => {
      toast.success("บันทึก Schema ปัจจุบันเป็นค่าอ้างอิงแล้ว");
      qc.invalidateQueries({ queryKey: ["schema-status"] });
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasChange = (data?.added.length ?? 0) > 0 || (data?.removed.length ?? 0) > 0;
  const tone = !data?.hasData ? "warning" : !data.hasSnapshot ? "warning" : hasChange ? "danger" : "success";

  return (
    <Section title="Schema Change Alert" desc="แจ้งเตือนเมื่อโครงสร้างข้อมูล Asset จากต้นทางมีการเพิ่ม/ลบ field">
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : !data?.hasData ? (
        <div className="text-sm text-muted-foreground">ยังไม่มีข้อมูล Asset — กดทดสอบดึงข้อมูลก่อน</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={tone}>
              {!data.hasSnapshot ? "ยังไม่มี Snapshot" : hasChange ? "ตรวจพบการเปลี่ยนแปลง" : "ไม่มีการเปลี่ยนแปลง"}
            </Badge>
            {data.snapshotAt && (
              <span className="text-xs text-muted-foreground">
                Snapshot ล่าสุด: {new Date(data.snapshotAt).toLocaleString("th-TH")}
              </span>
            )}
          </div>

          {hasChange && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="size-4" /> Schema เปลี่ยนแปลง
              </div>
              {data.added.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">เพิ่ม ({data.added.length}):</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {data.added.map((k) => (
                      <code key={k} className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">
                        +{k}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              {data.removed.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">หายไป ({data.removed.length}):</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {data.removed.map((k) => (
                      <code key={k} className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive">
                        −{k}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              ดู Field ปัจจุบันทั้งหมด ({data.currentKeys.length})
            </summary>
            <div className="flex flex-wrap gap-1 mt-2">
              {data.currentKeys.map((k) => (
                <code key={k} className="text-xs px-2 py-0.5 rounded bg-muted">
                  {k}
                </code>
              ))}
            </div>
          </details>

          <div className="flex gap-2 pt-2 border-t">
            <button
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {data.hasSnapshot ? "ยืนยันใช้ Schema ใหม่" : "บันทึก Snapshot เริ่มต้น"}
            </button>
            <button
              onClick={() => refetch()}
              className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent inline-flex items-center gap-2"
            >
              <RefreshCw className="size-4" /> ตรวจซ้ำ
            </button>
          </div>
        </div>
      )}
    </Section>
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

function AssetHistoryScheduleControl({
  mode,
  limit,
  onSaveMode,
}: {
  mode: "off" | "every_3h" | "daytime_3h" | "daily_0530";
  limit: number;
  onSaveMode: (mode: "off" | "every_3h" | "daytime_3h" | "daily_0530", limit: number) => void;
}) {
  const [selected, setSelected] = useState<"off" | "every_3h" | "daytime_3h" | "daily_0530">(mode);
  const [batchLimit, setBatchLimit] = useState<number>(limit);
  // Re-sync when settings query loads after first paint
  useEffect(() => { setSelected(mode); }, [mode]);
  useEffect(() => { setBatchLimit(limit); }, [limit]);
  const syncFn = useServerFn(syncAssetHistoryBatchNow);
  const qc = useQueryClient();
  const runMutation = useMutation({
    mutationFn: () => syncFn({ data: { limit: batchLimit } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(`Sync ล้มเหลว: ${r.error ?? "ไม่ทราบสาเหตุ"}`);
      } else {
        toast.success(`Sync ประวัติ Asset สำเร็จ: ${r.processed} ป้าย (${r.rows} แถว, ล้มเหลว ${r.failed})`);
      }
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: Error) => toast.error(`Sync ล้มเหลว: ${e.message}`),
  });

  const options: Array<{ id: "off" | "every_3h" | "daytime_3h" | "daily_0530"; title: string; desc: string }> = [
    {
      id: "every_3h",
      title: "ทุก 3 ชั่วโมง (24 ชม.)",
      desc: "รันเวลา 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00",
    },
    { id: "daytime_3h", title: "เฉพาะกลางวัน ทุก 3 ชั่วโมง", desc: "รันเวลา 06:00, 09:00, 12:00, 15:00, 18:00" },
    {
      id: "daily_0530",
      title: "ทุกวัน 05:30 น.",
      desc: "รันวันละครั้ง เวลา 05:30 น. (เหมาะกับการ Sync ก่อนเริ่มงานเช้า)",
    },
    {
      id: "off",
      title: "ปิด Auto-Sync (Manual เท่านั้น)",
      desc: "ระบบจะไม่ดึงข้อมูลอัตโนมัติ ต้องกดปุ่ม Manual Sync เอง",
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border bg-background/50 p-3">
      <div className="text-sm font-medium">Schedule Auto-Sync ประวัติ Asset</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        {options.map((o) => {
          const active = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelected(o.id)}
              className={cn(
                "text-left rounded-lg border p-3 text-sm transition",
                active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "hover:bg-accent",
              )}
            >
              <div className="font-medium">{o.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{o.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3 pt-1">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">จำนวนป้ายต่อรอบ (Batch Size)</label>
          <input
            type="number"
            min={1}
            max={2000}
            value={batchLimit}
            onChange={(e) => setBatchLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 0)))}
            className="w-32 h-9 rounded-md border bg-background px-3 text-sm"
          />
          <div className="text-[11px] text-muted-foreground">
            แนะนำ 10–15 ป้าย/รอบ (ถ้าใหญ่เกินอาจ Timeout) — ระบบจะดึงป้ายที่ Sync นานสุดก่อนเสมอ
          </div>
        </div>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => onSaveMode(selected, batchLimit)}
            className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            บันทึก Schedule
          </button>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", runMutation.isPending && "animate-spin")} />
            {runMutation.isPending ? "กำลัง Sync..." : "Manual Sync ตอนนี้"}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        ทุกครั้งที่ Sync (อัตโนมัติหรือ Manual) จะถูกบันทึกใน Sync Logs ด้านล่าง
      </p>
    </div>
  );
}

// ============================================================
// MSSQL Daily Cron Schedule Editor (Thai timezone, +07:00)
// ============================================================
const MSSQL_JOB_LABELS: Record<string, { title: string; desc: string }> = {
  "mssql-sync-assets-daily": {
    title: "Asset (รายการป้าย)",
    desc: "Full refresh ตาราง mssql_asset ทุกวัน",
  },
  "mssql-sync-pm-schedules-daily": {
    title: "PM Schedule",
    desc: "Full refresh ตาราง mssql_asset_pm_schedule ทุกวัน",
  },
  "mssql-sync-asset-history-daily": {
    title: "Asset History (Incremental)",
    desc: "Sync ส่วนที่ใหม่กว่า cursor ครั้งล่าสุด + auto-chain batches",
  },
};

function utcToThai(hUtc: number, mUtc: number): { h: number; m: number } {
  const total = hUtc * 60 + mUtc + 7 * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { h: Math.floor(wrapped / 60), m: wrapped % 60 };
}
function thaiToUtc(hThai: number, mThai: number): { h: number; m: number } {
  const total = hThai * 60 + mThai - 7 * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { h: Math.floor(wrapped / 60), m: wrapped % 60 };
}
function fmt(n: number) {
  return n.toString().padStart(2, "0");
}

function MssqlCronScheduleEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMssqlCronSchedules);
  const setFn = useServerFn(updateMssqlCronSchedule);
  const { data, isLoading } = useQuery({
    queryKey: ["mssql-cron-schedules"],
    queryFn: () => getFn({}),
  });

  const mut = useMutation({
    mutationFn: (vars: { job: string; hourUtc: number; minuteUtc: number }) =>
      setFn({
        data: {
          job: vars.job as
            | "mssql-sync-assets-daily"
            | "mssql-sync-pm-schedules-daily"
            | "mssql-sync-asset-history-daily",
          hourUtc: vars.hourUtc,
          minuteUtc: vars.minuteUtc,
        },
      }),
    onSuccess: () => {
      toast.success("บันทึกเวลา Sync เรียบร้อย");
      qc.invalidateQueries({ queryKey: ["mssql-cron-schedules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-medium">ตั้งเวลาดึงข้อมูล MSSQL อัตโนมัติ (รายวัน)</div>
          <div className="text-xs text-muted-foreground">
            เวลาแสดงตามโซนเวลาไทย (UTC+07:00) — ระบบจะรันทุกวันตามเวลาที่ตั้งไว้
          </div>
        </div>
        {isLoading && <span className="text-xs text-muted-foreground">กำลังโหลด...</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(data ?? []).map((row) => (
          <CronJobCard
            key={row.job}
            job={row.job}
            hourUtc={row.hourUtc}
            minuteUtc={row.minuteUtc}
            saving={mut.isPending}
            onSave={(hUtc, mUtc) => mut.mutate({ job: row.job, hourUtc: hUtc, minuteUtc: mUtc })}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        การเปลี่ยนเวลาจะมีผลทันที — รอบ Sync ถัดไปจะรันตามเวลาใหม่ที่บันทึก
      </p>
    </div>
  );
}

function CronJobCard({
  job,
  hourUtc,
  minuteUtc,
  saving,
  onSave,
}: {
  job: string;
  hourUtc: number | null;
  minuteUtc: number | null;
  saving: boolean;
  onSave: (hUtc: number, mUtc: number) => void;
}) {
  const initial =
    hourUtc != null && minuteUtc != null ? utcToThai(hourUtc, minuteUtc) : { h: 2, m: 0 };
  const [val, setVal] = useState<string>(`${fmt(initial.h)}:${fmt(initial.m)}`);
  useEffect(() => {
    if (hourUtc != null && minuteUtc != null) {
      const t = utcToThai(hourUtc, minuteUtc);
      setVal(`${fmt(t.h)}:${fmt(t.m)}`);
    }
  }, [hourUtc, minuteUtc]);

  const label = MSSQL_JOB_LABELS[job] ?? { title: job, desc: "" };
  const currentThai =
    hourUtc != null && minuteUtc != null ? utcToThai(hourUtc, minuteUtc) : null;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div>
        <div className="text-sm font-medium">{label.title}</div>
        <div className="text-[11px] text-muted-foreground">{label.desc}</div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={val}
          step={60}
          onChange={(e) => setVal(e.target.value)}
          className="h-9 w-32 rounded-md border bg-background px-2 text-sm tabular-nums"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const m = /^(\d{2}):(\d{2})$/.exec(val);
            if (!m) {
              toast.error("รูปแบบเวลาไม่ถูกต้อง (HH:MM)");
              return;
            }
            const hThai = Number(m[1]);
            const mThai = Number(m[2]);
            if (hThai > 23 || mThai > 59) {
              toast.error("เวลาไม่ถูกต้อง");
              return;
            }
            const utc = thaiToUtc(hThai, mThai);
            onSave(utc.h, utc.m);
          }}
          className="h-9 rounded-md bg-primary text-primary-foreground px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          บันทึก
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        ปัจจุบัน:{" "}
        {currentThai
          ? `${fmt(currentThai.h)}:${fmt(currentThai.m)} น. (ไทย) · ${fmt(hourUtc!)}:${fmt(minuteUtc!)} UTC`
          : "ยังไม่ได้ตั้งค่า"}
      </div>
    </div>
  );
}
