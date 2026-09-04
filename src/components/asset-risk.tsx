// Shared risk-score UI (reads public.asset_risk_scores — no AI, no paid API).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, ShieldCheck, Activity, CalendarClock, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyRoles } from "@/hooks/use-my-roles";
export { RISK_PIN_COLORS } from "@/lib/risk-colors";
import { RISK_LABELS, isUrgentRisk } from "@/lib/risk-colors";
import { listAssetRiskScores, getAssetRisk, type AssetRisk, type RiskLevel } from "@/lib/route-risk.functions";

export type { AssetRisk, RiskLevel };

/** Compact chip — low risk renders nothing so tables stay quiet. */
export function RiskChip({
  level,
  score,
  className,
}: {
  level?: RiskLevel | null;
  score?: number | null;
  className?: string;
}) {
  if (level !== "critical" && level !== "high" && level !== "medium") return null;
  const label = RISK_LABELS[level];
  return (
    <span
      title={`คะแนนความเสี่ยง ${score ?? 0}/100`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium align-middle",
        level === "critical"
          ? "border-destructive bg-destructive text-destructive-foreground"
          : level === "high"
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-warning/40 bg-warning/10 text-warning",
        className,
      )}
    >
      <ShieldAlert className="size-3" />
      {label}
    </span>
  );
}

