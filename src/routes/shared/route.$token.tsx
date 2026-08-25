import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, ExternalLink, MapPin, Navigation, Share2 } from "lucide-react";
import type { RouteSharePayload } from "@/lib/route-share.functions";
import { googleMapsSegmentLinks, planTextForDay, shareOrCopy } from "@/lib/route-mobile";
import type { PlanPoint } from "@/lib/route-planner";
import { toast } from "sonner";

type LoadState =
  | { status: "loading" }
  | { status: "expired" }
  | { status: "notfound" }
  | { status: "error"; message: string }
  | { status: "ok"; payload: RouteSharePayload; expiresAt: string };

export const Route = createFileRoute("/shared/route/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "แผนตรวจป้าย (ลิงก์ชั่วคราว) · Asset History 360" },
      {
        name: "description",
        content: "แผนเส้นทางตรวจป้ายสำหรับช่างภาคสนาม เปิดดูได้จากมือถือ ลิงก์หมดอายุใน 7 วัน",
      },
      { property: "og:title", content: "แผนตรวจป้าย · Asset History 360" },
      {
        property: "og:description",
        content: "รายการป้ายและลำดับการตรวจต่อวัน พร้อมเปิดนำทางใน Google Maps",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SharedRoutePage,
});

function SharedRoutePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [dayIdx, setDayIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/poi-share/${token}`);
        if (!alive) return;
        if (res.status === 410) return setState({ status: "expired" });
        if (res.status === 404) return setState({ status: "notfound" });
        if (!res.ok) return setState({ status: "error", message: `HTTP ${res.status}` });
        const json = (await res.json()) as { payload: unknown; expiresAt: string };
        const payload = json.payload as RouteSharePayload;
        if (!payload || payload.kind !== "route-plan")
          return setState({ status: "notfound" });
        setState({ status: "ok", payload, expiresAt: json.expiresAt });
      } catch (e) {
        if (alive) setState({ status: "error", message: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const day = state.status === "ok" ? state.payload.days[dayIdx] : null;

  const mobileDay = useMemo(() => {
    if (!day) return null;
    return {
      inspectorLabel: day.technician?.trim() || day.inspectorLabel,
      day: day.day,
      start: day.start,
      end: day.end,
      points: day.stops.map(
        (s, i): PlanPoint => ({
          id: `${s.code}-${i}`,
          code: s.code,
          name: s.name,
          department: s.department,
          mediaType: s.mediaType,
          lat: s.lat,
          lng: s.lng,
          risk: s.risk,
        }),
      ),
    };
  }, [day]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (state.status !== "ok") {
    const msg =
      state.status === "expired"
        ? "ลิงก์นี้หมดอายุแล้ว (ลิงก์มีอายุ 7 วัน) กรุณาขอลิงก์ใหม่จากผู้วางแผน"
        : state.status === "notfound"
          ? "ไม่พบแผนงานของลิงก์นี้"
          : `เกิดข้อผิดพลาด: ${state.message}`;
    return (
      <main className="mx-auto w-full max-w-md p-6 text-center space-y-3">
        <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">เปิดแผนงานไม่ได้</h1>
        <p className="text-sm text-muted-foreground">{msg}</p>
      </main>
    );
  }

  const segments = mobileDay ? googleMapsSegmentLinks(mobileDay) : [];

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{state.payload.title}</h1>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          ลิงก์ชั่วคราว หมดอายุ {new Date(state.expiresAt).toLocaleString("th-TH")}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {state.payload.days.map((d, i) => (
          <button
            key={`${d.inspectorLabel}-${d.day}`}
            onClick={() => setDayIdx(i)}
            className={`h-9 rounded-lg border px-3 text-xs font-medium transition ${
              i === dayIdx ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
            }`}
          >
            {(d.technician?.trim() || d.inspectorLabel) + ` · วันที่ ${d.day}`}
          </button>
        ))}
      </div>

      {day && mobileDay && (
        <>
          <section className="rounded-xl border bg-card p-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold tabular-nums">{day.stops.length}</div>
                <div className="text-[11px] text-muted-foreground">ป้าย</div>
              </div>
              <div>
                <div className="text-lg font-semibold tabular-nums">
                  {(day.meters / 1000).toFixed(1)}
                </div>
                <div className="text-[11px] text-muted-foreground">กม.</div>
              </div>
              <div>
                <div className="text-lg font-semibold tabular-nums">{day.hours.toFixed(1)}</div>
                <div className="text-[11px] text-muted-foreground">ชม.</div>
              </div>
            </div>
            {day.start && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> จุดเริ่ม: {day.start.name}
              </p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            {links.map((u, i) => (
              <Button key={u} asChild size="sm" variant={i === 0 ? "default" : "outline"}>
                <a href={u} target="_blank" rel="noreferrer">
                  <Navigation className="mr-1.5 h-4 w-4" />
                  นำทางช่วงที่ {i + 1}
                </a>
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await shareOrCopy(planTextForDay(mobileDay, links));
                toast.success(r === "shared" ? "แชร์แผนแล้ว" : "คัดลอกแผนแล้ว");
              }}
            >
              <Share2 className="mr-1.5 h-4 w-4" />
              แชร์/คัดลอก
            </Button>
          </div>

          <ol className="space-y-2">
            {day.stops.map((s, i) => (
              <li
                key={`${s.code}-${i}`}
                className="flex items-start gap-3 rounded-xl border bg-card p-3"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.code}</span>
                    {s.risk === "high" && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                        เสี่ยงสูง
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.name, s.mediaType, s.department].filter(Boolean).join(" · ") || "-"}
                  </p>
                </div>
                <a
                  className="shrink-0 text-xs text-primary hover:underline"
                  href={`https://maps.google.com/?q=${s.lat},${s.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
