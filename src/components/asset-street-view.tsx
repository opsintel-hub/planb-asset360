/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

type Props = { lat: number; lng: number };
type Status = "loading" | "ready" | "no-imagery" | "error";

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function AssetStreetView({ lat, lng }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErr(null);
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !ref.current) return;
        const svc = new g.maps.StreetViewService();
        const mount = (pd: google.maps.StreetViewPanoramaData) => {
          if (cancelled || !ref.current) return;
          const pos = pd.location?.latLng;
          const pano = pd.location?.pano;
          if (!pos || !pano) {
            setStatus("no-imagery");
            return;
          }
          const heading = bearing(pos.lat(), pos.lng(), lat, lng);
          new g.maps.StreetViewPanorama(ref.current, {
            pano,
            pov: { heading, pitch: 5 },
            zoom: 1,
            addressControl: false,
            fullscreenControl: true,
            motionTracking: false,
            motionTrackingControl: false,
            linksControl: true,
            panControl: true,
            zoomControl: true,
          });
          setStatus("ready");
        };
        svc.getPanorama(
          { location: { lat, lng }, radius: 80, source: g.maps.StreetViewSource.OUTDOOR },
          (data, s) => {
            if (cancelled) return;
            if (s === g.maps.StreetViewStatus.OK && data) {
              mount(data);
              return;
            }
            // fallback: any nearby pano
            svc.getPanorama({ location: { lat, lng }, radius: 250 }, (d2, s2) => {
              if (cancelled) return;
              if (s2 === g.maps.StreetViewStatus.OK && d2) mount(d2);
              else setStatus("no-imagery");
            });
          },
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr((e as Error).message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return (
    <div className="relative w-full h-full">
      <div ref={ref} className="w-full h-full bg-muted/40" />
      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground bg-muted/60 backdrop-blur-sm pointer-events-none">
          {status === "loading" && (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> กำลังโหลด Street View…
            </span>
          )}
          {status === "no-imagery" && (
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="size-4" /> ไม่มีภาพ Street View บริเวณนี้
            </span>
          )}
          {status === "error" && (
            <span className="inline-flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" /> {err ?? "โหลด Street View ล้มเหลว"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
