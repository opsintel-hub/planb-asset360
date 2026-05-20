import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Plus, X, Filter, Download, Calendar } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { PageHeader, StatCard, Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "ค้นหาประวัติป้ายโฆษณา — Asset History 360" },
      { name: "description", content: "ค้นหาและเปรียบเทียบประวัติการบำรุงรักษา งานซ่อม และ Monitoring ของป้ายโฆษณา" },
    ],
  }),
  component: SearchPage,
});

const tabs = [
  { id: "pm", label: "PM (Preventive Maintenance)" },
  { id: "claim", label: "Claim (เคลม/แจ้งซ่อม)" },
  { id: "monitor", label: "Monitoring (ตรวจสื่อ)" },
  { id: "health", label: "Asset Health 360" },
] as const;

const healthData = Array.from({ length: 12 }, (_, i) => ({
  m: `${i + 1}`,
  pm: Math.round(8 + Math.sin(i / 2) * 3 + Math.random() * 2),
  claim: Math.round(3 + Math.cos(i / 1.5) * 2 + Math.random() * 2),
  monitor: Math.round(15 + Math.sin(i) * 4 + Math.random() * 3),
}));

const pmRows = [
  { date: "2026-05-12", code: "PB-A12048", tech: "สมชาย ใจดี", task: "ทำความสะอาด + เปลี่ยนหลอด", status: "Finished", duration: "1h 20m" },
  { date: "2026-05-08", code: "PB-A09112", tech: "วิทยา ขยัน", task: "ตรวจระบบไฟ", status: "Finished", duration: "45m" },
  { date: "2026-05-02", code: "PB-A20451", tech: "ประยุทธ์ มั่นคง", task: "PM ประจำเดือน", status: "Pending", duration: "—" },
  { date: "2026-04-28", code: "PB-A11827", tech: "สมศักดิ์ รักงาน", task: "เปลี่ยนพัดลมระบายอากาศ", status: "Finished", duration: "2h 10m" },
];

