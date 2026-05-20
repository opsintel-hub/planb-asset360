import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { Wrench, Clock, AlertCircle } from "lucide-react";
import { listClaims } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/claims")({
  head: () => ({
    meta: [
      { title: "Claim Aging — Asset History 360" },
      { name: "description", content: "รายการ Claim ที่ค้างอยู่ พร้อม Aging และระดับความเร่งด่วน" },
    ],
  }),
  component: ClaimsPage,
});

function ClaimsPage() {
  const fn = useServerFn(listClaims);
  const { data, isLoading } = useQuery({
    queryKey: ["claims", "all"],
    queryFn: () => fn({ data: { sla: "all" as const } }),
  });

  const claims = data?.claims ?? [];
  const breached = claims.filter((c) => c.sla_status === "breached").length;
  const avgAge = claims.length ? claims.reduce((s, c) => s + (Number(c.age_hours) || 0), 0) / claims.length : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Claim Aging" subtitle="ติดตามอายุงานเคลม Auto-Sync ทุก 15 นาที" />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Claim ค้างทั้งหมด" value={String(claims.length)} tone="warning" icon={<Wrench className="size-5" />} />
        <StatCard label="เกิน SLA" value={String(breached)} tone="danger" icon={<AlertCircle className="size-5" />} />
        <StatCard label="อายุงานเฉลี่ย" value={`${(avgAge / 24).toFixed(1)} วัน`} tone="default" icon={<Clock className="size-5" />} />
        <StatCard label="On Track" value={String(claims.filter((c) => c.sla_status === "ontrack").length)} tone="success" icon={<Clock className="size-5" />} />
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : claims.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">ยังไม่มี Claim ในระบบ — กด "ทดสอบการ Sync" ในหน้าตั้งค่าเพื่อดึงข้อมูลจาก PlanB API</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Ticket</th>
                <th className="text-left px-4 py-3">Old Code</th>
                <th className="text-left px-4 py-3">อาการ</th>
                <th className="text-left px-4 py-3">อายุงาน</th>
                <th className="text-left px-4 py-3">SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {claims.map((c) => {
                const tone = c.sla_status === "breached" ? "danger" : c.sla_status === "atrisk" ? "warning" : "success";
                return (
                  <tr key={c.id} className="hover:bg-accent/30">
                    <td className="px-4 py-3 font-mono text-xs">{c.ticket_code}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.asset_old_code ?? "—"}</td>
                    <td className="px-4 py-3">{c.title ?? "—"}</td>
                    <td className="px-4 py-3">{c.age_hours ? `${(Number(c.age_hours) / 24).toFixed(1)} วัน` : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={tone}>{c.sla_status ?? "—"}</Badge></td>
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
