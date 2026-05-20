import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Wrench, Activity, AlertTriangle, CheckCircle2, TrendingUp, ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";
import { StatCard, PageHeader, Badge } from "@/components/ui-bits";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Asset History 360" },
      { name: "description", content: "ภาพรวมสถานะงาน PM, Claim, Monitoring ของป้ายโฆษณา PlanB Media" },
    ],
  }),
  component: Dashboard,
});

const trendData = [
  { month: "ม.ค.", pm: 42, claim: 18, monitor: 65 },
  { month: "ก.พ.", pm: 38, claim: 22, monitor: 70 },
  { month: "มี.ค.", pm: 51, claim: 15, monitor: 68 },
  { month: "เม.ย.", pm: 45, claim: 28, monitor: 72 },
  { month: "พ.ค.", pm: 60, claim: 12, monitor: 80 },
];

const deptData = [
  { name: "BKK", value: 1245 },
  { name: "UPC", value: 832 },
  { name: "Transit", value: 421 },
  { name: "Retail", value: 298 },
];

const statusData = [
  { name: "Finished", value: 68, color: "oklch(0.65 0.16 155)" },
  { name: "Working On", value: 22, color: "oklch(0.62 0.19 255)" },
  { name: "Pending", value: 10, color: "oklch(0.78 0.16 75)" },
];

const recent = [
  { id: "PB-A12048", type: "Claim", status: "Working On", title: "หลอด LED ดับบางส่วน", time: "5 นาทีที่แล้ว", tone: "info" as const },
  { id: "PB-A09112", type: "PM", status: "Finished", title: "บำรุงรักษาประจำเดือน", time: "1 ชั่วโมงที่แล้ว", tone: "success" as const },
  { id: "PB-A20451", type: "Monitor", status: "Error", title: "ระบบไม่ตอบสนอง", time: "2 ชั่วโมงที่แล้ว", tone: "danger" as const },
  { id: "PB-A11827", type: "Claim", status: "Pending", title: "โครงสร้างชำรุดจากลม", time: "4 ชั่วโมงที่แล้ว", tone: "warning" as const },
];

function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div
        className="rounded-2xl p-8 text-primary-foreground shadow-[var(--shadow-elegant)] relative overflow-hidden"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(circle at 80% 20%, white, transparent 50%)" }} />
        <div className="relative">
          <div className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70 font-medium">PlanB Media · Asset History 360</div>
          <h1 className="mt-2 text-3xl lg:text-4xl font-bold tracking-tight">ภาพรวมการบริหารทรัพย์สินสื่อโฆษณา</h1>
          <p className="mt-2 text-primary-foreground/80 max-w-2xl">
            ติดตามสถานะ PM, Claim และ Monitoring ของป้ายโฆษณาทั้งหมดในระบบ พร้อมวิเคราะห์ความสัมพันธ์ระหว่างการบำรุงรักษากับการเกิดเหตุขัดข้อง
          </p>
          <div className="mt-6 flex gap-3">
            <Link to="/search" className="inline-flex items-center gap-2 rounded-lg bg-card text-foreground px-4 py-2.5 text-sm font-medium hover:bg-card/90 transition">
              ค้นหาประวัติป้าย <ArrowRight className="size-4" />
            </Link>
            <Link to="/settings" className="inline-flex items-center gap-2 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-primary-foreground px-4 py-2.5 text-sm font-medium hover:bg-white/20 transition">
              ตั้งค่าระบบ
            </Link>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="ทรัพย์สินทั้งหมด" value="2,796" delta="ป้ายโฆษณาในระบบ" icon={<Activity className="size-5" />} tone="default" />
        <StatCard label="PM เดือนนี้" value="236" delta="+12% จากเดือนก่อน" icon={<CheckCircle2 className="size-5" />} tone="success" />
        <StatCard label="Claim ค้างอยู่" value="48" delta="Avg. 2.3 วันต่อรายการ" icon={<Wrench className="size-5" />} tone="warning" />
        <StatCard label="Error Monitoring" value="7" delta="ต้องดำเนินการด่วน" icon={<AlertTriangle className="size-5" />} tone="danger" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">แนวโน้มงานรายเดือน</h3>
              <p className="text-xs text-muted-foreground">เปรียบเทียบ PM, Claim และ Monitoring ใน 5 เดือนล่าสุด</p>
            </div>
            <TrendingUp className="size-4 text-muted-foreground" />
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="pm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.42 0.18 258)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="oklch(0.42 0.18 258)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="claim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.6 0.22 25)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="oklch(0.6 0.22 25)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="mon" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.65 0.16 155)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="oklch(0.65 0.16 155)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
              <XAxis dataKey="month" stroke="oklch(0.5 0.03 250)" fontSize={12} />
              <YAxis stroke="oklch(0.5 0.03 250)" fontSize={12} />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid oklch(0.92 0.015 245)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="pm" name="PM" stroke="oklch(0.42 0.18 258)" fill="url(#pm)" strokeWidth={2} />
              <Area type="monotone" dataKey="claim" name="Claim" stroke="oklch(0.6 0.22 25)" fill="url(#claim)" strokeWidth={2} />
              <Area type="monotone" dataKey="monitor" name="Monitoring" stroke="oklch(0.65 0.16 155)" fill="url(#mon)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <h3 className="font-semibold">สถานะงานปัจจุบัน</h3>
          <p className="text-xs text-muted-foreground mb-4">สัดส่วนสถานะของงาน Active ทั้งหมด</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusData} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {statusData.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                  <span>{s.name}</span>
                </div>
                <span className="font-semibold">{s.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <h3 className="font-semibold mb-1">กิจกรรมล่าสุด</h3>
          <p className="text-xs text-muted-foreground mb-4">รายการล่าสุดจาก PM, Claim และ Monitoring</p>
          <div className="divide-y">
            {recent.map((r) => (
              <div key={r.id} className="py-3 flex items-center gap-4">
                <div className="size-10 rounded-lg bg-muted grid place-items-center text-xs font-bold text-muted-foreground">
                  {r.type[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{r.title}</span>
                    <Badge tone={r.tone}>{r.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.id} · {r.type} · {r.time}
                  </div>
                </div>
                <button className="text-xs text-primary hover:underline">ดูรายละเอียด</button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <h3 className="font-semibold mb-1">งานตาม Department</h3>
          <p className="text-xs text-muted-foreground mb-4">จำนวนทรัพย์สินแต่ละสังกัด</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={deptData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" horizontal={false} />
              <XAxis type="number" stroke="oklch(0.5 0.03 250)" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="oklch(0.5 0.03 250)" fontSize={12} width={60} />
              <Tooltip contentStyle={{ borderRadius: 8 }} />
              <Bar dataKey="value" fill="oklch(0.42 0.18 258)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
