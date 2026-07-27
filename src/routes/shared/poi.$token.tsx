import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, MapPin, ExternalLink } from "lucide-react";
import type { PoiSharePayload } from "@/lib/poi-share.functions";
import type { PoiMarker } from "@/components/asset-map";
import { PRESET_BY_KEY } from "@/lib/overpass";
import { projectForDepartment } from "@/lib/project-department-map";

const AssetMap = lazy(() => import("@/components/asset-map"));

type LoadState =
  | { status: "loading" }
  | { status: "expired" }
  | { status: "notfound" }
  | { status: "error"; message: string }
  | { status: "ok"; payload: PoiSharePayload; expiresAt: string };

export const Route = createFileRoute("/shared/poi/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "POI Share · Asset History 360" },
      { name: "description", content: "Shared POI proximity result (temporary, 72-hour link)." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SharedPoiPage,
});

function useCountdown(expiresAt: string | null): { ms: number; label: string; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return { ms: 0, label: "-", expired: true };
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return { ms: 0, label: "หมดอายุแล้ว", expired: true };
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { ms, label: `${h} ชม. ${m} นาที`, expired: false };
}

function formatThaiDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function SharedPoiPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/poi-share/${encodeURIComponent(token)}`, {
          headers: { Accept: "application/json" },
        });
        if (!alive) return;
        if (res.status === 410) return setState({ status: "expired" });
        if (res.status === 404) return setState({ status: "notfound" });
        if (!res.ok) return setState({ status: "error", message: `HTTP ${res.status}` });
        const body = (await res.json()) as { payload: PoiSharePayload; expiresAt: string };
        setState({ status: "ok", payload: body.payload, expiresAt: body.expiresAt });
      } catch (e) {
        if (alive) setState({ status: "error", message: (e as Error).message });
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const expiresAt = state.status === "ok" ? state.expiresAt : null;
  const countdown = useCountdown(expiresAt);

  // Auto-flip to expired when the timer runs out on an open page.
  useEffect(() => {
    if (state.status === "ok" && countdown.expired) setState({ status: "expired" });
  }, [countdown.expired, state.status]);

  if (state.status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-muted-foreground text-sm">กำลังโหลด...</div>
      </div>
    );
  }

  if (state.status === "expired") {
    return <StatusScreen title="ลิงก์นี้หมดอายุแล้ว" body="ลิงก์แชร์มีอายุ 72 ชั่วโมง กรุณาขอผู้ส่งสร้างลิงก์ใหม่" />;
  }
  if (state.status === "notfound") {
    return <StatusScreen title="ไม่พบลิงก์นี้" body="ลิงก์อาจถูกลบหรือพิมพ์ไม่ถูกต้อง" />;
  }
  if (state.status === "error") {
    return <StatusScreen title="เกิดข้อผิดพลาด" body={state.message} />;
  }

  const { payload } = state;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Confirmation dialog — blocks until accepted */}
      <Dialog open={!accepted}>
        <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              ข้อมูลลับ — สำหรับผู้รับลิงก์เท่านั้น
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2 text-sm text-foreground/80">
                <p>ข้อมูลจุดติดตั้งป้ายในลิงก์นี้เป็นข้อมูลลับของบริษัท กรุณาอย่าเผยแพร่ต่อ</p>
                <div className="rounded-md border p-3 space-y-1 bg-muted/30">
                  <div className="flex items-center gap-2 font-medium">
                    <Clock className="size-4" />
                    ลิงก์จะหมดอายุ
                  </div>
                  <div className="text-base">{formatThaiDate(state.expiresAt)} น.</div>
                  <div className="text-xs text-muted-foreground">
                    (เหลืออีก {countdown.label})
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  หลังจากหมดเวลา ลิงก์นี้จะใช้งานไม่ได้อีกและข้อมูลจะถูกลบออกจากระบบโดยอัตโนมัติ
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAccepted(true)} className="w-full">ยอมรับและดูข้อมูล</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {accepted && (
        <div className="mx-auto max-w-[1400px] p-4 space-y-3">
          {/* Countdown banner */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 px-3 py-2 text-xs">
            <Clock className="size-4 text-amber-600" />
            <span className="font-medium">ลิงก์แชร์ชั่วคราว</span>
            <span className="text-muted-foreground">
              หมดอายุ: {formatThaiDate(state.expiresAt)} น. · เหลืออีก {countdown.label}
            </span>
          </div>

          <SharedContent payload={payload} />
        </div>
      )}
    </div>
  );
}

function StatusScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="max-w-md text-center space-y-3">
        <AlertTriangle className="size-10 text-amber-500 mx-auto" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function SharedContent({ payload }: { payload: PoiSharePayload }) {
  const assetById = useMemo(() => {
    const m = new Map<string, PoiSharePayload["assets"][number]>();
    for (const a of payload.assets ?? []) m.set(a.id, a);
    return m;
  }, [payload.assets]);

  const poiById = useMemo(() => {
    const m = new Map<string, (typeof payload.pois)[number]>();
    for (const p of payload.pois ?? []) m.set(p.id, p);
    return m;
  }, [payload.pois]);

  const poiMarkers: PoiMarker[] = useMemo(
    () =>
      (payload.pois ?? []).map((p) => {
        const preset = PRESET_BY_KEY[p.presetKey];
        return {
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          name: p.name,
          icon: preset?.icon ?? "📍",
          color: preset?.color ?? "#a855f7",
          categoryLabel: preset?.label ?? p.presetKey,
        };
      }),
    [payload.pois],
  );

  const mapAssets = useMemo(
    () =>
      (payload.assets ?? []).map((a) => ({
        id: a.id,
        old_code: a.old_code,
        name: a.name,
        department: a.department,
        media_type: a.media_type,
        status: null,
        location: a.location,
        lat: a.lat,
        lng: a.lng,
      })),
    [payload.assets],
  );

  const matchedAssetIds = useMemo(
    () => new Set((payload.matches ?? []).map((m) => m.assetId)),
    [payload.matches],
  );

  // Group matches per asset with closest distance
  const groupedByAsset = useMemo(() => {
    const g = new Map<string, { distanceM: number; pois: Array<{ id: string; distanceM: number }> }>();
    for (const m of payload.matches ?? []) {
      const prev = g.get(m.assetId);
      if (!prev) g.set(m.assetId, { distanceM: m.distanceM, pois: [{ id: m.poiId, distanceM: m.distanceM }] });
      else {
        prev.pois.push({ id: m.poiId, distanceM: m.distanceM });
        if (m.distanceM < prev.distanceM) prev.distanceM = m.distanceM;
      }
    }
    return Array.from(g.entries())
      .map(([assetId, v]) => ({ assetId, ...v }))
      .sort((a, b) => a.distanceM - b.distanceM);
  }, [payload.matches]);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="rounded-xl border bg-card shadow overflow-hidden" style={{ height: "calc(100vh - 200px)", minHeight: 480 }}>
        <ClientOnly fallback={<Skeleton className="w-full h-full" />}>
          <Suspense fallback={<Skeleton className="w-full h-full" />}>
            <AssetMap
              assets={mapAssets}
              claimedCodes={new Set()}
              focusId={null}
              nearbyIds={matchedAssetIds}
              poiMarkers={poiMarkers}
              poiRadiusMeters={payload.radiusM}
              showRadiusRings={false}
            />
          </Suspense>
        </ClientOnly>
      </div>

      <aside className="rounded-xl border bg-card shadow p-3 space-y-3 overflow-auto" style={{ height: "calc(100vh - 200px)" }}>
        <div>
          <h2 className="font-semibold text-sm">ผลลัพธ์ POI</h2>
          <div className="text-xs text-muted-foreground">
            รัศมี {payload.radiusM} ม. · จับคู่แบบ {payload.matchMode === "all" ? "ครบทุกหมวด" : "อย่างน้อย 1 หมวด"}
          </div>
          <div className="text-xs text-muted-foreground">
            ป้ายที่เข้าเงื่อนไข: <b>{groupedByAsset.length}</b> · POI: <b>{payload.pois?.length ?? 0}</b>
          </div>
        </div>

        <div className="space-y-1.5">
          {groupedByAsset.map((row) => {
            const a = assetById.get(row.assetId);
            if (!a) return null;
            const proj = projectForDepartment(a.department) ?? a.department;
            return (
              <div key={row.assetId} className="rounded-md border p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold truncate">{a.old_code ?? "—"}</div>
                  <a
                    href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    <MapPin className="size-3" /> แผนที่ <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="text-muted-foreground truncate">{a.name ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {[proj, a.media_type, a.location].filter(Boolean).join(" • ")}
                </div>
                <div className="text-[11px]">
                  ใกล้สุด: <b>{Math.round(row.distanceM)}</b> ม. · {row.pois.length} POI
                </div>
                <div className="flex flex-wrap gap-1">
                  {row.pois.slice(0, 6).map((p) => {
                    const poi = poiById.get(p.id);
                    if (!poi) return null;
                    const preset = PRESET_BY_KEY[poi.presetKey];
                    return (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border"
                        style={{ borderColor: preset?.color ?? "#a855f7" }}
                        title={`${poi.name} · ${Math.round(p.distanceM)} ม.`}
                      >
                        <span>{preset?.icon ?? "📍"}</span>
                        <span className="truncate max-w-[100px]">{poi.name}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {groupedByAsset.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">ไม่มีผลลัพธ์</div>
          )}
        </div>
      </aside>
    </div>
  );
}
