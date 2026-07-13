import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Loader2, TrendingUp, Users, Clock, MapPin, Building2, RefreshCcw, Camera, ChevronDown, Image as ImageIcon, FileDown, FileText } from "lucide-react";
import { toast } from "sonner";
import { analyzeBillboardArea, type BillboardAnalytics } from "@/lib/billboard-analytics.functions";
import { getStreetViewStaticImage, updateBillboardMockup, type BillboardMockup, type BillboardMockupOverlay } from "@/lib/billboard-mockups.functions";
import { captureStreetViewNode, exportBillboardPptx, exportBillboardPdf, fetchImageAsDataUrl } from "@/lib/billboard-export";
import MockupManager from "@/components/mockup-manager";
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
  const updateMockupFn = useServerFn(updateBillboardMockup);
  const getStreetViewImg = useServerFn(getStreetViewStaticImage);
  const [radiusM, setRadiusM] = useState<number>(500);
  const [data, setData] = useState<BillboardAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showStreet, setShowStreet] = useState(false);
  const [showMockup, setShowMockup] = useState(false);
  const [selectedMockup, setSelectedMockup] = useState<BillboardMockup | null>(null);
  const [overlay, setOverlay] = useState<BillboardMockupOverlay | null>(null);
  const [editOverlay, setEditOverlay] = useState(true);
  const [exporting, setExporting] = useState<null | "pptx" | "pdf">(null);
  const [cornerPickStep, setCornerPickStep] = useState<0 | 1 | 2 | 3 | null>(null);
  const [capturingHero, setCapturingHero] = useState(false);
  const streetViewCaptureRef = useRef<HTMLDivElement | null>(null);

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

  const reportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedMockup) {
      setOverlay(null);
      return;
    }
    setShowStreet(true);
    const base: BillboardMockupOverlay = {
      keepAspect: true,
      skewX: 0,
      skewY: 0,
      ...selectedMockup.overlay,
    };
    setOverlay(base);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      setOverlay((cur) => {
        if (!cur) return cur;
        const containerAspect = 16 / 9;
        const h = (cur.w / aspect) * containerAspect;
        const nh = Math.min(Math.max(h, 5), 100 - cur.y);
        // Auto-enable Distort mode: pre-populate 4 corners from the rect so the
        // user can immediately drag any corner freely (Photoshop-style Distort).
        const corners = cur.corners ?? {
          tl: { x: cur.x, y: cur.y },
          tr: { x: cur.x + cur.w, y: cur.y },
          br: { x: cur.x + cur.w, y: cur.y + nh },
          bl: { x: cur.x, y: cur.y + nh },
        };
        return { ...cur, naturalAspect: aspect, h: nh, corners };
      });
    };
    img.src = selectedMockup.image_url;
  }, [selectedMockup]);


  // Debounced persist of overlay position.
  useEffect(() => {
    if (!selectedMockup || !overlay) return;
    const start = JSON.stringify(selectedMockup.overlay);
    const cur = JSON.stringify(overlay);
    if (start === cur) return;
    const t = window.setTimeout(() => {
      void updateMockupFn({ data: { id: selectedMockup.id, overlay } }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [overlay, selectedMockup, updateMockupFn]);

  const handleExport = async (kind: "pptx" | "pdf") => {
    setExporting(kind);
    try {
      setShowStreet(true);
      setCapturingHero(true);
      await waitForStreetViewSnapshotTarget(streetViewCaptureRef);
      let streetViewDataUrl = streetViewCaptureRef.current
        ? await captureStreetViewNode(streetViewCaptureRef.current)
        : null;
      // captureStreetViewNode grabs the raw Street View WebGL canvas (no HTML
      // overlay), so we always re-composite the mockup on top below.
      if (!streetViewDataUrl) {
        const sv = await getStreetViewImg({
          data: { lat: asset.lat, lng: asset.lng, heading: 0, size: "640x360" },
        });
        streetViewDataUrl = sv.ok ? sv.dataUrl ?? null : null;
        if (!sv.ok) toast.warning(`Street View: ${sv.error ?? "ไม่พร้อม"}`);
      }
      const heroAlreadyIncludesMockup = false;
      let mockupDataUrl: string | null = null;
      if (!heroAlreadyIncludesMockup && selectedMockup?.image_url) {
        try {
          mockupDataUrl = await fetchImageAsDataUrl(selectedMockup.image_url);
        } catch {
          toast.warning("โหลดภาพ Mockup ไม่สำเร็จ");
        }
      }
      const payload = {
        asset,
        analytics: data,
        streetViewDataUrl,
        mockup: selectedMockup,
        mockupDataUrl,
        overlay: heroAlreadyIncludesMockup ? null : overlay ?? selectedMockup?.overlay ?? null,
        analyticsNode: reportRef.current,
      };
      if (kind === "pptx") await exportBillboardPptx(payload);
      else await exportBillboardPdf(payload);
      toast.success(`ส่งออก ${kind.toUpperCase()} สำเร็จ`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCapturingHero(false);
      setExporting(null);
    }
  };

  const handleCornerPick = (x: number, y: number) => {
    if (!overlay || cornerPickStep == null) return;
    const current = overlay.corners ?? {
      tl: { x: overlay.x, y: overlay.y },
      tr: { x: overlay.x + overlay.w, y: overlay.y },
      br: { x: overlay.x + overlay.w, y: overlay.y + overlay.h },
      bl: { x: overlay.x, y: overlay.y + overlay.h },
    };
    const next = {
      tl: { ...current.tl },
      tr: { ...current.tr },
      br: { ...current.br },
      bl: { ...current.bl },
    };
    const key = (["tl", "tr", "br", "bl"] as const)[cornerPickStep];
    next[key] = { x, y };
    const xs = [next.tl.x, next.tr.x, next.br.x, next.bl.x];
    const ys = [next.tl.y, next.tr.y, next.br.y, next.bl.y];
    setOverlay({
      ...overlay,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(3, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(3, Math.max(...ys) - Math.min(...ys)),
      corners: next,
    });
    setCornerPickStep(cornerPickStep >= 3 ? null : ((cornerPickStep + 1) as 0 | 1 | 2 | 3));
  };

  return (
    <div className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="bg-card border rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto"
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

        {/* Street View */}
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => setShowStreet((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border hover:bg-accent transition-colors"
          >
            <Camera className="size-4" />
            <span>Street View</span>
            <ChevronDown className={`size-4 ml-auto transition-transform ${showStreet ? "rotate-180" : ""}`} />
          </button>
          {showStreet && Number.isFinite(asset.lat) && Number.isFinite(asset.lng) && (
            <div className="mt-2 space-y-2">
              <Suspense
                fallback={
                  <div className="h-[320px] flex items-center justify-center rounded-md border bg-muted text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin mr-2" /> กำลังโหลด…
                  </div>
                }
              >
                <div ref={streetViewCaptureRef}>
                  <StreetViewPanel
                    lat={asset.lat}
                    lng={asset.lng}
                    overlayImageUrl={selectedMockup?.image_url}
                    overlay={overlay ?? undefined}
                    onOverlayChange={setOverlay}
                    editable={editOverlay && !!selectedMockup && !capturingHero}
                    cornerPickStep={capturingHero ? null : cornerPickStep}
                    onCornerPick={handleCornerPick}
                  />
                </div>
              </Suspense>
              {selectedMockup && overlay && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2.5 text-xs">
                  {/* Row 1: mode + reset */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">โหมดปรับภาพ (Distort)</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={editOverlay}
                          onChange={(e) => setEditOverlay(e.target.checked)}
                        />
                        แก้ไขได้
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowStreet(true);
                          setEditOverlay(true);
                          setCornerPickStep(0);
                        }}
                        className="px-2 py-1 rounded-md border bg-card hover:bg-accent font-medium"
                        title="คลิกทีละมุมบนภาพเพื่อจัดตำแหน่งใหม่"
                      >
                        คลิกปรับ 4 มุม
                      </button>
                      {overlay.corners && (
                        <button
                          type="button"
                          onClick={() => {
                            const nh = overlay.naturalAspect
                              ? Math.min(Math.max((overlay.w / overlay.naturalAspect) * (16 / 9), 5), 100 - overlay.y)
                              : overlay.h;
                            setOverlay({
                              ...overlay,
                              h: nh,
                              corners: {
                                tl: { x: overlay.x, y: overlay.y },
                                tr: { x: overlay.x + overlay.w, y: overlay.y },
                                br: { x: overlay.x + overlay.w, y: overlay.y + nh },
                                bl: { x: overlay.x, y: overlay.y + nh },
                              },
                            });
                            setCornerPickStep(null);
                          }}
                          className="px-2 py-1 rounded-md border bg-card hover:bg-accent"
                        >
                          รีเซ็ตมุม
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: opacity */}
                  <div className="grid grid-cols-[70px_1fr_40px] items-center gap-2">
                    <span className="text-muted-foreground">Opacity</span>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={overlay.opacity}
                      onChange={(e) => setOverlay({ ...overlay, opacity: parseFloat(e.target.value) })}
                    />
                    <span className="tabular-nums text-right">{Math.round(overlay.opacity * 100)}%</span>
                  </div>

                  {/* Row 3: rotate */}
                  <div className="grid grid-cols-[70px_1fr_40px] items-center gap-2">
                    <span className="text-muted-foreground">หมุน</span>
                    <input
                      type="range"
                      min={-45}
                      max={45}
                      step={1}
                      value={overlay.rotation}
                      onChange={(e) => setOverlay({ ...overlay, rotation: parseInt(e.target.value, 10) })}
                    />
                    <span className="tabular-nums text-right">{overlay.rotation}°</span>
                  </div>

                  {/* Row 4: skew X / Y side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid grid-cols-[54px_1fr_36px] items-center gap-2">
                      <span className="text-muted-foreground">เอียง X</span>
                      <input
                        type="range"
                        min={-30}
                        max={30}
                        step={1}
                        value={overlay.skewX ?? 0}
                        onChange={(e) => setOverlay({ ...overlay, skewX: parseInt(e.target.value, 10) })}
                      />
                      <span className="tabular-nums text-right">{overlay.skewX ?? 0}°</span>
                    </div>
                    <div className="grid grid-cols-[54px_1fr_36px] items-center gap-2">
                      <span className="text-muted-foreground">เอียง Y</span>
                      <input
                        type="range"
                        min={-30}
                        max={30}
                        step={1}
                        value={overlay.skewY ?? 0}
                        onChange={(e) => setOverlay({ ...overlay, skewY: parseInt(e.target.value, 10) })}
                      />
                      <span className="tabular-nums text-right">{overlay.skewY ?? 0}°</span>
                    </div>
                  </div>

                  <div className="text-[10px] text-muted-foreground pt-1 border-t">
                    เคล็ดลับ: ลากจุดสีน้ำเงินที่มุมทั้ง 4 บนภาพเพื่อบิดภาพให้พอดีขอบป้าย (แบบ Photoshop Distort)
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Mockup manager */}
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => setShowMockup((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border hover:bg-accent transition-colors"
          >
            <ImageIcon className="size-4" />
            <span>Mockup โฆษณา{selectedMockup ? ` · ${selectedMockup.title ?? "1 ภาพเลือกอยู่"}` : ""}</span>
            <ChevronDown className={`size-4 ml-auto transition-transform ${showMockup ? "rotate-180" : ""}`} />
          </button>
          {showMockup && asset.old_code && (
            <div className="mt-2">
              <MockupManager
                oldCode={asset.old_code}
                selectedId={selectedMockup?.id ?? null}
                onSelect={setSelectedMockup}
              />
            </div>
          )}
          {showMockup && !asset.old_code && (
            <div className="mt-2 text-xs text-muted-foreground">ป้ายนี้ไม่มีรหัส — อัปโหลด Mockup ไม่ได้</div>
          )}
        </div>

        {/* Export */}
        <div className="px-4 pt-3">
          <div className="rounded-md border p-3 flex items-center gap-2 flex-wrap">
            <div className="text-xs font-medium mr-1">ส่งออกรายงาน:</div>
            <button
              onClick={() => void handleExport("pptx")}
              disabled={exporting !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs hover:bg-accent disabled:opacity-50"
            >
              {exporting === "pptx" ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
              PPTX
            </button>
            <button
              onClick={() => void handleExport("pdf")}
              disabled={exporting !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs hover:bg-accent disabled:opacity-50"
            >
              {exporting === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              PDF
            </button>
            <span className="text-[11px] text-muted-foreground ml-1">
              รวม Street View + Mockup (ถ้ามี) + Analytics
            </span>
          </div>
        </div>

        {/* Body */}
        <div ref={reportRef} className="p-4 space-y-4">

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

async function waitForStreetViewSnapshotTarget(ref: React.RefObject<HTMLDivElement | null>) {
  const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
  await wait(0);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const started = Date.now();
  while (Date.now() - started < 3500) {
    const el = ref.current;
    const text = el?.textContent ?? "";
    if (el && !text.includes("กำลังโหลด") && (el.querySelector(".gm-style") || el.querySelector("img") || el.querySelector("canvas"))) {
      await wait(350);
      return;
    }
    await wait(150);
  }
}
