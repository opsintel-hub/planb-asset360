import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Database, KeyRound, RefreshCw, CheckCircle2, AlertCircle, Plus, Server } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "ตั้งค่าระบบ — Asset History 360" },
      { name: "description", content: "ตั้งค่าการเชื่อมต่อฐานข้อมูล Asset, API Claim Aging และ Airtable" },
    ],
  }),
  component: SettingsPage,
});

const syncLogs = [
  { time: "2026-05-20 04:00:12", status: "success", msg: "Asset sync OK — 2,796 rows" },
  { time: "2026-05-20 03:45:00", status: "success", msg: "Claim Aging OK — 48 tickets" },
  { time: "2026-05-20 03:30:00", status: "warning", msg: "Schema change detected: Asset.new_field" },
  { time: "2026-05-20 03:15:00", status: "success", msg: "Claim Aging OK — 48 tickets" },
];

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

      {active === "main" && (
        <div className="space-y-6">
          <Section title="ฐานข้อมูล Asset (Modern Corporate)" desc="การเชื่อมต่อหลักสำหรับดึงข้อมูลทรัพย์สินป้ายโฆษณา">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Server (host:port)" defaultValue="magicticket.magicsigncloud.com" />
              <Field label="Database" defaultValue="planb" />
              <Field label="User" defaultValue="planb_viewer" />
              <Field label="Table" defaultValue="Asset" />
              <Field label="Password" type="password" placeholder="••••••••  (จัดเก็บใน Secret — เว้นว่างหากไม่เปลี่ยน)" />
            </div>

            <AutoSyncMonthly />

            <div className="flex gap-2">
              <PrimaryBtn><RefreshCw className="size-4" /> ทดสอบการ Sync</PrimaryBtn>
              <GhostBtn>บันทึก</GhostBtn>
            </div>
          </Section>

          <Section title="API ค้นหาประวัติ Asset" desc="แสดงผลใน Dashboard และตาราง">
            <Field full label="API Endpoint" defaultValue="https://uat-magicticket.magicsigncloud.com/planb_api/api/Ticket/AssetHistory?oldCode={id}" />
            <div className="flex gap-2">
              <PrimaryBtn><RefreshCw className="size-4" /> ทดสอบ</PrimaryBtn>
            </div>
          </Section>

          <Section title="API Claim Aging" desc="Auto-Sync ทุก 15 นาทีโดยอัตโนมัติ">
            <Field full label="API Endpoint" defaultValue="https://magicticket.magicsigncloud.com/planb_api/api/Ticket/RemainingClaimTickets" />
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" defaultChecked className="accent-primary" />
                เปิด Auto-Sync (ทุก 15 นาที)
              </label>
              <Badge tone="success"><CheckCircle2 className="inline size-3 mr-1" /> Active</Badge>
            </div>
          </Section>

          <Section title="Sync Logs (60 ครั้งล่าสุด)" desc="ผลการเชื่อมต่อย้อนหลัง">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5">เวลา</th>
                    <th className="text-left px-4 py-2.5">สถานะ</th>
                    <th className="text-left px-4 py-2.5">ข้อความ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {syncLogs.map((l, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5 font-mono text-xs">{l.time}</td>
                      <td className="px-4 py-2.5">
                        {l.status === "success" ? <Badge tone="success">Success</Badge> : <Badge tone="warning">Schema Alert</Badge>}
                      </td>
                      <td className="px-4 py-2.5">{l.msg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {active === "airtable" && <AirtableSection />}
    </div>
  );
}

function AutoSyncMonthly() {
  const [days, setDays] = useState<number[]>([1, 15]);
  const toggle = (d: number) => {
    if (days.includes(d)) setDays(days.filter((x) => x !== d));
    else if (days.length < 4) setDays([...days, d].sort((a, b) => a - b));
  };
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-medium text-sm">Auto-Sync รายเดือน (เวลา 04:00)</div>
          <div className="text-xs text-muted-foreground">เลือกได้สูงสุด 4 วัน — เลือกแล้ว {days.length}/4</div>
        </div>
      </div>
      <div className="grid grid-cols-7 sm:grid-cols-15 gap-1.5">
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <button key={d} onClick={() => toggle(d)} className={cn(
            "h-9 rounded-md text-xs font-medium transition border",
            days.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent",
            !days.includes(d) && days.length >= 4 && "opacity-40 cursor-not-allowed",
          )}>{d}</button>
        ))}
      </div>
    </div>
  );
}

function AirtableSection() {
  const [slots] = useState(Array.from({ length: 8 }, (_, i) => ({ id: i + 1 })));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Database className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold">Airtable Connections</h3>
            <p className="text-xs text-muted-foreground">รองรับ 8 ช่องการเชื่อมต่อ พร้อมเลือกเวลา Auto-Sync ได้สูงสุด 12 เวลา/ช่อง</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {slots.map((s) => <AirtableSlot key={s.id} index={s.id} />)}
        </div>
      </div>
    </div>
  );
}

function AirtableSlot({ index }: { index: number }) {
  const [enabled, setEnabled] = useState(index <= 2);
  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-7 rounded-md bg-primary/10 text-primary grid place-items-center text-xs font-bold">{index}</span>
          <input placeholder="ชื่อการเชื่อมต่อ" defaultValue={index === 1 ? "Insurance Data" : index === 2 ? "Power Supply" : ""} className="bg-transparent text-sm font-medium focus:outline-none placeholder:text-muted-foreground" />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-primary" />
          {enabled ? "เปิด" : "ปิด"}
        </label>
      </div>
      <input placeholder="Base ID / API Endpoint" className="w-full h-9 rounded-md border bg-card px-3 text-sm" />
      <div className="flex gap-2">
        <button className="text-xs text-primary hover:underline">+ เลือกเวลา Auto-Sync (สูงสุด 12)</button>
        <button className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <RefreshCw className="size-3" /> ทดสอบ
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

function Field({ label, defaultValue, type = "text", placeholder, full }: { label: string; defaultValue?: string; type?: string; placeholder?: string; full?: boolean }) {
  return (
    <div className={cn(full && "md:col-span-2")}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input type={type} defaultValue={defaultValue} placeholder={placeholder} className="mt-1 w-full h-10 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );
}

function PrimaryBtn({ children }: { children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition">{children}</button>;
}
function GhostBtn({ children }: { children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition">{children}</button>;
}
