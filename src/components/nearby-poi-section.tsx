import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getNearbyPOIsForAsset, type NearbyPOI } from "@/lib/poi-search.functions";
import { PRESET_BY_KEY } from "@/lib/overpass";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const RADIUS_OPTIONS = [100, 200, 500, 1000] as const;
type RadiusM = (typeof RADIUS_OPTIONS)[number];

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`คัดลอกลิงก์ ${label} แล้ว`, { description: text });
  } catch {
    toast.error("คัดลอกไม่สำเร็จ", { description: text });
  }
}

export function CopyLinkPill({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(url, label)}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 border border-primary/30 rounded-md px-2.5 py-1 transition-colors"
      title={url}
    >
      <Copy className="size-3.5" /> คัดลอกลิงก์ {label}
    </button>
  );
}

type Props = {
  assetId: string;
  lat: number;
  lng: number;
  /** Only fetch when true (lazy — for use inside tabs). */
  enabled?: boolean;
};

export default function NearbyPoiSection({ assetId, lat, lng, enabled = true }: Props) {
  const [radius, setRadius] = useState<RadiusM>(500);
  const nearbyFn = useServerFn(getNearbyPOIsForAsset);
  const { data: poiData, isFetching, error } = useQuery({
    queryKey: ["nearby-pois", assetId, lat, lng],
    queryFn: () => nearbyFn({ data: { lat, lng } }),
    enabled: enabled && Number.isFinite(lat) && Number.isFinite(lng),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const filtered = useMemo(() => {
    const list = poiData?.pois ?? [];
    return list.filter((x) => x.distanceM <= radius);
  }, [poiData, radius]);

  const grouped = useMemo(() => {
    const g = new Map<string, NearbyPOI[]>();
    for (const p of filtered) {
      const arr = g.get(p.presetKey) ?? [];
      arr.push(p);
      g.set(p.presetKey, arr);
    }
    return Array.from(g.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium inline-flex items-center gap-2">
          <ExternalLink className="size-4" /> พื้นที่ใกล้เคียง (OSM)
        </div>
        <div className="inline-flex rounded-md border overflow-hidden text-xs">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadius(r)}
              className={cn(
                "px-3 py-1.5 font-medium transition-colors",
                radius === r ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {r >= 1000 ? "1 กม." : `${r} ม.`}
            </button>
          ))}
        </div>
      </div>

      {isFetching && !poiData ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
          <div className="text-xs text-muted-foreground text-center">
            กำลังค้นหาสถานที่ใกล้เคียง…
          </div>
        </div>
      ) : error || (poiData && !poiData.ok) ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-4 text-sm">
          โหลดข้อมูลไม่สำเร็จ: {poiData?.error ?? (error as Error)?.message}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          ไม่พบสถานที่ในรัศมี {radius >= 1000 ? "1 กม." : `${radius} ม.`}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">
              รวม {filtered.length} แห่ง ในรัศมี {radius >= 1000 ? "1 กม." : `${radius} ม.`} —
            </span>
            {grouped.slice(0, 6).map(([k, list]) => {
              const preset = PRESET_BY_KEY[k];
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-card"
                  style={{ borderColor: preset?.color ?? "#94a3b8" }}
                >
                  <span>{preset?.icon ?? "📍"}</span>
                  <span className="font-medium">{preset?.label ?? k}</span>
                  <span className="text-muted-foreground">{list.length}</span>
                </span>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {grouped.map(([k, list]) => {
              const preset = PRESET_BY_KEY[k];
              return (
                <div key={k} className="rounded-lg border overflow-hidden">
                  <div
                    className="px-3 py-2 text-xs font-medium flex items-center gap-2"
                    style={{ background: `${preset?.color ?? "#94a3b8"}15`, color: preset?.color ?? "#334155" }}
                  >
                    <span>{preset?.icon ?? "📍"}</span>
                    <span>{preset?.label ?? k}</span>
                    <span className="ml-auto text-muted-foreground">{list.length}</span>
                  </div>
                  <ul className="divide-y">
                    {list.slice(0, 6).map((poi) => {
                      const poiUrl = `https://www.google.com/maps?q=${poi.lat},${poi.lng}`;
                      return (
                        <li key={poi.id} className="px-3 py-2 text-xs flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{poi.name}</div>
                            <div className="text-muted-foreground">{Math.round(poi.distanceM)} ม.</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(poiUrl, poi.name)}
                            className="shrink-0 p-1 rounded hover:bg-muted"
                            title="คัดลอกลิงก์ Google Maps"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </li>
                      );
                    })}
                    {list.length > 6 && (
                      <li className="px-3 py-1.5 text-[11px] text-muted-foreground text-center bg-muted/30">
                        + อีก {list.length - 6} แห่ง
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
