/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2, ExternalLink, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
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

  const gmapsHref = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=${heading}`;
  const gmapsSearchHref = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  const openExternal = (url: string) => {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) {
      // popup blocked or iframe restriction — fall back to copy
      void copyLink(url);
    }
  };

  const copyLink = async (url: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("คัดลอกลิงก์แล้ว — วางในเบราว์เซอร์เพื่อเปิด");
        return;
      }
    } catch {
      /* fall through */
    }
    // eslint-disable-next-line no-alert
    window.prompt("คัดลอกลิงก์นี้เพื่อเปิดใน Google Maps:", url);
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
          className={`absolute pointer-events-none ${editable ? "ring-2 ring-primary/70" : ""}`}
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
            className="w-full h-full object-fill"
            draggable={false}
          />
          {editable && (
            <>
              <div
                className="absolute inset-0 cursor-move pointer-events-auto"
                onPointerDown={(e) => onPointerDown("move", e)}
              />
              <div
                className="absolute -right-2 -bottom-2 size-4 rounded-sm bg-primary cursor-nwse-resize pointer-events-auto shadow"
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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openExternal(gmapsSearchHref)}
              className="inline-flex items-center gap-1 rounded border bg-background/90 px-2 py-1 text-xs text-primary hover:bg-background"
            >
              เปิดใน Google Maps <ExternalLink className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => void copyLink(gmapsSearchHref)}
              className="inline-flex items-center gap-1 rounded border bg-background/90 px-2 py-1 text-xs hover:bg-background"
              title="คัดลอกลิงก์"
            >
              <Copy className="size-3" />
            </button>
          </div>
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-destructive gap-2 p-4 text-center">
          <AlertCircle className="size-5" />
          <div>โหลด Street View ไม่สำเร็จ</div>
          <div className="text-xs text-muted-foreground">{msg}</div>
        </div>
      )}
      {status === "ready" && (
        <a
          href={gmapsHref}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded bg-background/90 border px-2 py-1 text-[11px] shadow hover:bg-background"
        >
          เปิดใน Google Maps <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
