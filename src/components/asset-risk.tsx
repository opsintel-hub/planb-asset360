// Shared risk-score UI (reads public.asset_risk_scores — no AI, no paid API).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, ShieldCheck, Activity, CalendarClock, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
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
  if (level !== "high" && level !== "medium") return null;
  const label = level === "high" ? "เสี่ยงสูง" : "เสี่ยงกลาง";
  return (
    <span
      title={`คะแนนความเสี่ยง ${score ?? 0}/100`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium align-middle",
        level === "high"
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
  const fn = useServerFn(getAssetRisk);
  const { data, isLoading } = useQuery({
    queryKey: ["asset-risk", code],
    queryFn: () => fn({ data: { code } }),
    staleTime: 10 * 60 * 1000,
    enabled: !!code,
  });

  const risk = data?.risk ?? null;
  const level: RiskLevel = risk?.level ?? "low";
  const score = risk?.score ?? 0;

  const tone =
    level === "high"
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
              <ShieldAlert className={cn("size-6", level === "high" ? "text-destructive" : "text-warning")} />
            )}
            <div>
              <div className="text-2xl font-bold tabular-nums leading-none">
                {score}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {level === "high" ? "ความเสี่ยงสูง" : level === "medium" ? "ความเสี่ยงกลาง" : "ความเสี่ยงต่ำ"}
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
