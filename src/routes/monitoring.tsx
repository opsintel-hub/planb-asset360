import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, StatCard, Badge } from "@/components/ui-bits";
import { Activity, AlertTriangle, CheckCircle2, Wifi } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring — Asset History 360" },
      { name: "description", content: "ตรวจสอบสถานะการเชื่อมต่อและ Uptime ของป้ายโฆษณาแบบเรียลไทม์" },
    ],
  }),
  component: MonitoringPage,
});

const uptimeData = Array.from({ length: 24 }, (_, i) => ({
  h: `${i}:00`,
  uptime: 97 + Math.sin(i / 3) * 1.5 + Math.random(),
}));

const assets = [
  { code: "PB-A12048", name: "Asoke Tower LED", status: "Online", lastCheck: "2 นาที", tone: "success" as const },
  { code: "PB-A09112", name: "Siam Square LED #3", status: "Online", lastCheck: "3 นาที", tone: "success" as const },
  { code: "PB-A20451", name: "Sukhumvit 24 LED", status: "Error", lastCheck: "12 นาที", tone: "danger" as const },
  { code: "PB-A11827", name: "Chidlom Junction", status: "Working On", lastCheck: "1 นาที", tone: "info" as const },
  { code: "PB-A18820", name: "Ratchadamri Skywalk", status: "Online", lastCheck: "5 นาที", tone: "success" as const },
];

function MonitoringPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Monitoring" subtitle="สถานะการเชื่อมต่อและ Uptime แบบเรียลไทม์" />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Online" value="2,752" tone="success" icon={<Wifi className="size-5" />} />
        <StatCard label="Working On" value="37" tone="default" icon={<Activity className="size-5" />} />
        <StatCard label="Error" value="7" tone="danger" icon={<AlertTriangle className="size-5" />} />
        <StatCard label="Uptime วันนี้" value="98.4%" tone="success" icon={<CheckCircle2 className="size-5" />} />
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
        <h3 className="font-semibold mb-1">Uptime 24 ชั่วโมงล่าสุด</h3>
        <p className="text-xs text-muted-foreground mb-4">เปอร์เซ็นต์การเชื่อมต่อสำเร็จในแต่ละชั่วโมง</p>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={uptimeData}>
            <defs>
              <linearGradient id="up" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.65 0.16 155)" stopOpacity={0.5} />
                <stop offset="95%" stopColor="oklch(0.65 0.16 155)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
            <XAxis dataKey="h" fontSize={11} stroke="oklch(0.5 0.03 250)" />
            <YAxis domain={[90, 100]} fontSize={11} stroke="oklch(0.5 0.03 250)" />
            <Tooltip contentStyle={{ borderRadius: 8 }} />
            <Area type="monotone" dataKey="uptime" stroke="oklch(0.65 0.16 155)" fill="url(#up)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold">รายการทรัพย์สิน</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Old Code</th>
              <th className="text-left px-4 py-3">ชื่อ</th>
              <th className="text-left px-4 py-3">สถานะ</th>
              <th className="text-left px-4 py-3">ตรวจล่าสุด</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {assets.map((a) => (
              <tr key={a.code} className="hover:bg-accent/30">
                <td className="px-4 py-3 font-mono text-xs">{a.code}</td>
                <td className="px-4 py-3 font-medium">{a.name}</td>
                <td className="px-4 py-3"><Badge tone={a.tone}>{a.status}</Badge></td>
                <td className="px-4 py-3 text-muted-foreground">{a.lastCheck}ที่แล้ว</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
