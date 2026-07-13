/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import type { BillboardMockupOverlay } from "@/lib/billboard-mockups.functions";

type Props = {
  lat: number;
  lng: number;
  heading?: number;
  overlayImageUrl?: string;
  overlay?: BillboardMockupOverlay;
  onOverlayChange?: (o: BillboardMockupOverlay) => void;
  editable?: boolean;
};

type Status = "loading" | "ready" | "no-imagery" | "error";
type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export default function StreetViewPanel({
  lat,
  lng,
  heading = 0,
  overlayImageUrl,
  overlay,
  onOverlayChange,
  editable = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
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
            new google.maps.StreetViewPanorama(svRef.current, {
              position: data.location.latLng,
              pov: { heading, pitch: 0 },
              zoom: 0,
              addressControl: false,
              fullscreenControl: true,
              motionTracking: false,
              motionTrackingControl: false,
              panControl: true,
              zoomControl: true,
              linksControl: true,
            });
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
    };
  }, [lat, lng, heading]);

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

    if (s.mode === "move") {
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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[320px] rounded-md overflow-hidden border bg-muted select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div ref={svRef} className="absolute inset-0" />

      {overlayImageUrl && overlay && status === "ready" && (
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
          }}
        >
          <img
            src={overlayImageUrl}
            alt="mockup overlay"
            className="w-full h-full object-fill pointer-events-none"
            draggable={false}
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
  );
}
