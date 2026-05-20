import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { Wrench, Clock, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/claims")({
  head: () => ({
    meta: [
      { title: "Claim Aging — Asset History 360" },
      { name: "description", content: "รายการ Claim ที่ค้างอยู่ พร้อม Aging และระดับความเร่งด่วน" },
    ],
  }),
  component: ClaimsPage,
});

const claims = [
  { id: "CLM-2026-0481", code: "PB-A12048", issue: "หลอด LED ดับ 30%", aging: 1, sla: 2, status: "Working On", tone: "info" as const },
  { id: "CLM-2026-0479", code: "PB-A09112", issue: "ป้ายไม่ติดในช่วงค่ำ", aging: 3, sla: 2, status: "Overdue", tone: "danger" as const },
  { id: "CLM-2026-0476", code: "PB-A20451", issue: "โครงสร้างชำรุดจากลม", aging: 5, sla: 7, status: "Pending", tone: "warning" as const },
  { id: "CLM-2026-0470", code: "PB-A11827", issue: "ระบบไฟกระพริบ", aging: 2, sla: 3, status: "Working On", tone: "info" as const },
  { id: "CLM-2026-0468", code: "PB-A18820", issue: "สีซีดจาง / ภาพไม่ชัด", aging: 8, sla: 7, status: "Overdue", tone: "danger" as const },
];

function ClaimsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Claim Aging" subtitle="ติดตามอายุงานเคลม Auto-Sync ทุก 15 นาที" />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Claim ค้างทั้งหมด" value="48" tone="warning" icon={<Wrench className="size-5" />} />
        <StatCard label="เกิน SLA" value="9" tone="danger" icon={<AlertCircle className="size-5" />} />
        <StatCard label="Response เฉลี่ย" value="1.8 ชม." tone="default" icon={<Clock className="size-5" />} />
        <StatCard label="Resolve เฉลี่ย" value="6.4 ชม." tone="success" icon={<Clock className="size-5" />} />
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Ticket</th>
              <th className="text-left px-4 py-3">Old Code</th>
              <th className="text-left px-4 py-3">อาการ</th>
              <th className="text-left px-4 py-3">อายุงาน</th>
              <th className="text-left px-4 py-3">SLA</th>
              <th className="text-left px-4 py-3">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {claims.map((c) => (
              <tr key={c.id} className="hover:bg-accent/30">
                <td className="px-4 py-3 font-mono text-xs">{c.id}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                <td className="px-4 py-3">{c.issue}</td>
                <td className="px-4 py-3">{c.aging} วัน</td>
                <td className="px-4 py-3">{c.sla} วัน</td>
                <td className="px-4 py-3"><Badge tone={c.tone}>{c.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
