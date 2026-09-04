// Per-asset risk score breakdown — explains how the 0–100 score is composed.
// Reads the nightly-computed public.asset_risk_scores (no AI, no paid API).
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { ShieldAlert, ShieldCheck, Search as SearchIcon, Info, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMyRoles } from "@/hooks/use-my-roles";
import { RiskChip, useAssetRiskMap, type AssetRisk } from "@/components/asset-risk";
import { RISK_PIN_COLORS, RISK_LABELS, isUrgentRisk } from "@/lib/risk-colors";
import { getAssetRisk } from "@/lib/route-risk.functions";

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

/** Inspection guidance derived from the same signals as the score. */
function advice(r: AssetRisk) {
  const focus: string[] = [];
  if (r.topProblem) focus.push(`ตรวจหมวด "${r.topProblem}" เป็นอย่างแรก (ปัญหาที่พบซ้ำบ่อยที่สุด)`);
  if (r.openClaims > 0)
    focus.push(`มีเคลมค้างเปิด ${r.openClaims} ตั๋ว — เช็คว่างานซ่อมเดิมปิดจริงหรือยัง`);
  if (r.claims30d >= 2)
    focus.push("เคลมซ้ำภายใน 30 วัน — สงสัยการซ่อมไม่จบ ให้ตรวจต้นเหตุ (อุปกรณ์/ระบบไฟ) ไม่ใช่แค่อาการ");
  else if (r.claims90d >= 2) focus.push("เคลมซ้ำในรอบ 90 วัน — ตรวจอุปกรณ์ที่เคยเสียซ้ำและอะไหล่สำรอง");
  if ((r.daysSincePm ?? 0) >= 120)
    focus.push(`ไม่ได้ PM มา ${r.daysSincePm} วัน — ทำ PM เต็มชุด (ทำความสะอาด/ขันแน่น/วัดค่าไฟ)`);
  if (focus.length === 0) focus.push("ไม่มีสัญญาณเฉพาะจุด — ตรวจตามเช็กลิสต์ PM ปกติ");

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

  return { focus, queue };
}


function RiskDetail({ code }: { code: string }) {
  const fn = useServerFn(getAssetRisk);
  const { data, isLoading } = useQuery({
    queryKey: ["asset-risk", code],
    queryFn: () => fn({ data: { code } }),
    staleTime: 10 * 60 * 1000,
    enabled: !!code,
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  const risk = data?.risk ?? null;
  if (!risk)
    return (
      <div className="rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
        ไม่พบคะแนนความเสี่ยงของ {code} (แปลว่าไม่มีสัญญาณเสี่ยงเลย = เสี่ยงต่ำ)
      </div>
    );

  const parts = breakdown(risk);
  const trend = [
    { name: "365 วัน", claims: risk.claims365d },
    { name: "90 วัน", claims: risk.claims90d },
    { name: "30 วัน", claims: risk.claims30d },
  ];
  const color = RISK_PIN_COLORS[risk.level];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {risk.level === "low" ? (
              <ShieldCheck className="size-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="size-4" style={{ color }} />
            )}
            <span className="font-mono">{risk.code}</span>
            <RiskChip level={risk.level} score={risk.score} />
            <span className="ml-auto text-2xl font-bold tabular-nums" style={{ color }}>
              {risk.score}
              <span className="text-sm font-normal text-muted-foreground">/100</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="ปัญหาที่พบซ้ำบ่อย" value={risk.topProblem ?? "—"} />
            <Stat label="PM ล่าสุด" value={fmtDate(risk.lastPmAt)} />
            <Stat label="เคลมล่าสุด" value={fmtDate(risk.lastClaimAt)} />
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">องค์ประกอบคะแนน</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={parts} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 40]} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number, _n, p: { payload?: { max?: number } }) =>
                      [`${v} / ${p?.payload?.max ?? 0} คะแนน`, "ได้"] as [string, string]
                    }
                  />
                  <Bar dataKey="max" fill="hsl(var(--muted))" radius={4} barSize={14} />
                  <Bar dataKey="value" radius={4} barSize={14}>
                    {parts.map((p) => (
                      <Cell key={p.key} fill={color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {parts.map((p) => (
                <li key={p.key} className="flex justify-between gap-2 rounded border bg-background/60 px-2 py-1">
                  <span className="truncate">
                    {p.label} — {p.detail}
                  </span>
                  <span className="tabular-nums font-medium text-foreground">
                    {p.value}/{p.max}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">แนวโน้มจำนวนเคลม (สะสมย้อนหลัง)</div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ left: 0, right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip />
                  <Line type="monotone" dataKey="claims" stroke={color} strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {(() => {
            const { focus, queue } = advice(risk);
            return (
              <div
                className={cn(
                  "rounded-xl border p-4",
                  queue.tone === "critical"
                    ? "border-destructive/60 bg-destructive/10"
                    : queue.tone === "high"
                    ? "border-destructive/40 bg-destructive/5"
                    : queue.tone === "medium"
                      ? "border-warning/40 bg-warning/5"
                      : "border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ClipboardList className="size-4" />
                  คำแนะนำการตรวจ
                </div>

                <div className="mt-3">
                  <div className="text-xs font-medium text-muted-foreground">ควรโฟกัสอะไร</div>
                  <ul className="mt-1 grid gap-1 text-[13px]">
                    {focus.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current opacity-60" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-3 rounded-lg border bg-background/60 p-3">
                  <div className="text-[13px] font-semibold">{queue.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{queue.text}</div>
                </div>
              </div>
            );
          })()}


          <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              คะแนน 0–100 คำนวณใหม่ทุกคืน: เคลมค้างเปิด 40 คะแนน + เคลม 30 วัน 25 + เคลม 90 วัน 15 + เคลม
              365 วัน 10 + วันตั้งแต่ PM ล่าสุด 10 • ≥80 = วิกฤต, 60–79.9 = เสี่ยงสูง, 25–59.9 = เสี่ยงกลาง,
              น้อยกว่า 25 = เสี่ยงต่ำ
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function RiskScorePage() {
  const { canSeeMaintenance, isLoading: rolesLoading } = useMyRoles();
  const { map, counts, isLoading } = useAssetRiskMap(canSeeMaintenance);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = Array.from(map.values());
    const needle = q.trim().toLowerCase();
    return list
      .filter((r) => (needle ? r.code.toLowerCase().includes(needle) : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
  }, [map, q]);

  const code = selected ?? rows[0]?.code ?? null;

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

      {counts && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-destructive bg-destructive px-3 py-1 text-destructive-foreground">
            วิกฤต {counts.critical} ป้าย
          </span>
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-destructive">
            เสี่ยงสูง {counts.high} ป้าย
          </span>
          <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-warning">
            เสี่ยงกลาง {counts.medium} ป้าย
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
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
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40",
                    r.code === code && "bg-accent/60",
                  )}
                >
                  <span className="truncate font-mono text-[12px]">{r.code}</span>
                  <span
                    className="tabular-nums text-xs font-semibold"
                    style={{ color: RISK_PIN_COLORS[r.level] }}
                  >
                    {r.score}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div>{code ? <RiskDetail code={code} /> : <Skeleton className="h-72 w-full" />}</div>
      </div>
    </div>
  );
}
