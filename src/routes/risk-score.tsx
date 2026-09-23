// Per-asset risk score breakdown — explains how the 0–100 score is composed.
// Reads the nightly-computed public.asset_risk_scores (no AI, no paid API).
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldAlert,
  ShieldCheck,
  Search as SearchIcon,
  Info,
  ClipboardList,
  Download,
  FilterX,
  Navigation as NavIcon,
  Wrench,
  CalendarClock,
  CircleCheckBig,
  FileDown,
  Loader2,
  Presentation,
  Layers3,
} from "lucide-react";
import { toast } from "sonner";
import SearchableSelect from "@/components/searchable-select";
import { projectForDepartment } from "@/lib/project-department-map";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMyRoles } from "@/hooks/use-my-roles";
import { RiskChip, useAssetRiskMap, type AssetRisk } from "@/components/asset-risk";
import { RISK_PIN_COLORS, RISK_LABELS, isUrgentRisk } from "@/lib/risk-colors";
import { getAssetHistorySummary, getAssetRisk, listOpenClaimCounts } from "@/lib/route-risk.functions";
import {
  exportRiskOverviewPptx,
  exportRiskReportPptx,
  type RiskOverviewGroup,
} from "@/lib/risk-report-export";

export const Route = createFileRoute("/risk-score")({
  head: () => ({
    meta: [
      { title: "คะแนนความเสี่ยงรายป้าย — Risk Breakdown" },
      {
        name: "description",
        content:
          "ดูคะแนนความเสี่ยงรายป้ายแยกองค์ประกอบ: เคลม 30/90/365 วัน, เคลมค้างเปิด, วันตั้งแต่ PM ล่าสุด และปัญหาที่พบซ้ำ",
      },
      { property: "og:title", content: "คะแนนความเสี่ยงรายป้าย — Risk Breakdown" },
      {
        property: "og:description",
        content: "แยกองค์ประกอบคะแนนความเสี่ยง 0–100 ของแต่ละป้าย พร้อมกราฟสรุปทันที",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RiskScorePage,
});

/** Mirrors public.recompute_asset_risk_scores() so the UI can explain the score. */
function breakdown(r: AssetRisk) {
  const parts = [
    {
      key: "open",
      label: "เคลมค้างเปิด",
      max: 40,
      value: 40 * (r.openClaims > 0 ? 1 : 0),
      detail: r.openClaims > 0 ? `${r.openClaims} ตั๋วค้าง` : "ไม่มีตั๋วค้าง",
    },
    {
      key: "c30",
      label: "เคลม 30 วัน",
      max: 25,
      value: 25 * (Math.min(r.claims30d, 2) / 2),
      detail: `${r.claims30d} ครั้ง (เต็มที่ 2)`,
    },
    {
      key: "c90",
      label: "เคลม 90 วัน",
      max: 15,
      value: 15 * (Math.min(r.claims90d, 4) / 4),
      detail: `${r.claims90d} ครั้ง (เต็มที่ 4)`,
    },
    {
      key: "c365",
      label: "เคลม 365 วัน",
      max: 10,
      value: 10 * (Math.min(r.claims365d, 8) / 8),
      detail: `${r.claims365d} ครั้ง (เต็มที่ 8)`,
    },
    {
      key: "pm",
      label: "วันตั้งแต่ PM ล่าสุด",
      max: 10,
      value: 10 * (Math.min(r.daysSincePm ?? 0, 180) / 180),
      detail: r.daysSincePm != null ? `${r.daysSincePm} วัน (เต็มที่ 180)` : "ไม่มีข้อมูล PM",
    },
  ];
  return parts.map((p) => ({ ...p, value: Math.round(p.value * 10) / 10 }));
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMonth(v: string) {
  return new Date(v).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });
}

function eventDescription(event: {
  type: "Claim" | "PM";
  problemCategory: string | null;
  problemEquipment: string | null;
  solutionDetail: string | null;
}) {
  if (event.type === "PM") return event.solutionDetail || event.problemCategory || "บำรุงรักษาเชิงป้องกัน";
  return event.problemEquipment || event.problemCategory || "รับแจ้งปัญหา";
}

/** Inspection guidance derived from the same signals as the score. */
function advice(r: AssetRisk) {
  const actions: { title: string; detail: string; owner: string; deadline: string; done: string }[] = [];
  if (r.openClaims > 0) actions.push({
    title: `เคลียร์เคลมค้าง ${r.openClaims} ตั๋ว`,
    detail: `เปิดใบงานเดิม ตรวจหน้างานและยืนยันสาเหตุจริง${r.topProblem ? ` โดยเริ่มที่ ${r.topProblem}` : ""} ห้ามปิดงานจากสถานะในระบบเพียงอย่างเดียว`,
    owner: "ทีมซ่อม + ผู้ควบคุมงาน",
    deadline: r.level === "critical" ? "ภายใน 24 ชม." : "ภายใน 3 วัน",
    done: "มีภาพหลังซ่อม ผลทดสอบ และปิดตั๋วครบ",
  });
  if (r.claims30d >= 2 || r.claims90d >= 2) actions.push({
    title: "ทำ Root Cause Analysis อาการเสียซ้ำ",
    detail: "ตรวจไฟต้นทาง สายไฟ จุดต่อ โคม/อุปกรณ์ และทบทวนอะไหล่ที่เปลี่ยนครั้งก่อน แก้ที่ต้นเหตุแทนการแก้อาการ",
    owner: "วิศวกรหน้างาน",
    deadline: r.level === "critical" ? "ภายใน 48 ชม." : "ภายใน 7 วัน",
    done: "ระบุสาเหตุหลักและมาตรการป้องกันการเกิดซ้ำ",
  });
  if ((r.daysSincePm ?? 0) >= 90 || r.lastPmAt == null) actions.push({
    title: "ทำ Full PM และบันทึกค่าก่อน–หลัง",
    detail: "ทำความสะอาด ขันแน่น ตรวจความร้อน วัดแรงดัน/กระแส และทดสอบเปิดใช้งานจริงหลังจบงาน",
    owner: "ทีม PM",
    deadline: r.level === "critical" ? "ภายใน 48 ชม." : "รอบ PM ถัดไป",
    done: "Checklist ครบ พร้อมค่าที่วัดได้และภาพหลักฐาน",
  });
  if (actions.length === 0) actions.push({
    title: "ตรวจยืนยันตามรอบ PM",
    detail: "ตรวจสภาพและทดสอบการทำงานตาม Checklist มาตรฐาน พร้อมบันทึกภาพก่อน–หลัง",
    owner: "ทีม PM",
    deadline: "ตามรอบปกติ",
    done: "Checklist ผ่านครบทุกหัวข้อ",
  });

  const queue =
    r.level === "critical"
      ? {
          tone: "critical" as const,
          title: "จัดคิวตรวจ: วิกฤต — ภายใน 48 ชั่วโมง",
          text: "ยกระดับเป็นงานเร่งด่วนที่สุด แจ้งหัวหน้าทีมทันที จัดคนเข้าตรวจ/ซ่อมก่อนงานอื่น และติดตามผลจนปิดเคลม",
        }
      : r.level === "high"
      ? {
          tone: "high" as const,
          title: "จัดคิวตรวจ: ด่วน — ภายใน 7 วัน",
          text: "ใส่ไว้ในวันแรก ๆ ของรอบตรวจ (เปิดโหมด “จัดลำดับตามความเสี่ยง” ในหน้า Route Monitoring) เตรียมอะไหล่ตามหมวดปัญหาที่พบซ้ำไปด้วย และถ้าเคลมยังค้าง ให้ประสานทีมซ่อมก่อนออกตรวจ",
        }
      : r.level === "medium"
        ? {
            tone: "medium" as const,
            title: "จัดคิวตรวจ: เฝ้าระวัง — ภายใน 30 วัน",
            text: "รวมเข้ากับรอบตรวจปกติของโซนนั้น แต่อย่าเลื่อนออกไปอีกรอบ ถ้าพบอาการเดิมซ้ำให้ยกระดับเป็นด่วนทันที",
          }
        : {
            tone: "low" as const,
            title: "จัดคิวตรวจ: ตามรอบปกติ",
            text: "ตรวจตามรอบ PM ที่วางไว้ ไม่ต้องแทรกคิว",
          };

  return { actions: actions.slice(0, 3), queue };
}

function RiskDetail({ code, liveOpenClaims }: { code: string; liveOpenClaims?: number }) {
  const [exporting, setExporting] = useState(false);
  const fn = useServerFn(getAssetRisk);
  const historyFn = useServerFn(getAssetHistorySummary);
  const { data, isLoading } = useQuery({
    queryKey: ["asset-risk", code],
    queryFn: () => fn({ data: { code } }),
    staleTime: 10 * 60 * 1000,
    enabled: !!code,
  });
  const historyQ = useQuery({
    queryKey: ["asset-risk-history-360", code],
    queryFn: () => historyFn({ data: { code } }),
    staleTime: 10 * 60 * 1000,
    enabled: !!code,
  });

  if (isLoading || historyQ.isLoading) return <Skeleton className="aspect-video min-h-[620px] w-full" />;
  const baseRisk = data?.risk ?? null;
  const risk = baseRisk && liveOpenClaims != null ? { ...baseRisk, openClaims: liveOpenClaims } : baseRisk;
  if (!risk)
    return (
      <div className="rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
        ไม่พบคะแนนความเสี่ยงของ {code} (แปลว่าไม่มีสัญญาณเสี่ยงเลย = เสี่ยงต่ำ)
      </div>
    );

  const parts = breakdown(risk);
  const summary = historyQ.data?.summary;
  const recentEvents = summary?.events.slice(0, 6) ?? [];
  const monthly = Array.from({ length: 12 }, (_, offset) => {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - offset), 1));
    const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    const events = summary?.events.filter((event) => event.eventAt.slice(0, 7) === key) ?? [];
    return { key, label: fmtMonth(month.toISOString()), claims: events.filter((e) => e.type === "Claim").length, pm: events.filter((e) => e.type === "PM").length };
  });
  const { actions, queue } = advice(risk);

  const exportPowerPoint = async () => {
    if (!summary) return;
    setExporting(true);
    try {
      await exportRiskReportPptx({
        risk,
        summary,
        months: monthly,
        actions,
        queueTitle: queue.title,
      });
      toast.success("ดาวน์โหลด PowerPoint แบบแก้ไขได้แล้ว");
    } catch (error) {
      console.error("Risk report PowerPoint export failed", error);
      toast.error("ส่งออก PowerPoint ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button type="button" size="sm" onClick={() => void exportPowerPoint()} disabled={exporting || !summary}>
          {exporting ? <Loader2 className="animate-spin" /> : <FileDown />}
          {exporting ? "กำลังสร้าง PowerPoint…" : "Export to PowerPoint (.pptx)"}
        </Button>
      </div>
    <section className="flex min-h-[640px] flex-col overflow-hidden rounded-lg border bg-background shadow-[var(--shadow-elegant)] lg:aspect-video lg:min-h-0">
      <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            {risk.level === "low" ? (
              <ShieldCheck className="size-5" />
            ) : (
              <ShieldAlert className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-mono text-xl font-bold text-primary">{risk.code}</h2>
            <RiskChip level={risk.level} score={risk.score} />
            </div>
            <p className="text-[11px] text-muted-foreground">รายงานเพื่อการตัดสินใจและสั่งการซ่อมบำรุง</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">คะแนนความเสี่ยงรวม</div>
          <div className={cn("text-4xl font-black tabular-nums", isUrgentRisk(risk.level) ? "text-destructive" : "text-primary")}>
            {risk.score}<span className="text-sm font-normal text-muted-foreground">/100</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 bg-muted/20 p-4">
        <div className="col-span-7 flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="border-l-4 border-destructive bg-card px-3 py-2 shadow-[var(--shadow-card)]">
              <div className="text-[10px] font-semibold text-destructive">CLAIM · 360 วัน</div>
              <div className="text-2xl font-bold text-destructive">{summary?.claimTotal ?? 0} <span className="text-xs font-normal">ครั้ง</span></div>
              <div className="text-[10px] text-muted-foreground">เฉลี่ย {summary?.claimAveragePerMonth ?? 0} ครั้ง/เดือน</div>
            </div>
            <div className="border-l-4 border-primary bg-card px-3 py-2 shadow-[var(--shadow-card)]">
              <div className="text-[10px] font-semibold text-primary">PM · 360 วัน</div>
              <div className="text-2xl font-bold text-primary">{summary?.pmTotal ?? 0} <span className="text-xs font-normal">ครั้ง</span></div>
              <div className="text-[10px] text-muted-foreground">เฉลี่ย {summary?.pmAveragePerMonth ?? 0} ครั้ง/เดือน</div>
            </div>
            <div className="border-l-4 border-warning bg-card px-3 py-2 shadow-[var(--shadow-card)]">
              <div className="text-[10px] font-semibold text-warning-foreground">สัญญาณหลัก</div>
              <div className="truncate text-sm font-bold">{risk.topProblem ?? "ไม่ระบุหมวด"}</div>
              <div className="text-[10px] text-muted-foreground">PM ล่าสุด {fmtDate(risk.lastPmAt)}</div>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-card p-3 shadow-[var(--shadow-card)]">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">Claim & PM รายเดือน</h3>
              <div className="flex gap-3 text-[10px] text-muted-foreground"><span>● <b className="text-destructive">Claim</b></span><span>● <b className="text-primary">PM</b></span></div>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {monthly.map((month) => (
                <div key={month.key} className={cn("min-h-11 border px-1.5 py-1", (month.claims || month.pm) ? "bg-muted/40" : "bg-background")}>
                  <div className="truncate text-[9px] font-medium">{month.label}</div>
                  <div className="mt-1 flex gap-1 text-[9px] font-semibold">
                    {month.claims > 0 && <span className="text-destructive">C {month.claims}</span>}
                    {month.pm > 0 && <span className="text-primary">P {month.pm}</span>}
                    {!month.claims && !month.pm && <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t pt-2">
              <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">รายการล่าสุด</div>
              <div className="grid gap-1">
                {recentEvents.length === 0 ? <p className="text-xs text-muted-foreground">ไม่พบประวัติในช่วง 360 วัน</p> : recentEvents.map((event) => (
                  <div key={`${event.refNumber}-${event.eventAt}`} className="grid grid-cols-[70px_42px_minmax(0,1fr)_58px] items-center gap-2 border-l-2 border-border bg-muted/20 px-2 py-1 text-[10px]">
                    <span className="font-semibold">{fmtDate(event.eventAt)}</span>
                    <span className={event.type === "Claim" ? "font-bold text-destructive" : "font-bold text-primary"}>{event.type}</span>
                    <span className="truncate">{eventDescription(event)}</span>
                    <span className="truncate text-right text-muted-foreground">{event.status ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-5 flex min-w-0 flex-col gap-3">
          <div className="bg-card p-3 shadow-[var(--shadow-card)]">
            <h3 className="mb-2 text-xs font-bold">องค์ประกอบคะแนน <span className="font-normal text-muted-foreground">(ย่อ)</span></h3>
            <div className="grid gap-1.5">
              {parts.map((part) => (
                <div key={part.key}>
                  <div className="mb-0.5 flex justify-between text-[9px]"><span>{part.label}</span><span className="font-semibold tabular-nums">{part.value}/{part.max}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", isUrgentRisk(risk.level) ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, part.value / part.max * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className={cn("min-h-0 flex-1 border p-3", queue.tone === "critical" || queue.tone === "high" ? "border-destructive/50 bg-destructive/5" : "border-warning/50 bg-warning/5")}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div><h3 className="flex items-center gap-1.5 text-xs font-bold text-destructive"><ClipboardList className="size-3.5" />แผนปฏิบัติการเร่งด่วน</h3><p className="mt-0.5 text-[10px] font-semibold">{queue.title}</p></div>
              <span className="shrink-0 rounded bg-destructive px-2 py-1 text-[9px] font-bold text-destructive-foreground">ต้องสั่งการ</span>
            </div>
            <div className="grid gap-1.5">
              {actions.map((action, index) => (
                <div key={action.title} className="bg-card p-2 shadow-[var(--shadow-card)]">
                  <div className="flex items-start gap-2">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold">{action.title}</div>
                      <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">{action.detail}</p>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
                        <span className="flex items-center gap-1"><Wrench className="size-3 text-primary" />{action.owner}</span>
                        <span className="flex items-center gap-1 font-semibold text-destructive"><CalendarClock className="size-3" />{action.deadline}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-1 border-t pt-1 text-[9px] text-muted-foreground"><CircleCheckBig className="mt-0.5 size-3 shrink-0 text-success" /><span>เกณฑ์ปิดงาน: {action.done}</span></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between bg-primary px-4 text-[9px] text-primary-foreground">
        <span className="flex items-center gap-1"><Info className="size-3" />คะแนนคำนวณทุกคืน · Claim ค้างอัปเดตจากข้อมูลล่าสุด</span>
        <span>ข้อมูลรายงาน ณ {fmtDate(summary?.generatedAt ?? null)} · Critical ≥80</span>
      </footer>
    </section>
    </div>
  );
}

const LEVEL_OPTIONS = ["critical", "high", "medium", "low"] as const;
const PM_OPTIONS = [
  { value: "all", label: "ไม่กรอง" },
  { value: "none", label: "ไม่มีข้อมูล PM" },
  { value: "30", label: "ไม่ได้ PM ≥ 30 วัน" },
  { value: "60", label: "ไม่ได้ PM ≥ 60 วัน" },
  { value: "90", label: "ไม่ได้ PM ≥ 90 วัน" },
  { value: "180", label: "ไม่ได้ PM ≥ 180 วัน" },
];
const SORT_OPTIONS = [
  { value: "score", label: "คะแนนสูงสุด" },
  { value: "pm", label: "ไม่ได้ PM นานที่สุด" },
  { value: "claims90", label: "เคลม 90 วันมากสุด" },
  { value: "open", label: "เคลมค้างเปิดมากสุด" },
];

function uniqSorted(values: (string | null | undefined)[]) {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b, "th"),
  );
}

function RiskScorePage() {
  const { canSeeMaintenance, isLoading: rolesLoading } = useMyRoles();
  const { map, counts, isLoading } = useAssetRiskMap(canSeeMaintenance);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const [project, setProject] = useState("all");
  const [department, setDepartment] = useState("all");
  const [mediaType, setMediaType] = useState("all");
  const [district, setDistrict] = useState("all");
  const [level, setLevel] = useState("all");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [pmGap, setPmGap] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState("score");
  const [summaryGrouping, setSummaryGrouping] = useState<"project" | "department">("project");
  const [exportingOverview, setExportingOverview] = useState(false);

  // Live open-ticket counts (same source as Claim Aging). The risk table is
  // only recomputed nightly, so without this the "เคลมค้างเปิด" filter lags a day.
  const openFn = useServerFn(listOpenClaimCounts);
  const openQ = useQuery({
    queryKey: ["risk-open-claims"],
    queryFn: () => openFn(),
    staleTime: 5 * 60 * 1000,
    enabled: canSeeMaintenance,
  });
  const liveOpen = openQ.data?.counts;

  const all = useMemo(() => {
    const list = Array.from(map.values());
    if (!liveOpen) return list;
    return list.map((r) => {
      const live = liveOpen[r.code] ?? 0;
      return live === r.openClaims ? r : { ...r, openClaims: live };
    });
  }, [map, liveOpen]);

  const projectOptions = useMemo(
    () => uniqSorted(all.map((r) => projectForDepartment(r.department))),
    [all],
  );
  const departmentOptions = useMemo(() => {
    const scoped =
      project === "all"
        ? all
        : all.filter((r) => projectForDepartment(r.department) === project);
    return uniqSorted(scoped.map((r) => r.department));
  }, [all, project]);
  const mediaOptions = useMemo(() => uniqSorted(all.map((r) => r.mediaType)), [all]);
  const districtOptions = useMemo(() => uniqSorted(all.map((r) => r.district)), [all]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const min = minScore.trim() === "" ? null : Number(minScore);
    const max = maxScore.trim() === "" ? null : Number(maxScore);
    return all.filter((r) => {
      if (needle && !r.code.toLowerCase().includes(needle)) return false;
      if (project !== "all" && projectForDepartment(r.department) !== project) return false;
      if (department !== "all" && r.department !== department) return false;
      if (mediaType !== "all" && r.mediaType !== mediaType) return false;
      if (district !== "all" && r.district !== district) return false;
      if (level !== "all" && r.level !== level) return false;
      if (min != null && Number.isFinite(min) && r.score < min) return false;
      if (max != null && Number.isFinite(max) && r.score > max) return false;
      if (pmGap === "none" && r.daysSincePm != null) return false;
      if (pmGap !== "all" && pmGap !== "none" && (r.daysSincePm ?? -1) < Number(pmGap)) return false;
      if (openOnly && r.openClaims <= 0) return false;
      return true;
    });
  }, [all, q, project, department, mediaType, district, level, minScore, maxScore, pmGap, openOnly]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sort === "pm") return (b.daysSincePm ?? -1) - (a.daysSincePm ?? -1) || b.score - a.score;
      if (sort === "claims90") return b.claims90d - a.claims90d || b.score - a.score;
      if (sort === "open") return b.openClaims - a.openClaims || b.score - a.score;
      return b.score - a.score;
    });
    return list;
  }, [filtered, sort]);

  const rows = useMemo(() => sorted.slice(0, 300), [sorted]);

  const filteredCounts = useMemo(
    () => ({
      critical: filtered.filter((r) => r.level === "critical").length,
      high: filtered.filter((r) => r.level === "high").length,
      medium: filtered.filter((r) => r.level === "medium").length,
      low: filtered.filter((r) => r.level === "low").length,
    }),
    [filtered],
  );

  const riskGroups = useMemo<RiskOverviewGroup[]>(() => {
    const grouped = new Map<string, RiskOverviewGroup>();
    for (const risk of filtered) {
      const label = summaryGrouping === "project"
        ? projectForDepartment(risk.department) ?? "ไม่ระบุ Project"
        : risk.department ?? "ไม่ระบุ Department";
      const current = grouped.get(label) ?? {
        label,
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      current.total += 1;
      current[risk.level] += 1;
      grouped.set(label, current);
    }
    return Array.from(grouped.values()).sort(
      (a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total || a.label.localeCompare(b.label, "th"),
    );
  }, [filtered, summaryGrouping]);

  const hasFilters =
    project !== "all" ||
    department !== "all" ||
    mediaType !== "all" ||
    district !== "all" ||
    level !== "all" ||
    minScore !== "" ||
    maxScore !== "" ||
    pmGap !== "all" ||
    openOnly ||
    q !== "";

  const clearFilters = () => {
    setProject("all");
    setDepartment("all");
    setMediaType("all");
    setDistrict("all");
    setLevel("all");
    setMinScore("");
    setMaxScore("");
    setPmGap("all");
    setOpenOnly(false);
    setQ("");
  };

  /** Hand the filtered list over to Route Monitoring to build a PM plan. */
  const sendToRoutePlan = () => {
    const codes = sorted.slice(0, 300).map((r) => r.code);
    if (!codes.length) return;
    const scope = [
      project !== "all" ? project : null,
      department !== "all" ? department : null,
      mediaType !== "all" ? mediaType : null,
      district !== "all" ? district : null,
      level !== "all" ? RISK_LABELS[level as keyof typeof RISK_LABELS] : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const label = `แผน PM ตามความเสี่ยง${scope ? ` (${scope})` : ""}`;
    window.sessionStorage.setItem("ad_photo_route", JSON.stringify({ codes, label }));
    toast.success(`ส่ง ${codes.length} ป้ายไปหน้า Route Monitoring แล้ว`);
    window.location.href = "/route-monitoring";
  };

  const exportCsv = () => {
    const head = [
      "old_code",
      "score",
      "risk_level",
      "department",
      "media_type",
      "district",
      "open_claims",
      "claims_30d",
      "claims_90d",
      "claims_365d",
      "days_since_pm",
      "last_pm_at",
      "top_problem",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = sorted.map((r) =>
      [
        r.code,
        r.score,
        RISK_LABELS[r.level],
        r.department,
        r.mediaType,
        r.district,
        r.openClaims,
        r.claims30d,
        r.claims90d,
        r.claims365d,
        r.daysSincePm,
        r.lastPmAt,
        r.topProblem,
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob(["\uFEFF" + [head.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `risk-pm-plan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterLabel = useMemo(() => {
    const active = [
      project !== "all" ? `Project: ${project}` : null,
      department !== "all" ? `Department: ${department}` : null,
      mediaType !== "all" ? `Media Type: ${mediaType}` : null,
      district !== "all" ? `พื้นที่: ${district}` : null,
      level !== "all" ? `ระดับ: ${RISK_LABELS[level as keyof typeof RISK_LABELS]}` : null,
      minScore ? `คะแนน ≥ ${minScore}` : null,
      maxScore ? `คะแนน ≤ ${maxScore}` : null,
      pmGap !== "all" ? PM_OPTIONS.find((option) => option.value === pmGap)?.label ?? null : null,
      openOnly ? "เฉพาะป้ายที่มีเคลมค้างเปิด" : null,
    ].filter((item): item is string => !!item);
    return active.length ? active.join(" · ") : "ทุก Project และทุกระดับความเสี่ยง";
  }, [project, department, mediaType, district, level, minScore, maxScore, pmGap, openOnly]);

  const exportOverview = async () => {
    if (!sorted.length) return;
    setExportingOverview(true);
    try {
      await exportRiskOverviewPptx({
        rows: sorted.map((risk) => ({
          code: risk.code,
          project: projectForDepartment(risk.department) ?? "ไม่ระบุ",
          department: risk.department ?? "ไม่ระบุ",
          mediaType: risk.mediaType ?? "ไม่ระบุ",
          level: risk.level,
          score: risk.score,
          openClaims: risk.openClaims,
        })),
        groups: riskGroups,
        groupingLabel: summaryGrouping === "project" ? "Project" : "Department",
        filterLabel,
      });
      toast.success("ดาวน์โหลด PowerPoint ภาพรวมพร้อมหน้าปกแล้ว");
    } catch (error) {
      console.error("Risk overview PowerPoint export failed", error);
      toast.error("ส่งออก PowerPoint ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setExportingOverview(false);
    }
  };

  const code = selected && filtered.some((r) => r.code === selected) ? selected : rows[0]?.code ?? null;

  if (!rolesLoading && !canSeeMaintenance) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="คะแนนความเสี่ยงรายป้าย" />
        <div className="rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
          บัญชีของคุณไม่มีสิทธิ์ดูข้อมูลงานซ่อมบำรุง
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="คะแนนความเสี่ยงรายป้าย"
        subtitle="แยกองค์ประกอบคะแนน 0–100 ของแต่ละป้าย พร้อมกราฟสรุปทันที • อัปเดตทุกคืน"
      />

      <div className="mb-4 rounded-xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">ตัวกรองสำหรับวางแผน PM</div>
          <div className="text-[11px] text-muted-foreground">
            ตรงเงื่อนไข {filtered.length} ป้าย {filtered.length > 300 && "(แสดง 300 อันดับแรก)"}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearFilters}
              disabled={!hasFilters}
              className="text-xs"
            >
              <FilterX className="size-3.5" />
              ล้างตัวกรอง
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="text-xs"
            >
              <Download className="size-3.5" />
              ดาวน์โหลด CSV (แผน PM)
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={sendToRoutePlan}
              disabled={filtered.length === 0}
              className="text-xs"
            >
              <NavIcon className="size-3.5" />
              สร้างแผนตรวจจากรายการนี้
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SearchableSelect
            value={project}
            onChange={(v) => {
              setProject(v);
              setDepartment("all");
            }}
            options={projectOptions}
            allLabel="กลุ่มสื่อ: ทั้งหมด"
            title="กลุ่มสื่อ (Project)"
          />
          <SearchableSelect
            value={department}
            onChange={setDepartment}
            options={departmentOptions}
            allLabel="แผนก: ทั้งหมด"
            title="แผนก (Department)"
          />
          <SearchableSelect
            value={mediaType}
            onChange={setMediaType}
            options={mediaOptions}
            allLabel="Media Type: ทั้งหมด"
            title="Media Type"
          />
          <SearchableSelect
            value={district}
            onChange={setDistrict}
            options={districtOptions}
            allLabel="พื้นที่/เขต: ทั้งหมด"
            title="พื้นที่ (District)"
          />

          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-xs"
            title="ระดับความเสี่ยง"
          >
            <option value="all">ระดับความเสี่ยง: ทั้งหมด</option>
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {RISK_LABELS[l]}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <Input
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              inputMode="numeric"
              placeholder="คะแนนต่ำสุด"
              className="h-9 text-xs"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              inputMode="numeric"
              placeholder="สูงสุด"
              className="h-9 text-xs"
            />
          </div>

          <select
            value={pmGap}
            onChange={(e) => setPmGap(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-xs"
            title="ช่วงเวลาที่ไม่ได้ PM"
          >
            {PM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="h-9 flex-1 rounded-md border bg-background px-2 text-xs"
              title="เรียงลำดับ"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  เรียง: {o.label}
                </option>
              ))}
            </select>
            <label
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs"
              title="นับจำนวนป้าย (1 ป้ายอาจมีหลายตั๋ว) จากตั๋วที่ยังเปิดอยู่ชุดเดียวกับเมนู Claim Aging"
            >
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
                className="size-3.5"
              />
              เคลมค้างเปิด
            </label>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,2fr)]">
        <section className="rounded-lg border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Filter Result Summary</div>
              <div className="mt-2 text-4xl font-black tabular-nums text-primary">{filtered.length}</div>
              <div className="mt-1 text-sm text-muted-foreground">ป้ายที่ตรงตามตัวกรองปัจจุบัน</div>
            </div>
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Layers3 className="size-5" />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 border-t pt-3 text-center">
            <div><div className="font-bold tabular-nums text-destructive">{filteredCounts.critical}</div><div className="text-[10px] text-muted-foreground">วิกฤต</div></div>
            <div><div className="font-bold tabular-nums text-destructive">{filteredCounts.high}</div><div className="text-[10px] text-muted-foreground">เสี่ยงสูง</div></div>
            <div><div className="font-bold tabular-nums text-warning-foreground">{filteredCounts.medium}</div><div className="text-[10px] text-muted-foreground">เฝ้าระวัง</div></div>
            <div><div className="font-bold tabular-nums text-success">{filteredCounts.low}</div><div className="text-[10px] text-muted-foreground">เสี่ยงต่ำ</div></div>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Risk Breakdown by Category</div>
              <div className="mt-1 text-sm font-bold">สรุปความเสี่ยงเพื่อจัดลำดับแผน PM</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                <Button type="button" size="sm" variant={summaryGrouping === "project" ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setSummaryGrouping("project")}>Project</Button>
                <Button type="button" size="sm" variant={summaryGrouping === "department" ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setSummaryGrouping("department")}>Department</Button>
              </div>
              <Button type="button" size="sm" onClick={() => void exportOverview()} disabled={!sorted.length || exportingOverview}>
                {exportingOverview ? <Loader2 className="animate-spin" /> : <Presentation />}
                {exportingOverview ? "กำลังสร้าง…" : "Export to PowerPoint"}
              </Button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_64px_64px_64px_64px_64px] gap-2 border-b pb-2 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>{summaryGrouping === "project" ? "Project" : "Department"}</span><span className="text-center">วิกฤต</span><span className="text-center">สูง</span><span className="text-center">กลาง</span><span className="text-center">ต่ำ</span><span className="text-right">รวม</span>
              </div>
              <div className="divide-y">
                {riskGroups.slice(0, 6).map((group) => (
                  <div key={group.label} className="grid grid-cols-[minmax(180px,1fr)_64px_64px_64px_64px_64px] items-center gap-2 py-2 text-xs">
                    <span className="truncate font-medium" title={group.label}>{group.label}</span>
                    <span className="text-center font-bold tabular-nums text-destructive">{group.critical}</span>
                    <span className="text-center font-bold tabular-nums text-destructive">{group.high}</span>
                    <span className="text-center font-bold tabular-nums text-warning-foreground">{group.medium}</span>
                    <span className="text-center font-bold tabular-nums text-success">{group.low}</span>
                    <span className="text-right font-bold tabular-nums text-primary">{group.total}</span>
                  </div>
                ))}
                {riskGroups.length === 0 && <div className="py-4 text-sm text-muted-foreground">ไม่พบข้อมูลตามตัวกรอง</div>}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="border-b p-3">
            <div className="relative">
              <SearchIcon className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา Old Code…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="grid grid-cols-[96px_minmax(90px,1fr)_minmax(100px,1fr)_52px] gap-2 border-b bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
            <span>Old Code</span>
            <span>Project</span>
            <span>Media Type</span>
            <span className="text-right">คะแนน</span>
          </div>
          <div className="max-h-[560px] overflow-y-auto divide-y">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">ไม่พบป้ายที่มีสัญญาณเสี่ยง</div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setSelected(r.code)}
                  className={cn(
                    "grid w-full grid-cols-[96px_minmax(90px,1fr)_minmax(100px,1fr)_52px] items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40",
                    r.code === code && "bg-accent/60",
                  )}
                >
                  <span className="truncate font-mono text-[11px] font-semibold" title={r.code}>{r.code}</span>
                  <span className="truncate text-[11px] text-muted-foreground" title={projectForDepartment(r.department) ?? "ไม่ระบุ"}>{projectForDepartment(r.department) ?? "ไม่ระบุ"}</span>
                  <span className="truncate text-[11px] text-muted-foreground" title={r.mediaType ?? "ไม่ระบุ"}>{r.mediaType ?? "ไม่ระบุ"}</span>
                  <span
                    className="text-right tabular-nums text-xs font-semibold"
                    style={{ color: RISK_PIN_COLORS[r.level] }}
                  >
                    {r.score}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div>{code ? <RiskDetail code={code} liveOpenClaims={liveOpen?.[code]} /> : <Skeleton className="h-72 w-full" />}</div>
      </div>
    </div>
  );
}
