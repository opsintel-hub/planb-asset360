/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import type { BillboardMockupOverlay } from "@/lib/billboard-mockups.functions";

type Props = {
  lat: number;
  lng: number;
  heading?: number;
  viewState?: { heading?: number; pitch?: number; zoom?: number };
  onViewStateChange?: (view: { heading: number; pitch: number; zoom: number }) => void;
  overlayImageUrl?: string;
  overlay?: BillboardMockupOverlay;
  onOverlayChange?: (o: BillboardMockupOverlay) => void;
  editable?: boolean;
  cornerPickStep?: 0 | 1 | 2 | 3 | null;
  onCornerPick?: (x: number, y: number) => void;
  /** When true, container fills parent height instead of default clamp height. */
  fillParent?: boolean;
};

type Status = "loading" | "ready" | "no-imagery" | "error";
type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "tl" | "tr" | "br" | "bl";

type CornerKey = "tl" | "tr" | "br" | "bl";
type Point = { x: number; y: number };

const CORNER_LABELS: Record<CornerKey, string> = {
  tl: "1",
  tr: "2",
  br: "3",
  bl: "4",
};

const PICK_LABELS = ["มุมซ้ายบน", "มุมขวาบน", "มุมขวาล่าง", "มุมซ้ายล่าง"] as const;

function rectToCorners(o: BillboardMockupOverlay): NonNullable<BillboardMockupOverlay["corners"]> {
  return {
    tl: { x: o.x, y: o.y },
    tr: { x: o.x + o.w, y: o.y },
    br: { x: o.x + o.w, y: o.y + o.h },
    bl: { x: o.x, y: o.y + o.h },
  };
}

function boundsFromCorners(corners: NonNullable<BillboardMockupOverlay["corners"]>) {
  const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x];
  const ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: Math.max(3, maxX - minX), h: Math.max(3, maxY - minY) };
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let k = col; k <= n; k += 1) a[col][k] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row) => row[n]);
}

function cssMatrixForCorners(corners: NonNullable<BillboardMockupOverlay["corners"]>, box: DOMRect | null) {
  if (!box || box.width <= 0 || box.height <= 0) return undefined;
  const src = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];
  const dst = [corners.tl, corners.tr, corners.br, corners.bl].map((p) => ({
    x: (p.x / 100) * box.width,
    y: (p.y / 100) * box.height,
  }));
  const m: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const u = dst[i].x;
    const v = dst[i].y;
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinearSystem(m, b);
  if (!h) return undefined;
  const [a, b2, c, d, e, f, g, h2] = h;
  return `matrix3d(${a},${d},0,${g},${b2},${e},0,${h2},0,0,1,0,${c},${f},0,1)`;
}

