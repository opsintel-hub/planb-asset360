import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, StatCard, Badge } from "@/components/ui-bits";
import { Activity, AlertTriangle, CheckCircle2, Wifi } from "lucide-react";
import { listMonitoring } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring — Asset History 360" },
      { name: "description", content: "ตรวจสอบสถานะการเชื่อมต่อและ Uptime ของป้ายโฆษณาแบบเรียลไทม์" },
    ],
  }),
  component: MonitoringPage,
});

function MonitoringPage() {
  const fn = useServerFn(listMonitoring);
  const { data, isLoading } = useQuery({
    queryKey: ["monitoring"],
    queryFn: () => fn({}),
  });

  const rows = data?.rows ?? [];
  const online = rows.filter((r) => r.online).length;
  const errors = rows.filter((r) => !r.online && r.error_code).length;
  const working = rows.length - online - errors;
  const uptimeAvg = rows.length
    ? (rows.reduce((s, r) => s + (Number(r.uptime_7d) || 0), 0) / rows.length).toFixed(1)
    : "—";

  return (
    <div className="space-y-6">
      <PageHeader title="Monitoring" subtitle="สถานะการเชื่อมต่อและ Uptime แบบเรียลไทม์" />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Online" value={String(online)} tone="success" icon={<Wifi className="size-5" />} />
        <StatCard label="Working On" value={String(working)} tone="default" icon={<Activity className="size-5" />} />
        <StatCard label="Error" value={String(errors)} tone="danger" icon={<AlertTriangle className="size-5" />} />
        <StatCard label="Uptime 7 วัน (เฉลี่ย)" value={uptimeAvg === "—" ? "—" : `${uptimeAvg}%`} tone="success" icon={<CheckCircle2 className="size-5" />} />
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold">รายการทรัพย์สิน</h3>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            ยังไม่มีข้อมูล Monitoring — รอการ Sync จากระบบ
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Old Code</th>
                <th className="text-left px-4 py-3">สถานะ</th>
                <th className="text-left px-4 py-3">Uptime 7 วัน</th>
                <th className="text-left px-4 py-3">Error</th>
                <th className="text-left px-4 py-3">ตรวจล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const tone = r.online ? "success" : r.error_code ? "danger" : "default";
                const status = r.online ? "Online" : r.error_code ? "Error" : "Offline";
                return (
                  <tr key={r.asset_id} className="hover:bg-accent/30">
                    <td className="px-4 py-3 font-mono text-xs">{r.asset_old_code ?? "—"}</td>
                    <td className="px-4 py-3"><Badge tone={tone}>{status}</Badge></td>
                    <td className="px-4 py-3">{r.uptime_7d != null ? `${Number(r.uptime_7d).toFixed(1)}%` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.error_code ?? "—"} {r.message ? `· ${r.message}` : ""}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {r.last_seen_at ? new Date(r.last_seen_at).toLocaleString("th-TH") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