function SearchPage() {
  const [active, setActive] = useState<typeof tabs[number]["id"]>("pm");
  const [codes, setCodes] = useState<string[]>([""]);
  const [views, setViews] = useState({ pm: true, claim: true, monitor: false });

  const addCode = () => codes.length < 5 && setCodes([...codes, ""]);
  const removeCode = (i: number) => setCodes(codes.filter((_, x) => x !== i));
  const updateCode = (i: number, v: string) => setCodes(codes.map((c, x) => (x === i ? v : c)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="ค้นหาประวัติป้ายโฆษณา"
        subtitle="ค้นหาจาก Old Code หรือชื่อทรัพย์สิน เปรียบเทียบได้สูงสุด 5 ป้าย"
        actions={
          <button className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90 transition">
            <Download className="size-4" /> Export
          </button>
        }
      />

      {/* Search + comparison fields */}
      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-4">
        <div className="space-y-2.5">
          {codes.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={c}
                  onChange={(e) => updateCode(i, e.target.value)}
                  placeholder={i === 0 ? "Old Code หรือชื่อทรัพย์สิน เช่น PB-A12048" : `เปรียบเทียบป้ายที่ ${i + 1}`}
                  className="w-full h-10 rounded-lg border bg-background pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {i === codes.length - 1 && codes.length < 5 && (
                <button onClick={addCode} className="size-10 rounded-lg border bg-background grid place-items-center hover:bg-accent transition" title="เพิ่มป้ายเปรียบเทียบ">
                  <Plus className="size-4" />
                </button>
              )}
              {codes.length > 1 && (
                <button onClick={() => removeCode(i)} className="size-10 rounded-lg border bg-background grid place-items-center hover:bg-destructive/10 hover:text-destructive transition">
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <Filter className="size-4 text-muted-foreground" />
          <FilterChip label="Project / Department" value="ทั้งหมด" />
          <FilterChip label="BKK / UPC" value="BKK" />
          <FilterChip label="Media Type" value="LED Billboard" />
          <div className="ml-auto inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm">
            <Calendar className="size-4 text-muted-foreground" />
            <span>1 ม.ค. 2026 — ปัจจุบัน</span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="PM ทั้งหมด" value="48" delta="ใน 5 เดือน" tone="default" />
        <StatCard label="Claim ทั้งหมด" value="12" delta="MTBF เฉลี่ย 18 วัน" tone="warning" />
        <StatCard label="Monitoring" value="186" delta="Uptime 98.4%" tone="success" />
        <StatCard label="Error ที่พบ" value="3" delta="ต้องตรวจสอบ" tone="danger" />
      </div>

      {/* Tabs */}
      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                "px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition",
                active === t.id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {active === "pm" && <PMTab />}
          {active === "claim" && <ClaimTab />}
          {active === "monitor" && <MonitorTab />}
          {active === "health" && <HealthTab views={views} setViews={setViews} />}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-accent transition">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </button>
  );
}

function ChartWrap({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border bg-background/50 p-4">
      <h4 className="font-semibold text-sm">{title}</h4>
      {subtitle && <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>}
      <ResponsiveContainer width="100%" height={260}>{children as any}</ResponsiveContainer>
    </div>
  );
}

function PMTab() {
  return (
    <div className="space-y-5">
      <ChartWrap title="ตารางความถี่งาน PM ตามเดือน" subtitle="วันที่วางแผน vs จำนวนงานที่เสร็จ">
        <LineChart data={healthData}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
          <XAxis dataKey="m" fontSize={12} stroke="oklch(0.5 0.03 250)" />
          <YAxis fontSize={12} stroke="oklch(0.5 0.03 250)" />
          <Tooltip contentStyle={{ borderRadius: 8 }} />
          <Line type="monotone" dataKey="pm" name="PM" stroke="oklch(0.42 0.18 258)" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ChartWrap>

      <div>
        <h4 className="font-semibold text-sm mb-3">รายการ PM</h4>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5">วันที่</th>
                <th className="text-left px-4 py-2.5">Old Code</th>
                <th className="text-left px-4 py-2.5">ช่าง</th>
                <th className="text-left px-4 py-2.5">รายการ</th>
                <th className="text-left px-4 py-2.5">ใช้เวลา</th>
                <th className="text-left px-4 py-2.5">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pmRows.map((r) => (
                <tr key={r.code + r.date} className="hover:bg-accent/30">
                  <td className="px-4 py-3">{r.date}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-3">{r.tech}</td>
                  <td className="px-4 py-3">{r.task}</td>
                  <td className="px-4 py-3">{r.duration}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.status === "Finished" ? "success" : "warning"}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 bg-muted/30 text-xs text-muted-foreground">
            <span>แสดง 1–4 จาก 48 รายการ</span>
            <div className="flex items-center gap-1">
              <select className="rounded border bg-background px-2 py-1">
                <option>10</option><option>20</option>
              </select>
              <button className="rounded border bg-background px-2.5 py-1 hover:bg-accent">‹</button>
              <button className="rounded border bg-background px-2.5 py-1 hover:bg-accent">›</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClaimTab() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartWrap title="Response & Resolve Time" subtitle="เวลาตอบสนองและปิดงานเฉลี่ยรายเดือน">
          <LineChart data={healthData}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
            <XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} />
            <Tooltip contentStyle={{ borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="claim" name="Response (h)" stroke="oklch(0.6 0.22 25)" strokeWidth={2.5} />
            <Line type="monotone" dataKey="pm" name="Resolve (h)" stroke="oklch(0.42 0.18 258)" strokeWidth={2.5} />
          </LineChart>
        </ChartWrap>

        <ChartWrap title="หมวด Solution ที่พบบ่อย" subtitle="กลุ่มอาการเสียและวิธีการแก้ไข">
          <LineChart data={healthData}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
            <XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} />
            <Tooltip contentStyle={{ borderRadius: 8 }} />
            <Line type="monotone" dataKey="monitor" name="LED Failure" stroke="oklch(0.65 0.16 155)" strokeWidth={2.5} />
          </LineChart>
        </ChartWrap>
      </div>

      <div className="rounded-lg border p-4 bg-primary/5">
        <h4 className="font-semibold text-sm">ประสิทธิภาพการทำงานของช่าง</h4>
        <div className="grid grid-cols-3 gap-4 mt-3">
          <Metric label="Response Time" value="1.8 ชม." />
          <Metric label="Resolve Time" value="6.4 ชม." />
          <Metric label="Turn Around Time" value="8.2 ชม." />
        </div>
      </div>
    </div>
  );
}

function MonitorTab() {
  return (
    <div className="space-y-5">
      <ChartWrap title="สถานะการเชื่อมต่อ — Uptime รายเดือน" subtitle="จำนวนครั้งที่ตรวจพบเทียบกับ Error อัตโนมัติ">
        <LineChart data={healthData}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
          <XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} />
          <Tooltip contentStyle={{ borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="monitor" name="Working On" stroke="oklch(0.65 0.16 155)" strokeWidth={2.5} />
          <Line type="monotone" dataKey="claim" name="Error" stroke="oklch(0.6 0.22 25)" strokeWidth={2.5} />
        </LineChart>
      </ChartWrap>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric label="Uptime เฉลี่ย" value="98.4%" />
        <Metric label="Avg Check Interval" value="4.2 ชม." />
        <Metric label="Auto-Detected Errors" value="14" />
      </div>
    </div>
  );
}

function HealthTab({ views, setViews }: { views: { pm: boolean; claim: boolean; monitor: boolean }; setViews: (v: any) => void }) {
  const [mode, setMode] = useState<"graph" | "table" | "calendar">("graph");
  const [pmFreq, setPmFreq] = useState(30);
  const [debt, setDebt] = useState(0);
  const [responseHrs, setResponseHrs] = useState(2);

  const reducedClaim = Math.max(2, Math.round(20 - (30 / pmFreq) * 6));
  const uptime = Math.max(85, Math.min(99.9, 99.5 - responseHrs * 0.4)).toFixed(1);
  const debtRisk = Math.min(95, 15 + debt * 18);

  return (
    <div className="space-y-5">
      {/* Multi-select + view mode */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
          {(["pm", "claim", "monitor"] as const).map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={views[k]} onChange={(e) => setViews({ ...views, [k]: e.target.checked })} className="accent-primary" />
              {k.toUpperCase()}
            </label>
          ))}
        </div>
        <div className="ml-auto inline-flex rounded-lg border bg-background p-1">
          {(["graph", "table", "calendar"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("px-3 py-1.5 text-xs font-medium rounded-md capitalize", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Trend overlay */}
      {mode === "graph" && (
        <ChartWrap title="Trend Overlay — ความสัมพันธ์ PM × Claim × Monitoring" subtitle="ดูว่า PM ครั้งล่าสุดช่วยลดเหตุ Claim หรือไม่">
          <LineChart data={healthData}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 245)" />
            <XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} />
            <Tooltip contentStyle={{ borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
            {views.pm && <Line type="monotone" dataKey="pm" name="PM" stroke="oklch(0.42 0.18 258)" strokeWidth={2.5} />}
            {views.claim && <Line type="monotone" dataKey="claim" name="Claim" stroke="oklch(0.6 0.22 25)" strokeWidth={2.5} />}
            {views.monitor && <Line type="monotone" dataKey="monitor" name="Monitor" stroke="oklch(0.65 0.16 155)" strokeWidth={2.5} />}
          </LineChart>
        </ChartWrap>
      )}

      {mode === "table" && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr><th className="text-left px-4 py-2.5">เดือน</th><th className="text-left px-4 py-2.5">PM</th><th className="text-left px-4 py-2.5">Claim</th><th className="text-left px-4 py-2.5">Monitor</th></tr>
            </thead>
            <tbody className="divide-y">
              {healthData.map((d) => (
                <tr key={d.m} className="hover:bg-accent/30">
                  <td className="px-4 py-2.5">{d.m}</td><td className="px-4 py-2.5">{d.pm}</td><td className="px-4 py-2.5">{d.claim}</td><td className="px-4 py-2.5">{d.monitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "calendar" && (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, i) => {
            const hasPm = i % 7 === 2;
            const hasClaim = i % 11 === 0;
            const hasMon = i % 5 === 0;
            return (
              <div key={i} className="aspect-square rounded-md border bg-background p-1.5 text-xs">
                <div className="text-muted-foreground">{i + 1}</div>
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {hasPm && views.pm && <span className="size-1.5 rounded-full bg-primary" />}
                  {hasClaim && views.claim && <span className="size-1.5 rounded-full bg-destructive" />}
                  {hasMon && views.monitor && <span className="size-1.5 rounded-full bg-success" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MTBF cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric label="MTBF (Claim)" value="18.2 วัน" hint="ระยะเวลาเฉลี่ยระหว่างเหตุเสีย" />
        <Metric label="PM Cycle" value="30 วัน" hint="ความถี่บำรุงรักษาเฉลี่ย" />
        <Metric label="Monitoring Cycle" value="4.2 ชม." hint="ความถี่ตรวจสื่อเฉลี่ย" />
      </div>

      {/* Simulators */}
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-5 space-y-5">
        <h4 className="font-semibold flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" /> Simulator — จำลองผลลัพธ์
        </h4>

        <SimulatorRow
          title="PM Frequency Simulator"
          desc="ปรับรอบ PM เพื่อจำลองว่า Claim จะลดลงเท่าไร (อิงจาก MTBF)"
          value={pmFreq} min={7} max={60} unit="วัน" onChange={setPmFreq}
          result={`คาดการณ์ Claim/เดือน: ${reducedClaim} ครั้ง (เดิม ~12)`}
        />
        <SimulatorRow
          title="Maintenance Debt Simulator"
          desc="เลื่อนแผน PM ออกไป จะเกิด 'หนี้บำรุงรักษา' ดังต่อไปนี้"
          value={debt} min={0} max={3} unit="เดือน" onChange={setDebt}
          result={`Risk of Failure: ${debtRisk}%`}
          danger
        />
        <SimulatorRow
          title="Service Level Simulator"
          desc="ปรับ Response Time เพื่อดูผลต่อ System Availability"
          value={responseHrs} min={1} max={12} unit="ชม." onChange={setResponseHrs}
          result={`System Availability: ${uptime}%`}
        />
      </div>
    </div>
  );
}

function SimulatorRow({ title, desc, value, min, max, unit, onChange, result, danger }: {
  title: string; desc: string; value: number; min: number; max: number; unit: string;
  onChange: (n: number) => void; result: string; danger?: boolean;
}) {
  return (
    <div className="rounded-lg bg-card border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-semibold text-sm">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <span className={cn("text-sm font-bold rounded-full px-3 py-1", danger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          {result}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-primary" />
        <span className="text-sm font-medium w-20 text-right">{value} {unit}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
