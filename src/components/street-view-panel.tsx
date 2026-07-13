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

  // Drag / resize handling for overlay
  const dragState = useRef<{
    mode: "move" | "resize" | null;
    startX: number;
    startY: number;
    startOverlay: BillboardMockupOverlay;
    box: DOMRect;
  }>({ mode: null, startX: 0, startY: 0, startOverlay: overlay ?? { x: 25, y: 30, w: 50, h: 25, opacity: 0.85, rotation: 0 }, box: new DOMRect() });

  const onPointerDown = (mode: "move" | "resize", e: React.PointerEvent) => {
    if (!editable || !overlay || !onOverlayChange || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startOverlay: { ...overlay },
      box: containerRef.current.getBoundingClientRect(),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s.mode || !onOverlayChange) return;
    const dxPct = ((e.clientX - s.startX) / s.box.width) * 100;
    const dyPct = ((e.clientY - s.startY) / s.box.height) * 100;
    if (s.mode === "move") {
      onOverlayChange({
        ...s.startOverlay,
        x: Math.min(100 - s.startOverlay.w, Math.max(0, s.startOverlay.x + dxPct)),
        y: Math.min(100 - s.startOverlay.h, Math.max(0, s.startOverlay.y + dyPct)),
      });
    } else {
      onOverlayChange({
        ...s.startOverlay,
        w: Math.min(100 - s.startOverlay.x, Math.max(5, s.startOverlay.w + dxPct)),
        h: Math.min(100 - s.startOverlay.y, Math.max(5, s.startOverlay.h + dyPct)),
      });
    }
  };

  const onPointerUp = () => {
    dragState.current.mode = null;
  };

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
            transform: `rotate(${overlay.rotation}deg)`,
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
              <div
                className="absolute inset-0 cursor-move"
                onPointerDown={(e) => onPointerDown("move", e)}
              />
              <div
                className="absolute -right-2 -bottom-2 size-4 rounded-sm bg-primary cursor-nwse-resize shadow"
                onPointerDown={(e) => onPointerDown("resize", e)}
                title="Drag to resize"
              />
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