/** Risk lookup by old_code, cached across pages. */
export function useAssetRiskMap(enabled = true) {
  const fn = useServerFn(listAssetRiskScores);
  const q = useQuery({
    queryKey: ["asset-risk-scores", 1],
    queryFn: () => fn({ data: { minScore: 1 } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  const map = useMemo(() => {
    const m = new Map<string, AssetRisk>();
    for (const r of q.data?.rows ?? []) m.set(r.code, r);
    return m;
  }, [q.data]);
  return { map, counts: q.data?.counts, isLoading: q.isLoading };
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

/** Asset health summary card for Asset History. */
export function AssetHealthCard({ code }: { code: string }) {
  const { canSeeMaintenance } = useMyRoles();
  const fn = useServerFn(getAssetRisk);
  const { data, isLoading } = useQuery({
    queryKey: ["asset-risk", code],
    queryFn: () => fn({ data: { code } }),
    staleTime: 10 * 60 * 1000,
    enabled: !!code,
  });

  const risk = data?.risk ?? null;
  if (!canSeeMaintenance) return null;
  const level: RiskLevel = risk?.level ?? "low";
  const score = risk?.score ?? 0;

  const tone =
    level === "critical"
      ? "border-destructive/60 bg-destructive/10"
      : level === "high"
      ? "border-destructive/40 bg-destructive/5"
      : level === "medium"
        ? "border-warning/40 bg-warning/5"
        : "border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20";

  return (
    <div className="p-5 border-b">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium">สุขภาพป้าย (Risk Score)</div>
        <div className="text-[11px] text-muted-foreground">คำนวณจากประวัติเคลม/PM • อัปเดตทุกคืน</div>
      </div>

      {isLoading ? (
        <div className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
      ) : (
        <div className={cn("rounded-xl border p-4", tone)}>
          <div className="flex items-center gap-3 flex-wrap">
            {level === "low" ? (
              <ShieldCheck className="size-6 text-emerald-600" />
            ) : (
              <ShieldAlert className={cn("size-6", isUrgentRisk(level) ? "text-destructive" : "text-warning")} />
            )}
            <div>
              <div className="text-2xl font-bold tabular-nums leading-none">
                {score}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {level === "critical" ? "ความเสี่ยงวิกฤต" : level === "high" ? "ความเสี่ยงสูง" : level === "medium" ? "ความเสี่ยงกลาง" : "ความเสี่ยงต่ำ"}
              </div>
            </div>
            <RiskChip level={level} score={score} className="ml-auto" />
          </div>

          <div className="mt-3 grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Metric
              icon={<Activity className="size-3.5" />}
              label="เคลม 30 / 90 / 365 วัน"
              value={`${risk?.claims30d ?? 0} / ${risk?.claims90d ?? 0} / ${risk?.claims365d ?? 0}`}
              hint={risk?.openClaims ? `ค้างอยู่ ${risk.openClaims} ตั๋ว` : "ไม่มีตั๋วค้าง"}
            />
            <Metric
              icon={<Wrench className="size-3.5" />}
              label="ปัญหาที่พบบ่อย"
              value={risk?.topProblem ?? "—"}
            />
            <Metric
              icon={<CalendarClock className="size-3.5" />}
              label="ตั้งแต่ PM ล่าสุด"
              value={risk?.daysSincePm != null ? `${risk.daysSincePm} วัน` : "—"}
              hint={`PM: ${fmtDate(risk?.lastPmAt ?? null)}`}
            />
            <Metric
              icon={<Activity className="size-3.5" />}
              label="เคลมล่าสุด"
              value={fmtDate(risk?.lastClaimAt ?? null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact "ป้ายเสี่ยงสูง" summary card (Dashboard / Asset History header).
 * Renders nothing while loading or when there is no signal.
 */
export function RiskSummaryCard({ onOpen }: { onOpen?: () => void }) {
  const { canSeeMaintenance } = useMyRoles();
  const { counts, isLoading } = useAssetRiskMap(canSeeMaintenance);
  if (!canSeeMaintenance || isLoading || !counts || (!counts.critical && !counts.high && !counts.medium)) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-xl border border-destructive/30 bg-destructive/5 p-4 transition hover:border-destructive/60"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="size-3.5 text-destructive" />
        ป้ายที่ต้องเฝ้าระวัง
      </div>
      <div className="mt-1 flex items-end gap-3">
        <div className="text-2xl font-semibold tabular-nums text-destructive">
          {counts.critical + counts.high}
        </div>
        <div className="text-xs text-muted-foreground pb-1">
          วิกฤต {counts.critical} • เสี่ยงสูง {counts.high} • เสี่ยงกลาง {counts.medium} ป้าย
        </div>
      </div>
    </button>
  );
}

/**
 * PM queue ordered by risk — high score + long time since last PM first.
 * Uses the nightly-computed table only (no extra queries per asset).
 */
export function RiskPmQueue({ limit = 12 }: { limit?: number }) {
  const { canSeeMaintenance } = useMyRoles();
  const { map, isLoading } = useAssetRiskMap(canSeeMaintenance);
  const rows = useMemo(() => {
    const list = Array.from(map.values()).filter((r) => r.level !== "low");
    return list
      .sort(
        (a, b) =>
          b.score - a.score || (b.daysSincePm ?? 0) - (a.daysSincePm ?? 0),
      )
      .slice(0, limit);
  }, [map, limit]);

  if (!canSeeMaintenance) return null;
  if (isLoading) return <div className="h-24 rounded-xl border bg-muted/30 animate-pulse" />;
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="size-4 text-destructive" />
          คิว PM ตามความเสี่ยง
        </div>
        <div className="text-[11px] text-muted-foreground">เรียงตามคะแนน + วันตั้งแต่ PM ล่าสุด</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Old Code</th>
              <th className="px-4 py-2 text-right font-medium">คะแนน</th>
              <th className="px-4 py-2 text-right font-medium">ตั้งแต่ PM</th>
              <th className="px-4 py-2 text-right font-medium">เคลม 90 วัน</th>
              <th className="px-4 py-2 text-left font-medium">ปัญหาที่พบบ่อย</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.code} className="hover:bg-accent/30">
                <td className="px-4 py-2 font-mono text-[12px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <a href={`/search?q=${encodeURIComponent(r.code)}`} className="hover:underline">
                      {r.code}
                    </a>
                    <RiskChip level={r.level} score={r.score} />
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.score}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.daysSincePm != null ? `${r.daysSincePm} วัน` : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.claims90d}</td>
                <td className="px-4 py-2">{r.topProblem ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
