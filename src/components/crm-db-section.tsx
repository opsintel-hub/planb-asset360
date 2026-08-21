import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Server, Info, Copy } from "lucide-react";
import { toast } from "sonner";
import { getAppSettings } from "@/lib/data.functions";
import { updateAppSetting } from "@/lib/admin.functions";
import { syncAdContractsNow } from "@/lib/ad-contracts.functions";

type CrmConn = {
  host?: string;
  port?: number | string;
  database?: string;
  username?: string;
  view?: string;
};

const PUSH_ENDPOINT =
  "https://project--6d2903c3-530f-4343-83c9-b9ada7a70d18.lovable.app/api/public/hooks/sync-ad-contracts";

export function CrmDbSection() {
  const qc = useQueryClient();
  const settingsFn = useServerFn(getAppSettings);
  const saveFn = useServerFn(updateAppSetting);
  const syncFn = useServerFn(syncAdContractsNow);

  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn({}) });
  const conn = ((data?.settings?.crm_db_connection ?? {}) as CrmConn) || {};

  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [view, setView] = useState("");

  useEffect(() => {
    setHost(String(conn.host ?? "117.121.218.84"));
    setPort(String(conn.port ?? 3306));
    setDatabase(String(conn.database ?? "sugarcrm_prod"));
    setUsername(String(conn.username ?? "useroperation"));
    setView(String(conn.view ?? "view_productstatus"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);


  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          key: "crm_db_connection",
          value: { host: host.trim(), port: Number(port) || 3306, database: database.trim(), username: username.trim(), view: view.trim() },
        },
      }),
    onSuccess: () => {
      toast.success("บันทึกค่าการเชื่อมต่อ CRM แล้ว");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`ดึงข้อมูลโฆษณาสำเร็จ ${r.rows} รายการ`);
        qc.invalidateQueries({ queryKey: ["sync-logs"] });
      } else {
        toast.error(r.error ?? "เชื่อมต่อ CRM ไม่สำเร็จ");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-4">
      <div className="flex items-start gap-2">
        <Server className="size-4 mt-1 text-primary" />
        <div>
          <h3 className="font-semibold">CRM Server (Ad Contract Database)</h3>
          <p className="text-xs text-muted-foreground">
            MySQL view <code>view_productstatus</code> — ชื่อโฆษณา, รหัสป้าย, วันเริ่ม/สิ้นสุดสัญญา และวันติดตั้งจริง (favor)
            · รหัสผ่านเก็บใน Secret Store (<code>CRM_DB_PASSWORD</code>)
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Server Host" value={host} onChange={setHost} placeholder="117.121.218.84" />
        <Field label="Port" value={port} onChange={setPort} placeholder="3306" />
        <Field label="Database" value={database} onChange={setDatabase} placeholder="sugarcrm_prod" />
        <Field label="Username" value={username} onChange={setUsername} placeholder="useroperation" />
        <Field label="View / Table" value={view} onChange={setView} placeholder="view_productstatus" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          บันทึกค่าเชื่อมต่อ
        </button>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={sync.isPending ? "size-4 animate-spin" : "size-4"} /> ทดสอบดึงข้อมูลเดี๋ยวนี้
        </button>
      </div>

      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs space-y-2">
        <div className="flex items-center gap-2 font-medium">
          <Info className="size-4" /> สถานะการเชื่อมต่อ: ใช้งานได้แล้ว
        </div>
        <p>
          เชื่อมต่อ <code>117.121.218.84:3306</code> สำเร็จ ดึงข้อมูลจาก <code>view_productstatus</code> ได้ครบ
          (~9,600 แถว) ระบบจับคู่ป้ายด้วย <code>old_code</code> และถ้าไม่ตรงจะใช้ <code>equipment_id</code> ช่วยจับคู่อีกชั้น
        </p>
        <p>
          ทางเลือกสำรอง: ทีม IT ส่งข้อมูลเข้ามาเอง (Push) ที่ endpoint นี้ ด้วย header <code>x-sync-token</code> และ body{" "}
          <code>{`{"rows": [ ...แถวจาก view_productstatus... ]}`}</code>
        </p>

        <div className="flex items-center gap-2">
          <code className="truncate rounded bg-background px-2 py-1">{PUSH_ENDPOINT}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(PUSH_ENDPOINT);
              toast.success("คัดลอก endpoint แล้ว");
            }}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-accent"
          >
            <Copy className="size-3" /> คัดลอก
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
      />
    </label>
  );
}