export default function StreetViewPanel({
  lat,
  lng,
  heading = 0,
  viewState,
  onViewStateChange,
  overlayImageUrl,
  overlay,
  onOverlayChange,
  editable = false,
  cornerPickStep = null,
  onCornerPick,
  fillParent = false,
}: Props) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [msg, setMsg] = useState<string>("");
  const [box, setBox] = useState<DOMRect | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];
    setStatus("loading");
    setMsg("");
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !svRef.current) return;
        const svc = new google.maps.StreetViewService();
        svc.getPanorama(
          { location: { lat, lng }, radius: 80, source: google.maps.StreetViewSource.OUTDOOR },
          (data, statusCode) => {
            if (cancelled || !svRef.current) return;
            if (statusCode !== google.maps.StreetViewStatus.OK || !data?.location?.latLng) {
              setStatus("no-imagery");
              return;
            }
            const panorama = new google.maps.StreetViewPanorama(svRef.current, {
              position: data.location.latLng,
              pov: { heading: viewState?.heading ?? heading, pitch: viewState?.pitch ?? 0 },
              zoom: viewState?.zoom ?? 0,
              addressControl: false,
              fullscreenControl: true,
              motionTracking: false,
              motionTrackingControl: false,
              panControl: true,
              zoomControl: true,
              linksControl: true,
            });
            panoramaRef.current = panorama;
            const emitViewState = () => {
              const pov = panorama.getPov();
              const zoom = panorama.getZoom();
              onViewStateChange?.({
                heading: pov.heading,
                pitch: pov.pitch,
                zoom: typeof zoom === "number" ? zoom : 0,
              });
            };
            listeners.push(panorama.addListener("pov_changed", emitViewState));
            listeners.push(panorama.addListener("zoom_changed", emitViewState));
            emitViewState();
            setStatus("ready");
          },
        );
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setStatus("error");
        setMsg(e.message);
      });
    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      panoramaRef.current = null;
    };
  }, [lat, lng, heading]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ratio = 16 / 9;
      const width = Math.min(rect.width, rect.height * ratio);
      const height = width / ratio;
      setFrameSize((cur) => {
        if (cur && Math.abs(cur.width - width) < 0.5 && Math.abs(cur.height - height) < 0.5) return cur;
        return { width, height };
      });
      setBox(new DOMRect(0, 0, width, height));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const panorama = panoramaRef.current;
    if (!panorama || typeof google === "undefined") return;
    const id = window.requestAnimationFrame(() => {
      google.maps.event.trigger(panorama, "resize");
    });
    return () => window.cancelAnimationFrame(id);
  }, [frameSize?.width, frameSize?.height]);

  const dragState = useRef<{
    mode: Handle | null;
    startX: number;
    startY: number;
    start: BillboardMockupOverlay;
    box: DOMRect;
  }>({
    mode: null,
    startX: 0,
    startY: 0,
    start: overlay ?? { x: 25, y: 30, w: 50, h: 25, opacity: 0.85, rotation: 0 },
    box: new DOMRect(),
  });

  const onPointerDown = (mode: Handle, e: React.PointerEvent) => {
    if (!editable || !overlay || !onOverlayChange || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...overlay },
      box: containerRef.current.getBoundingClientRect(),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s.mode || !onOverlayChange) return;
    const dxPct = ((e.clientX - s.startX) / s.box.width) * 100;
    const dyPct = ((e.clientY - s.startY) / s.box.height) * 100;
    const st = s.start;
    const aspect = st.keepAspect && st.naturalAspect ? st.naturalAspect : null;
    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

    if (["tl", "tr", "br", "bl"].includes(s.mode)) {
      const key = s.mode as CornerKey;
      const corners = st.corners ?? rectToCorners(st);
      const nextCorners = {
        tl: { ...corners.tl },
        tr: { ...corners.tr },
        br: { ...corners.br },
        bl: { ...corners.bl },
      };
      nextCorners[key] = {
        x: clamp(corners[key].x + dxPct, 0, 100),
        y: clamp(corners[key].y + dyPct, 0, 100),
      };
      onOverlayChange({ ...st, ...boundsFromCorners(nextCorners), corners: nextCorners });
      return;
    }

    if (s.mode === "move") {
      if (st.corners) {
        const nextCorners = {
          tl: { x: clamp(st.corners.tl.x + dxPct, 0, 100), y: clamp(st.corners.tl.y + dyPct, 0, 100) },
          tr: { x: clamp(st.corners.tr.x + dxPct, 0, 100), y: clamp(st.corners.tr.y + dyPct, 0, 100) },
          br: { x: clamp(st.corners.br.x + dxPct, 0, 100), y: clamp(st.corners.br.y + dyPct, 0, 100) },
          bl: { x: clamp(st.corners.bl.x + dxPct, 0, 100), y: clamp(st.corners.bl.y + dyPct, 0, 100) },
        };
        onOverlayChange({ ...st, ...boundsFromCorners(nextCorners), corners: nextCorners });
        return;
      }
      onOverlayChange({
        ...st,
        x: clamp(st.x + dxPct, 0, 100 - st.w),
        y: clamp(st.y + dyPct, 0, 100 - st.h),
      });
      return;
    }
    let { x, y, w, h } = st;
    if (s.mode.includes("e")) w = clamp(st.w + dxPct, 3, 100 - st.x);
    if (s.mode.includes("w")) {
      const nw = clamp(st.w - dxPct, 3, st.x + st.w);
      x = st.x + (st.w - nw);
      w = nw;
    }
    if (s.mode.includes("s")) h = clamp(st.h + dyPct, 3, 100 - st.y);
    if (s.mode.includes("n")) {
      const nh = clamp(st.h - dyPct, 3, st.y + st.h);
      y = st.y + (st.h - nh);
      h = nh;
    }
    if (aspect) {
      // adjust h to match aspect (using box pixel aspect to keep image ratio truly)
      const pxAspect = (w / 100) * s.box.width / ((h / 100) * s.box.height);
      // Simpler: force h so displayed image ratio matches aspect
      const targetHpx = ((w / 100) * s.box.width) / aspect;
      const targetHpct = (targetHpx / s.box.height) * 100;
      if (s.mode.includes("n")) {
        y = st.y + st.h - targetHpct;
      }
      h = clamp(targetHpct, 3, 100 - y);
      void pxAspect;
    }
    onOverlayChange({ ...st, x, y, w, h });
  };

  const onPointerUp = () => {
    dragState.current.mode = null;
  };

  const overlayTransform = overlay
    ? `rotate(${overlay.rotation}deg) skew(${overlay.skewX ?? 0}deg, ${overlay.skewY ?? 0}deg)`
    : undefined;
  const corners = overlay?.corners;
  const perspectiveTransform = corners ? cssMatrixForCorners(corners, box) : undefined;

  const handlePick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cornerPickStep == null || !onCornerPick || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onCornerPick(Math.min(100, Math.max(0, x)), Math.min(100, Math.max(0, y)));
  };

  return (
    <div
      ref={outerRef}
      className={`relative w-full rounded-md overflow-hidden border bg-muted select-none flex items-center justify-center ${fillParent ? "h-full" : ""}`}
      style={fillParent ? undefined : { height: "clamp(360px, 55vh, 640px)" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        ref={containerRef}
        className="relative overflow-hidden bg-muted"
        style={frameSize ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` } : { width: "100%", aspectRatio: "16 / 9" }}
      >
        <div ref={svRef} className="absolute inset-0" />

      {overlayImageUrl && overlay && status === "ready" && corners && (
        <>
          <div
            className={`absolute inset-0 z-30 ${editable ? "ring-2 ring-primary/70" : "pointer-events-none"}`}
            style={{
              opacity: overlay.opacity,
              transform: perspectiveTransform,
              transformOrigin: "0 0",
              pointerEvents: editable ? "auto" : "none",
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0, black 2px, black calc(100% - 2px), transparent 100%), linear-gradient(to bottom, transparent 0, black 2px, black calc(100% - 2px), transparent 100%)",
              WebkitMaskComposite: "source-in",
              maskImage:
                "linear-gradient(to right, transparent 0, black 2px, black calc(100% - 2px), transparent 100%), linear-gradient(to bottom, transparent 0, black 2px, black calc(100% - 2px), transparent 100%)",
              maskComposite: "intersect",
            }}
          >
            <img
              src={overlayImageUrl}
              alt="mockup overlay"
              className="w-full h-full object-fill pointer-events-none"
              draggable={false}
              style={{ filter: `brightness(${overlay.brightness ?? 1})` }}
            />
          </div>
          {editable && (
            <>
              <button
                type="button"
                aria-label="move mockup"
                className="absolute z-40 border border-primary/50 bg-primary/10 cursor-move"
                style={{
                  left: `${Math.min(corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x)}%`,
                  top: `${Math.min(corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y)}%`,
                  width: `${Math.max(3, Math.max(corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x) - Math.min(corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x))}%`,
                  height: `${Math.max(3, Math.max(corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y) - Math.min(corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y))}%`,
                }}
                onPointerDown={(e) => onPointerDown("move", e)}
              />
              {(Object.keys(corners) as CornerKey[]).map((key) => {
                const p = corners[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onPointerDown={(e) => onPointerDown(key, e)}
                    className="absolute z-50 flex items-center justify-center size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing bg-transparent"
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    aria-label={`corner ${CORNER_LABELS[key]}`}
                    title={`ลากมุม ${CORNER_LABELS[key]} เพื่อบิดภาพ (Distort)`}
                  >
                    <span className="pointer-events-none block size-3 rounded-full bg-primary/80 ring-2 ring-white/90 shadow transition-transform hover:scale-150" />
                  </button>
                );
              })}

            </>
          )}
        </>
      )}

      {overlayImageUrl && overlay && status === "ready" && !corners && (
        <div
          className={`absolute z-30 ${editable ? "ring-2 ring-primary/70" : "pointer-events-none"}`}
          style={{
            left: `${overlay.x}%`,
            top: `${overlay.y}%`,
            width: `${overlay.w}%`,
            height: `${overlay.h}%`,
            opacity: overlay.opacity,
            transform: overlayTransform,
            transformOrigin: "center",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, black 2px, black calc(100% - 2px), transparent 100%), linear-gradient(to bottom, transparent 0, black 2px, black calc(100% - 2px), transparent 100%)",
            WebkitMaskComposite: "source-in",
            maskImage:
              "linear-gradient(to right, transparent 0, black 2px, black calc(100% - 2px), transparent 100%), linear-gradient(to bottom, transparent 0, black 2px, black calc(100% - 2px), transparent 100%)",
            maskComposite: "intersect",
          }}
        >
          <img
            src={overlayImageUrl}
            alt="mockup overlay"
            className="w-full h-full object-fill pointer-events-none"
            draggable={false}
            style={{ filter: `brightness(${overlay.brightness ?? 1})` }}
          />
          {editable && (
            <>
              <div className="absolute inset-0 cursor-move" onPointerDown={(e) => onPointerDown("move", e)} />
              {/* Corner handles */}
              {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
                <div
                  key={h}
                  onPointerDown={(e) => onPointerDown(h, e)}
                  className="absolute size-3 rounded-sm bg-primary shadow border border-white cursor-nwse-resize"
                  style={{
                    left: h.includes("w") ? -6 : undefined,
                    right: h.includes("e") ? -6 : undefined,
                    top: h.includes("n") ? -6 : undefined,
                    bottom: h.includes("s") ? -6 : undefined,
                    cursor: h === "ne" || h === "sw" ? "nesw-resize" : "nwse-resize",
                  }}
                />
              ))}
              {/* Edge handles */}
              {(["n", "s", "e", "w"] as Handle[]).map((h) => (
                <div
                  key={h}
                  onPointerDown={(e) => onPointerDown(h, e)}
                  className="absolute bg-primary/80 shadow border border-white"
                  style={{
                    width: h === "n" || h === "s" ? 14 : 6,
                    height: h === "e" || h === "w" ? 14 : 6,
                    left: h === "w" ? -3 : h === "e" ? undefined : "50%",
                    right: h === "e" ? -3 : undefined,
                    top: h === "n" ? -3 : h === "s" ? undefined : "50%",
                    bottom: h === "s" ? -3 : undefined,
                    transform:
                      h === "n" || h === "s" ? "translateX(-50%)" : "translateY(-50%)",
                    cursor: h === "n" || h === "s" ? "ns-resize" : "ew-resize",
                    borderRadius: 2,
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}

      {cornerPickStep != null && status === "ready" && (
        <div
          className="absolute inset-0 z-[70] cursor-crosshair bg-primary/5"
          onPointerDown={handlePick}
        >
          <div className="absolute left-3 top-3 rounded-md bg-card/95 border px-3 py-2 text-xs shadow">
            คลิก {PICK_LABELS[cornerPickStep]} ของป้ายโฆษณา ({cornerPickStep + 1}/4)
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-muted/60">
          <Loader2 className="size-4 animate-spin mr-2" /> กำลังโหลด Street View…
        </div>
      )}
      {status === "no-imagery" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2 p-4 text-center">
          <AlertCircle className="size-5" />
          <div>ไม่มีภาพ Street View บริเวณนี้ (รัศมี 80 ม.)</div>
        </div>
      )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-destructive gap-2 p-4 text-center">
            <AlertCircle className="size-5" />
            <div>โหลด Street View ไม่สำเร็จ</div>
            <div className="text-xs text-muted-foreground">{msg}</div>
          </div>
        )}
      </div>
    </div>
  );
}
