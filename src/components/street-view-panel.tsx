/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

type Props = {
  lat: number;
  lng: number;
  heading?: number;
};

type Status = "loading" | "ready" | "no-imagery" | "error";

export default function StreetViewPanel({ lat, lng, heading = 0 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setMsg("");

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !ref.current) return;
        const svc = new google.maps.StreetViewService();
        svc.getPanorama(
          { location: { lat, lng }, radius: 80, source: google.maps.StreetViewSource.OUTDOOR },
          (data, statusCode) => {
            if (cancelled || !ref.current) return;
            if (statusCode !== google.maps.StreetViewStatus.OK || !data?.location?.latLng) {
              setStatus("no-imagery");
              return;
            }
            new google.maps.StreetViewPanorama(ref.current, {
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
          }
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

  const gmapsHref = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`;

  return (
    <div className="relative w-full h-[320px] rounded-md overflow-hidden border bg-muted">
      <div ref={ref} className="absolute inset-0" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-muted/60">
          <Loader2 className="size-4 animate-spin mr-2" /> กำลังโหลด Street View…
        </div>
      )}
      {status === "no-imagery" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2 p-4 text-center">
          <AlertCircle className="size-5" />
          <div>ไม่มีภาพ Street View บริเวณนี้ (รัศมี 80 ม.)</div>
          <a
            className="inline-flex items-center gap-1 text-primary underline text-xs"
            href={gmapsHref}
            target="_blank"
            rel="noreferrer"
          >
            เปิดใน Google Maps <ExternalLink className="size-3" />
          </a>
        </div>
      )}
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
