import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAssetsForMap, type MapAsset } from "@/lib/map.functions";
import { Skeleton } from "@/components/ui/skeleton";

const AssetMap = lazy(() => import("@/components/asset-map"));

type ClaimLite = {
  ticket_code: string | null;
  asset_old_code: string | null;
  sla_status: string | null;
  total_time?: number | string | null;
  age_hours?: number | string | null;
};

type RiskInfo = { level: "critical" | "high" | "medium" | "low"; score: number };

export default function ClaimsMapView({
  claims,
  riskMap,
}: {
  claims: ClaimLite[];
  riskMap: Map<string, RiskInfo>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const fetchAssets = useServerFn(listAssetsForMap);
  const { data, isLoading } = useQuery({
    queryKey: ["map-assets"],
    queryFn: () => fetchAssets(),
    staleTime: 10 * 60_000,
  });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [riskMode, setRiskMode] = useState(false);

  const codes = useMemo(
    () => new Set(claims.map((c) => c.asset_old_code).filter(Boolean) as string[]),
    [claims],
  );
  const assets: MapAsset[] = useMemo(
    () => (data?.assets ?? []).filter((a) => a.old_code && codes.has(a.old_code)),
    [data, codes],
  );
  const found = new Set(assets.map((a) => a.old_code));
  const byCode = new Map(assets.map((a) => [a.old_code!, a]));

  const rows = useMemo(() => {
    const m = new Map<string, { code: string; tickets: number; breached: number; maxAge: number }>();
    for (const c of claims) {
      const k = c.asset_old_code ?? "";
      if (!k) continue;
      const age = c.total_time != null ? Number(c.total_time) : c.age_hours != null ? Number(c.age_hours) / 24 : 0;
      const r = m.get(k) ?? { code: k, tickets: 0, breached: 0, maxAge: 0 };
      r.tickets++;
      if (c.sla_status === "breached") r.breached++;
      r.maxAge = Math.max(r.maxAge, age);
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.breached - a.breached || b.maxAge - a.maxAge);
  }, [claims]);

  if (!mounted || isLoading) return <Skeleton className="h-[600px] w-full rounded-xl" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b text-xs text-muted-foreground">
          <span>
            แสดง {assets.length} ป้ายบนแผนที่ จาก {codes.size} ป้ายที่มีเคลม
            {codes.size - assets.length > 0 && ` (ไม่มีพิกัด ${codes.size - assets.length})`}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={riskMode} onChange={(e) => setRiskMode(e.target.checked)} />
            สีตามความเสี่ยง
          </label>
        </div>
        <div className="h-[600px]">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <AssetMap
              assets={assets}
              claimedCodes={codes}
              focusId={focusId}
              focusNonce={nonce}
              showRadiusRings={false}
              riskMode={riskMode}
              riskByCode={riskMap}
            />
          </Suspense>
        </div>
      </div>
      <div className="rounded-xl border bg-card overflow-hidden flex flex-col max-h-[641px]">
        <div className="px-3 py-2 border-b text-sm font-medium">ป้ายที่มีเคลม ({rows.length})</div>
        <div className="overflow-y-auto divide-y">
          {rows.map((r) => {
            const a = byCode.get(r.code);
            const risk = riskMap.get(r.code);
            return (
              <button
                key={r.code}
                type="button"
                disabled={!a}
                onClick={() => { if (a) { setFocusId(a.id); setNonce((n) => n + 1); } }}
                className="w-full text-left px-3 py-2 hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.code}</span>
                  <span className="text-xs text-muted-foreground">{r.maxAge.toFixed(1)} วัน</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{a?.name ?? "ไม่มีพิกัด"}</div>
                <div className="flex gap-2 text-[11px] mt-0.5">
                  <span>{r.tickets} ticket</span>
                  {r.breached > 0 && <span className="text-destructive">เกิน SLA {r.breached}</span>}
                  {risk && <span className="text-muted-foreground">Risk {Math.round(risk.score)}</span>}
                </div>
              </button>
            );
          })}
          {found.size === 0 && rows.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</div>
          )}
        </div>
      </div>
    </div>
  );
}
