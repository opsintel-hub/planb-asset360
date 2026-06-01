import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, ResponsiveContainer, BarChart, PieChart, Pie, Cell,
} from "recharts";
import { StatCard, Badge } from "@/components/ui-bits";
import { AlertTriangle, ShieldCheck, Activity, Clock, Sparkles, Loader2, Info } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { aiAnalyzeAssets } from "@/lib/ai-analyze.functions";
import { toast } from "sonner";

const TYPE_COLOR = {
  PM: "oklch(0.62 0.19 255)",
  Claim: "oklch(0.6 0.22 25)",
  Monitor: "oklch(0.65 0.16 155)",
} as const;

const PIE_PALETTE = [
  "oklch(0.6 0.22 25)",
  "oklch(0.7 0.18 50)",
  "oklch(0.62 0.19 255)",
  "oklch(0.65 0.16 155)",
  "oklch(0.55 0.2 305)",
  "oklch(0.65 0.15 90)",
];

type Asset = {
  id: string; old_code: string; name: string | null;
  department: string | null; area: string | null; status: string | null;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HistRow = any;

function eventDate(h: HistRow): string | null {
  if (h?.type === "Claim") return h.opened_at ?? null;
  return h.closed_at ?? h.opened_at ?? null;
}

function categorizeClaim(h: HistRow): string {
  const p = (h?.payload ?? {}) as Record<string, unknown>;
  const candidate = [
    p.cause, p.Cause, p.rootCause, p.RootCause,
    p.category, p.Category, p.problem, p.Problem,
    p.errorType, p.ErrorType, p.failureType, p.FailureType,
    h?.title,
  ].find((x) => typeof x === "string" && (x as string).trim().length > 0) as string | undefined;
  const text = (candidate ?? "อื่นๆ").toString().toLowerCase();
  if (/network|net|signal|wifi|เน็ต|สัญญาณ/.test(text)) return "Network";
  if (/power|electric|ไฟ|กระแส|psu/.test(text)) return "Power";
  if (/screen|display|led|panel|จอ|หน้าจอ|pixel/.test(text)) return "Display / LED";
  if (/software|firmware|ซอฟต์|os|reboot|hang|crash/.test(text)) return "Software";
  if (/human|misuse|operator|error|มนุษย์|ใช้งาน/.test(text)) return "Human Error";
  if (/hardware|hw|board|circuit|ฮาร์ด/.test(text)) return "Hardware";
  if (/sensor|เซน/.test(text)) return "Sensor";
  return candidate ? candidate.toString().slice(0, 30) : "อื่นๆ";
}

function daysBetween(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return NaN;
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

export function AnalyticsTab({
  assets, history,
}: {
  assets: Asset[]; history: HistRow[];
}) {
  const [lagWindow, setLagWindow] = useState(7);

  // ---------- Per-asset aggregates ----------
  const perAsset = useMemo(() => {
    return assets.map((a) => {
      const rows = history.filter((h) => h.asset_id === a.id);
      const pms = rows.filter((h) => h.type === "PM").map(eventDate).filter(Boolean).sort() as string[];
      const claims = rows.filter((h) => h.type === "Claim").map(eventDate).filter(Boolean).sort() as string[];
      const monitors = rows.filter((h) => h.type === "Monitor").map(eventDate).filter(Boolean).sort() as string[];

      // MTBF = mean days between consecutive Claims
      const intervals: number[] = [];
      for (let i = 1; i < claims.length; i++) intervals.push(daysBetween(claims[i - 1], claims[i]));
      const mtbf = intervals.length ? intervals.reduce((s, n) => s + n, 0) / intervals.length : NaN;

      // PM Lag Time = avg days from previous PM to next Claim
      const lagDays: number[] = [];
      for (const c of claims) {
        const prevPm = [...pms].reverse().find((d) => d < c);
        if (prevPm) {
          const dd = daysBetween(prevPm, c);
          if (Number.isFinite(dd) && dd >= 0) lagDays.push(dd);
        }
      }
      const pmLag = lagDays.length ? lagDays.reduce((s, n) => s + n, 0) / lagDays.length : NaN;

      // Predictive accuracy: % claims with a Monitor event within lagWindow days before
      let detected = 0;
      for (const c of claims) {
        const cT = new Date(c).getTime();
        const hit = monitors.some((m) => {
          const mT = new Date(m).getTime();
          const diff = (cT - mT) / 86_400_000;
          return diff >= 0 && diff <= lagWindow;
        });
        if (hit) detected += 1;
      }
      const predictive = claims.length ? (detected / claims.length) * 100 : NaN;

      return {
        asset: a,
        pmCount: pms.length,
        claimCount: claims.length,
        monitorCount: monitors.length,
        mtbf,
        pmLag,
        monitorPerClaim: claims.length ? monitors.length / claims.length : NaN,
        predictive,
        detected,
      };
    });
  }, [assets, history, lagWindow]);

  // ---------- Combo chart (monthly) ----------
  const monthly = useMemo(() => {
    const buckets = new Map<string, { month: string; PM: number; Monitor: number; Claim: number }>();
    for (const h of history) {
      const d = eventDate(h); if (!d) continue;
      const key = d.slice(0, 7);
      const row = buckets.get(key) ?? { month: key, PM: 0, Monitor: 0, Claim: 0 };
      if (h.type === "PM") row.PM += 1;
      else if (h.type === "Monitor") row.Monitor += 1;
      else if (h.type === "Claim") row.Claim += 1;
      buckets.set(key, row);
    }
    return Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [history]);

  // ---------- Top 5 Claims ranking ----------
  const topClaims = useMemo(() => {
    return [...perAsset]
      .filter((p) => p.claimCount > 0)
      .sort((a, b) => b.claimCount - a.claimCount)
      .slice(0, 5)
      .map((p) => ({ code: p.asset.old_code, claims: p.claimCount, mtbf: p.mtbf }));
  }, [perAsset]);

  // ---------- Root cause pie ----------
  const causes = useMemo(() => {
    const m = new Map<string, number>();
    history.filter((h) => h.type === "Claim").forEach((h) => {
      const c = categorizeClaim(h);
      m.set(c, (m.get(c) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [history]);

  // ---------- Monitor vs Claim comparison ----------
  const monitorVsClaim = useMemo(() => {
    const m = new Map<string, { cause: string; monitor: number; claim: number }>();
    history.forEach((h) => {
      if (h.type !== "Monitor" && h.type !== "Claim") return;
      const c = categorizeClaim(h);
      const row = m.get(c) ?? { cause: c, monitor: 0, claim: 0 };
      if (h.type === "Monitor") row.monitor += 1; else row.claim += 1;
      m.set(c, row);
    });
    return Array.from(m.values()).sort((a, b) => (b.monitor + b.claim) - (a.monitor + a.claim)).slice(0, 8);
  }, [history]);

  // ---------- Overall predictive accuracy ----------
  const totalClaims = perAsset.reduce((s, p) => s + p.claimCount, 0);
  const totalDetected = perAsset.reduce((s, p) => s + p.detected, 0);
  const overallPredictive = totalClaims ? (totalDetected / totalClaims) * 100 : NaN;
  const totalMonitor = perAsset.reduce((s, p) => s + p.monitorCount, 0);
  const totalPM = perAsset.reduce((s, p) => s + p.pmCount, 0);
  const overallMtbf = (() => {
    const vals = perAsset.map((p) => p.mtbf).filter((n) => Number.isFinite(n));
    return vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : NaN;
  })();
  const overallLag = (() => {
    const vals = perAsset.map((p) => p.pmLag).filter((n) => Number.isFinite(n));
    return vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : NaN;
  })();

  const fmt = (n: number, d = 1) => Number.isFinite(n) ? n.toFixed(d) : "—";

  // ---------- AI Analysis ----------
  const callAi = useServerFn(aiAnalyzeAssets);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string>("");

  async function runAiAnalysis() {
    setAiLoading(true);
    setAiText("");
    try {
      const now = new Date();
      const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const curMonth = ym(now);
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = ym(prev);
      const cur = monthly.find((m) => m.month === curMonth) ?? { PM: 0, Monitor: 0, Claim: 0 };
      const last = monthly.find((m) => m.month === prevMonth) ?? { PM: 0, Monitor: 0, Claim: 0 };

      const repeats: string[] = [];
      for (const a of assets) {
        const claims = history.filter((h) => h.asset_id === a.id && h.type === "Claim");
        const m = new Map<string, number>();
        claims.forEach((h) => {
          const c = categorizeClaim(h);
          m.set(c, (m.get(c) ?? 0) + 1);
        });
        for (const [cause, n] of m) {
          if (n >= 3) repeats.push(`${a.old_code}: ${cause} ${n} ครั้ง`);
        }
      }

      const payload = {
        จำนวนป้าย: assets.length,
        รวม: { PM: totalPM, Monitor: totalMonitor, Claim: totalClaims },
        เดือนนี้: { month: curMonth, ...cur },
        เดือนก่อน: { month: prevMonth, ...last },
        MTBF_เฉลี่ย_วัน: Number.isFinite(overallMtbf) ? Number(overallMtbf.toFixed(1)) : null,
        PM_Lag_เฉลี่ย_วัน: Number.isFinite(overallLag) ? Number(overallLag.toFixed(1)) : null,
        Predictive_Accuracy_pct: Number.isFinite(overallPredictive) ? Number(overallPredictive.toFixed(0)) : null,
        หน้าต่าง_Monitor_ก่อน_Claim_วัน: lagWindow,
        สาเหตุ_Claim: causes.slice(0, 8),
        Monitor_vs_Claim_per_cause: monitorVsClaim,
        ป้าย_MTBF_ต่ำกว่า_10วัน: perAsset
          .filter((p) => Number.isFinite(p.mtbf) && p.mtbf < 10)
          .map((p) => ({ code: p.asset.old_code, mtbf: Number(p.mtbf.toFixed(1)), claims: p.claimCount })),
        Top5_Claim: topClaims,
        อาการเสียซ้ำซาก: repeats.slice(0, 10),
      };

      const res = await callAi({ data: { context: JSON.stringify(payload, null, 2) } });
      setAiText(res.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI วิเคราะห์ไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  }

  if (assets.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">เลือกป้ายก่อนเพื่อดู Analytics</div>;
  }

  return (
    <div className="space-y-8">
      {/* AI Executive Summary */}
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-accent/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">AI Executive Summary</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ให้ AI วิเคราะห์ภาพรวม PM × Claim × Monitor, เปรียบเทียบกับเดือนก่อน, ระบุตัวปัญหา (MTBF&lt;10 วัน, อาการซ้ำซาก) และบอกว่า "ต้องทำอะไรต่อ"
            </p>
          </div>
          <button
            type="button"
            onClick={runAiAnalysis}
            disabled={aiLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {aiLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {aiLoading ? "กำลังวิเคราะห์..." : "วิเคราะห์ด้วย AI"}
          </button>
        </div>
        {aiText && (
          <div className="mt-4 rounded-lg border bg-card p-4 text-sm whitespace-pre-wrap leading-relaxed">
            {aiText}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="PM ทั้งหมด" value={totalPM} tone="default" icon={<Activity className="size-5" />} />
        <StatCard label="Monitor ทั้งหมด" value={totalMonitor} tone="success" icon={<ShieldCheck className="size-5" />} />
        <StatCard label="Claim ทั้งหมด" value={totalClaims} tone="danger" icon={<AlertTriangle className="size-5" />} />
        <StatCard label="MTBF เฉลี่ย" value={`${fmt(overallMtbf)} วัน`} tone={Number.isFinite(overallMtbf) && overallMtbf < 15 ? "danger" : "default"} icon={<Clock className="size-5" />} />
        <StatCard label="Predictive Accuracy" value={`${fmt(overallPredictive, 0)}%`} delta={`Monitor ก่อน Claim ≤ ${lagWindow} วัน`} tone="success" />
      </div>

      {/* Section 1: Maintenance Efficiency */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">1. Maintenance Efficiency Analysis</h3>
          <p className="text-xs text-muted-foreground">เปรียบเทียบ PM / Monitor (แท่ง) กับ Claim (เส้น) รายเดือน — ดูว่ายิ่ง PM/Monitor มาก ยอด Claim ลดลงจริงไหม</p>
        </div>
        <div className="rounded-xl border p-4">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="PM" fill={TYPE_COLOR.PM} name="PM" />
                <Bar yAxisId="left" dataKey="Monitor" fill={TYPE_COLOR.Monitor} name="Monitor" />
                <Line yAxisId="right" type="monotone" dataKey="Claim" stroke={TYPE_COLOR.Claim} strokeWidth={2.5} name="Claim" dot />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <div className="text-sm font-medium">Efficiency Table — ประสิทธิภาพรายป้าย</div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Device</th>
                <th className="text-right px-3 py-2">PM</th>
                <th className="text-right px-3 py-2">Monitor</th>
                <th className="text-right px-3 py-2">Claim</th>
                <th className="text-right px-3 py-2">MTBF (วัน)</th>
                <th className="text-right px-3 py-2">Monitor / Claim</th>
                <th className="text-right px-3 py-2">PM Lag (วัน)</th>
                <th className="text-center px-3 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {perAsset.map((p) => {
                const risk = Number.isFinite(p.mtbf) && p.mtbf < 15;
                return (
                  <tr key={p.asset.id} className="hover:bg-accent/30">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{p.asset.old_code}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{p.asset.name ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: TYPE_COLOR.PM }}>{p.pmCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: TYPE_COLOR.Monitor }}>{p.monitorCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: TYPE_COLOR.Claim }}>{p.claimCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.mtbf)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.monitorPerClaim, 2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.pmLag)}</td>
                    <td className="px-3 py-2 text-center">
                      {risk ? <Badge tone="danger">High Risk</Badge> : Number.isFinite(p.mtbf) ? <Badge tone="success">OK</Badge> : <Badge tone="default">—</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Critical Assets Watchlist */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">2. Critical Assets Watchlist</h3>
          <p className="text-xs text-muted-foreground">อุปกรณ์ที่ Claim สูงสุด + PM Lag Time — MTBF &lt; 15 วันแนะนำให้เปลี่ยนแทนซ่อม</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-medium mb-3">Top 5 — Claim มากสุด</div>
            {topClaims.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">ยังไม่มี Claim</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topClaims} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="code" type="category" tick={{ fontSize: 11 }} width={110} />
                    <RTooltip />
                    <Bar dataKey="claims" fill={TYPE_COLOR.Claim} name="Claim" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <div className="text-sm font-medium">PM Lag Time — เฉลี่ยกี่วันหลัง PM ก่อนเกิด Claim</div>
            <div className="text-3xl font-semibold tabular-nums">{fmt(overallLag)} <span className="text-base font-normal text-muted-foreground">วัน</span></div>
            <div className="space-y-1.5 text-sm">
              {perAsset.filter((p) => Number.isFinite(p.pmLag)).sort((a, b) => a.pmLag - b.pmLag).slice(0, 5).map((p) => (
                <div key={p.asset.id} className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-0">
                  <span className="font-mono text-xs truncate">{p.asset.old_code}</span>
                  <span className="tabular-nums text-xs">{fmt(p.pmLag)} วัน</span>
                  {Number.isFinite(p.mtbf) && p.mtbf < 15 && <Badge tone="danger">High Risk</Badge>}
                </div>
              ))}
              {perAsset.every((p) => !Number.isFinite(p.pmLag)) && (
                <div className="py-4 text-center text-xs text-muted-foreground">ยังไม่มีคู่ PM → Claim ที่คำนวณได้</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Root Cause Analysis */}
      <section className="space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-semibold">3. Root Cause &amp; Predictive Accuracy</h3>
            <p className="text-xs text-muted-foreground">สาเหตุการ Claim และเปรียบเทียบกับสิ่งที่ Monitor ตรวจเจอ</p>
          </div>
          <label className="text-xs flex items-center gap-2">
            <span className="text-muted-foreground">หน้าต่าง Monitor ก่อน Claim:</span>
            <select value={lagWindow} onChange={(e) => setLagWindow(Number(e.target.value))} className="h-8 rounded border bg-background px-2 text-xs">
              {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}
            </select>
          </label>
        </div>

        {/* คำอธิบายละเอียด */}
        <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Info className="size-3.5" /> "หน้าต่าง Monitor ก่อน Claim" คืออะไร?
          </div>
          <p className="text-muted-foreground">
            คือ <strong>ระยะเวลาย้อนหลังก่อนเกิด Claim</strong> ที่เรานับว่า "Monitor ครั้งนั้นเป็นการเตือนล่วงหน้าที่ใช้งานได้จริง"
            ตัวอย่าง: ถ้าเลือก <strong>{lagWindow} วัน</strong> แล้วเกิด Claim วันที่ 20 — Monitor ที่บันทึกระหว่างวันที่ {20 - lagWindow} ถึงวันที่ 20 จะถูกนับว่า "ตรวจเจอก่อน"
            ถ้า Monitor ห่างเกิน {lagWindow} วันถือว่าไกลเกินไป ไม่เกี่ยวข้องกับ Claim ครั้งนั้น
          </p>
          <p className="text-muted-foreground">
            ปรับค่าหน้าต่าง <strong>เล็ก (3 วัน)</strong> = เข้มงวด, ต้องตรวจเจอใกล้เวลาเสียจริง — ค่ามักต่ำลง<br/>
            ปรับ <strong>ใหญ่ (30 วัน)</strong> = ผ่อนคลาย, นับ Monitor ที่ห่างเป็นเดือนก็ได้ — ค่ามักสูงขึ้น
          </p>
          <div className="flex items-center gap-1.5 font-medium text-foreground pt-1">
            <Info className="size-3.5" /> "Predictive Accuracy" คืออะไร?
          </div>
          <p className="text-muted-foreground">
            % ของ Claim ที่ <strong>มี Monitor นำมาก่อน</strong> ภายในหน้าต่างที่ตั้งไว้ —
            สูตร: <code className="text-foreground">(จำนวน Claim ที่ตรวจเจอก่อน ÷ Claim ทั้งหมด) × 100</code>
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
            <li><strong className="text-success">90–100%</strong> = ระบบ Monitor "เห็นล่วงหน้า" เกือบทุกครั้งก่อนป้ายจะเสีย (เชิงรุก)</li>
            <li><strong className="text-warning">50–89%</strong> = เห็นบ้างไม่เห็นบ้าง ควรเพิ่มเกณฑ์ตรวจ</li>
            <li><strong className="text-destructive">0–49%</strong> = ป้ายเสียโดยไม่มีสัญญาณเตือนจาก Monitor — Monitor แบบ "ตั้งรับ" (ดูหลังเสียแล้ว) มากกว่าเชิงรุก</li>
          </ul>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-medium mb-3">สัดส่วนสาเหตุการ Claim</div>
            {causes.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">ยังไม่มี Claim</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={causes} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: { name: string; value: number }) => `${e.name} (${e.value})`}>
                      {causes.map((_, i) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                    </Pie>
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 text-sm font-medium">Monitor พบ vs Claim เสียจริง</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">สาเหตุ</th>
                  <th className="text-right px-3 py-2" style={{ color: TYPE_COLOR.Monitor }}>Monitor</th>
                  <th className="text-right px-3 py-2" style={{ color: TYPE_COLOR.Claim }}>Claim</th>
                  <th className="text-right px-3 py-2">ตรวจเจอก่อน</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {monitorVsClaim.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">ยังไม่มีข้อมูล</td></tr>
                ) : monitorVsClaim.map((r) => {
                  const ratio = r.claim ? Math.min(100, (r.monitor / r.claim) * 100) : (r.monitor ? 100 : 0);
                  return (
                    <tr key={r.cause} className="hover:bg-accent/30">
                      <td className="px-3 py-2">{r.cause}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.monitor}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.claim}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ratio.toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border p-4 bg-accent/20">
          <div className="text-sm">
            <span className="font-medium">Predictive Accuracy รวม: </span>
            <span className="tabular-nums">{fmt(overallPredictive, 0)}%</span>
            <span className="text-muted-foreground"> — มี Claim {totalClaims} ครั้ง, ตรวจเจอสัญญาณจาก Monitor ภายใน {lagWindow} วันก่อนหน้า {totalDetected} ครั้ง</span>
          </div>
        </div>
      </section>
    </div>
  );
}
