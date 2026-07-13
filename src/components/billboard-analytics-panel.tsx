import { lazy, Suspense, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Loader2, TrendingUp, Users, Clock, MapPin, Building2, RefreshCcw, Camera, ChevronDown } from "lucide-react";
import { analyzeBillboardArea, type BillboardAnalytics } from "@/lib/billboard-analytics.functions";
import type { MapAsset } from "@/lib/map.functions";

const StreetViewPanel = lazy(() => import("@/components/street-view-panel"));

type Props = {
  asset: MapAsset;
  onClose: () => void;
};

const DEMO_COLORS: Record<string, string> = {
  office: "#3b82f6",
  student: "#6366f1",
  shopper: "#a855f7",
  resident: "#059669",
  tourist: "#f59e0b",
};

const DEMO_LABELS: Record<string, string> = {
  office: "พนักงานออฟฟิศ",
  student: "นักเรียน / นักศึกษา",
  shopper: "นักช้อป",
  resident: "ผู้อยู่อาศัย",
  tourist: "นักท่องเที่ยว",
};

export default function BillboardAnalyticsPanel({ asset, onClose }: Props) {
  const analyze = useServerFn(analyzeBillboardArea);
  const [radiusM, setRadiusM] = useState<number>(500);
  const [data, setData] = useState<BillboardAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showStreet, setShowStreet] = useState(false);

  const run = async (r: number) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await analyze({ data: { lat: asset.lat, lng: asset.lng, radiusM: r } });
      setData(res);
      if (!res.ok) setErr(res.error ?? "วิเคราะห์ไม่สำเร็จ");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run(radiusM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id]);

  return (
    <div className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b p-4 flex items-start justify-between z-10 gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <MapPin className="size-3" />
              วิเคราะห์พื้นที่รอบป้าย ({radiusM} ม.)
            </div>
            <div className="text-base font-semibold truncate">{asset.old_code ?? "—"}</div>
            <div className="text-xs text-muted-foreground truncate">{asset.name ?? asset.location ?? "—"}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              <span className="text-muted-foreground">Department:</span>
              <span className="truncate">{asset.department ?? "—"}</span>
              <span className="text-muted-foreground">Media Type:</span>
              <span className="truncate">{asset.media_type ?? "—"}</span>
              <span className="text-muted-foreground">Location:</span>
              <span className="truncate">{asset.location ?? "—"}</span>
              <span className="text-muted-foreground">Status:</span>
              <span className="truncate">{asset.status ?? "—"}</span>
            </div>
            {asset.old_code && (
              <a
                href={`/search?q=${encodeURIComponent(asset.old_code)}`}
                className="inline-block mt-2 text-xs text-primary hover:underline"
              >
                ดูประวัติป้าย →
              </a>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded shrink-0">
            <X className="size-4" />
          </button>
        </div>


        {/* Radius selector */}
        <div className="p-4 border-b flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">รัศมี:</span>
          {[200, 500, 1000, 2000].map((r) => (
            <button
              key={r}
              onClick={() => { setRadiusM(r); void run(r); }}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                radiusM === r ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
              }`}
              disabled={loading}
            >
              {r >= 1000 ? `${r / 1000} กม.` : `${r} ม.`}
            </button>
          ))}
          <button
            onClick={() => void run(radiusM)}
            disabled={loading}
            className="ml-auto p-1.5 hover:bg-accent rounded"
            title="รีเฟรช"
          >
            <RefreshCcw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" />
              กำลังดึงข้อมูลจาก OpenStreetMap...
            </div>
          )}

          {!loading && err && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
              {err}
            </div>
          )}

          {!loading && data && data.ok && (
            <>
              {/* Traffic score */}
              <section className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                  <TrendingUp className="size-3.5" />
                  ระดับการจราจร (Traffic)
                </div>
                <div className="flex items-end gap-3">
                  <div className="text-2xl font-bold">{data.trafficScore}</div>
                  <div className="text-sm mb-1">/ 100</div>
                  <div className="ml-auto text-sm font-semibold px-2 py-0.5 rounded-full border">
                    {data.trafficLabel}
                  </div>
                </div>
                <div className="mt-2 h-2 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500"
                    style={{ width: `${data.trafficScore}%` }}
                  />
                </div>
                {data.nearestRoad && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    ถนนใกล้ที่สุด: <span className="font-medium text-foreground">
                      {data.nearestRoad.name ?? "(ไม่ระบุชื่อ)"}
                    </span>
                    {" · "}ประเภท {data.nearestRoad.class} · {data.nearestRoad.distanceM} ม.
                  </div>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                  ประมาณการเห็นต่อวัน: <span className="font-medium text-foreground">
                    {data.estimatedDailyImpressions.min.toLocaleString()} – {data.estimatedDailyImpressions.max.toLocaleString()}
                  </span> ครั้ง
                </div>
              </section>

              {/* Demographics */}
              <section className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-3">
                  <Users className="size-3.5" />
                  ประชากรเป้าหมาย (จำลอง)
                </div>
                <div className="flex h-3 rounded overflow-hidden mb-3">
                  {(Object.keys(DEMO_LABELS) as Array<keyof typeof DEMO_LABELS>).map((k) => {
                    const v = data.demographics[k as keyof BillboardAnalytics["demographics"]];
                    if (v <= 0) return null;
                    return (
                      <div key={k} style={{ width: `${v}%`, background: DEMO_COLORS[k] }} title={`${DEMO_LABELS[k]} ${v}%`} />
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(Object.keys(DEMO_LABELS) as Array<keyof typeof DEMO_LABELS>)
                    .map((k) => ({ k, v: data.demographics[k as keyof BillboardAnalytics["demographics"]] }))
                    .sort((a, b) => b.v - a.v)
                    .map(({ k, v }) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: DEMO_COLORS[k] }} />
                        <span className="text-muted-foreground">{DEMO_LABELS[k]}</span>
                        <span className="ml-auto font-semibold">{v}%</span>
                      </div>
                    ))}
                </div>
              </section>

              {/* Peak hours */}
              {data.peakHours.length > 0 && (
                <section className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                    <Clock className="size-3.5" />
                    ช่วงเวลาที่คนหนาแน่น
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {data.peakHours.map((h) => (
                      <span key={h} className="px-2 py-1 rounded-md bg-accent text-xs font-medium">{h}</span>
                    ))}
                  </div>
                </section>
              )}

              {/* POI buckets */}
              <section className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                  <Building2 className="size-3.5" />
                  สถานที่ใกล้เคียง ({data.totalPOIs.toLocaleString()} แห่ง)
                </div>
                {data.buckets.length === 0 ? (
                  <div className="text-xs text-muted-foreground">ไม่พบ POI ในรัศมีที่เลือก</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.buckets.map((b) => {
                      const max = Math.max(...data.buckets.map((x) => x.count));
                      const pct = max > 0 ? (b.count / max) * 100 : 0;
                      return (
                        <div key={b.key} className="flex items-center gap-2 text-xs">
                          <span>{b.icon}</span>
                          <span className="w-32 truncate">{b.label}</span>
                          <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${pct}%`, background: b.color }} />
                          </div>
                          <span className="w-8 text-right font-semibold">{b.count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Top nearby POIs */}
              {data.topPOIs.length > 0 && (
                <section className="rounded-lg border p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    POI ที่ใกล้ที่สุด
                  </div>
                  <div className="space-y-1 text-xs">
                    {data.topPOIs.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-muted-foreground">{p.category}</span>
                        <span className="w-14 text-right font-mono">{p.distanceM} ม.</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Notes */}
              {data.notes.length > 0 && (
                <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="text-xs font-medium mb-1">ข้อสังเกต</div>
                  <ul className="text-xs list-disc pl-4 space-y-0.5">
                    {data.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </section>
              )}

              <div className="text-[10px] text-muted-foreground text-center pt-2">
                ข้อมูลจาก OpenStreetMap (Overpass API) — ตัวเลขประชากร/ยอดเห็น เป็นการประมาณด้วยฮิวริสติก ไม่ใช่การวัดจริง
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
