import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check, ChevronsUpDown, Search, Loader2, X, MapPin, Download, Link2, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { POI_PRESETS, PRESET_BY_KEY, type Bbox } from "@/lib/overpass";
import {
  searchPOIsNearAssets,
  type POI, type POIMatch,
} from "@/lib/poi-search.functions";
import { PROJECT_TO_DEPARTMENTS, projectForDepartment } from "@/lib/project-department-map";
import { SearchProgressDialog } from "./search-progress-dialog";

const RADIUS_OPTIONS = [50, 100, 200, 500, 1000];
const THAILAND_BBOX: Bbox = [5.6, 97.3, 20.6, 105.7];

export type AssetInfo = {
  old_code: string | null;
  name: string | null;
  department: string | null;
  media_type: string | null;
};

export type PoiShareState = {
  presetKeys: string[];
  freeText: string;
  radiusM: number;
  matchMode: "any" | "all";
  bbox: Bbox;
  chipProjects: string[];
  chipMedia: string[];
};

export type PoiInitialSearch = {
  presetKeys: string[];
  freeText: string;
  radiusM: number;
  matchMode: "any" | "all";
  bbox: Bbox;
  chipProjects: string[];
  chipMedia: string[];
};

type Props = {
  bbox: Bbox | null;
  onResult: (r: { pois: POI[]; matches: POIMatch[]; radiusM: number } | null) => void;
  onFocusAsset: (id: string) => void;
  onFocusPOI: (poi: POI) => void;
  assetIndexById: Map<string, AssetInfo>;
  /** Pre-filters mirrored from the map toolbar. Narrow the DB query for speed. */
  preProjects?: string[]; // empty = all
  preMedias?: string[];   // empty = all
  /** When set, panel auto-runs a search once using these values (used for shareable links). */
  initialSearch?: PoiInitialSearch | null;
  /** When set, the search inputs render as read-only "locked" chips (shared link mode). */
  locked?: boolean;
  /** Build a shareable URL from the current search state. */
  onShare?: (state: PoiShareState) => void;
};

export default function PoiProximityPanel({
  bbox, onResult, onFocusAsset, onFocusPOI, assetIndexById,
  preProjects = [], preMedias = [], initialSearch = null, locked = false, onShare,
}: Props) {
  const searchFn = useServerFn(searchPOIsNearAssets);

  const [selectedPresets, setSelectedPresets] = useState<string[]>(
    initialSearch?.presetKeys ?? ["mall", "car_dealer", "subway"],
  );
  const [freeText, setFreeText] = useState(initialSearch?.freeText ?? "");
  const [radiusM, setRadiusM] = useState(initialSearch?.radiusM ?? 200);
  const [matchMode, setMatchMode] = useState<"any" | "all">(initialSearch?.matchMode ?? "any");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Post-search chip filters (client-side slice of results).
  const [chipProjects, setChipProjects] = useState<Set<string>>(
    new Set(initialSearch?.chipProjects ?? []),
  );
  const [chipMedia, setChipMedia] = useState<Set<string>>(
    new Set(initialSearch?.chipMedia ?? []),
  );

  const [lastResult, setLastResult] = useState<{
    pois: POI[]; matches: POIMatch[]; matchedAssetCount: number; elapsedMs?: number;
    usedBbox?: Bbox;
  } | null>(null);

  const effectiveBbox: Bbox = bbox ?? THAILAND_BBOX;

  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const runSearch = (overrides?: { bbox?: Bbox }) => {
    return mut.mutate(overrides);
  };

  const mut = useMutation({
    mutationFn: async (overrides?: { bbox?: Bbox }) => {
      const token = { cancelled: false };
      cancelRef.current = token;

      const departments = preProjects.length > 0
        ? Array.from(new Set(preProjects.flatMap((p) => PROJECT_TO_DEPARTMENTS[p] ?? [])))
        : [];
      const mediaTypes = preMedias.length > 0 ? preMedias : [];

      const result = await searchFn({
        data: {
          presetKeys: selectedPresets,
          freeText: freeText.trim() || null,
          bbox: overrides?.bbox ?? effectiveBbox,
          radiusM,
          matchMode,
          bkkupc: null,
          districts: [],
          territories: [],
          locations: [],
          departments,
          mediaTypes,
        },
      });
      if (token.cancelled) throw new Error("__cancelled__");
      return result;
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error ?? "ค้นหาล้มเหลว");
        return;
      }
      setLastResult({
        pois: r.pois, matches: r.matches,
        matchedAssetCount: r.matchedAssetCount, elapsedMs: r.elapsedMs, usedBbox: r.usedBbox,
      });
      onResult({ pois: r.pois, matches: r.matches, radiusM });
      const ms = r.elapsedMs ? ` · ${(r.elapsedMs / 1000).toFixed(1)}s` : "";
      toast.success(`พบ ${r.poiCount} POI · ${r.matchedAssetCount} ป้ายใกล้เคียง${ms}`);
      if (r.warnings?.length) toast.warning(r.warnings[0]);
    },
    onError: (e: Error) => {
      if (e.message === "__cancelled__") return;
      toast.error(e.message);
    },
  });

  // Auto-run once when arriving via a shareable link.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current || !initialSearch) return;
    autoRanRef.current = true;
    runSearch({ bbox: initialSearch.bbox });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearch]);

  const cancelSearch = () => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    mut.reset();
    toast.message("ยกเลิกการค้นหาแล้ว");
  };

  const togglePreset = (key: string) => {
    if (locked) return;
    setSelectedPresets((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const clearAll = () => {
    setSelectedPresets(["mall", "car_dealer", "subway"]);
    setFreeText("");
    setRadiusM(200);
    setMatchMode("any");
    setChipProjects(new Set());
    setChipMedia(new Set());
    setLastResult(null);
    onResult(null);
  };

  // ---------- Post-search chip filter derivation & filtering ----------

  // All matches → group by POI. Compute chip options from matched assets.
  const { matchesByPoi, projectOptions, mediaOptions } = useMemo(() => {
    const byPoi = new Map<string, POIMatch[]>();
    const projCounts = new Map<string, number>();
    const mediaCounts = new Map<string, number>();
    if (!lastResult) {
      return { matchesByPoi: byPoi, projectOptions: [], mediaOptions: [] };
    }
    const seenAssetForProj = new Set<string>();
    const seenAssetForMedia = new Set<string>();
    for (const m of lastResult.matches) {
      let arr = byPoi.get(m.poiId);
      if (!arr) { arr = []; byPoi.set(m.poiId, arr); }
      arr.push(m);
      const info = assetIndexById.get(m.assetId);
      const proj = projectForDepartment(info?.department);
      if (proj && !seenAssetForProj.has(m.assetId + "|" + proj)) {
        seenAssetForProj.add(m.assetId + "|" + proj);
        projCounts.set(proj, (projCounts.get(proj) ?? 0) + 1);
      }
      const mt = info?.media_type;
      if (mt && !seenAssetForMedia.has(m.assetId + "|" + mt)) {
        seenAssetForMedia.add(m.assetId + "|" + mt);
        mediaCounts.set(mt, (mediaCounts.get(mt) ?? 0) + 1);
      }
    }
    for (const arr of byPoi.values()) arr.sort((a, b) => a.distanceM - b.distanceM);
    const toSorted = (m: Map<string, number>) =>
      Array.from(m, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    return {
      matchesByPoi: byPoi,
      projectOptions: toSorted(projCounts),
      mediaOptions: toSorted(mediaCounts),
    };
  }, [lastResult, assetIndexById]);

  // Apply chip filters → filtered matches & filtered POIs to display.
  const filteredView = useMemo(() => {
    if (!lastResult) return { matches: [] as POIMatch[], pois: [] as POI[], matchedAssetCount: 0 };
    const hasProj = chipProjects.size > 0;
    const hasMedia = chipMedia.size > 0;
    const matches = lastResult.matches.filter((m) => {
      if (!hasProj && !hasMedia) return true;
      const info = assetIndexById.get(m.assetId);
      if (hasProj) {
        const p = projectForDepartment(info?.department);
        if (!p || !chipProjects.has(p)) return false;
      }
      if (hasMedia) {
        if (!info?.media_type || !chipMedia.has(info.media_type)) return false;
      }
      return true;
    });
    const poiIds = new Set(matches.map((m) => m.poiId));
    const pois = lastResult.pois.filter((p) => poiIds.has(p.id));
    const assetIds = new Set(matches.map((m) => m.assetId));
    return { matches, pois, matchedAssetCount: assetIds.size };
  }, [lastResult, chipProjects, chipMedia, assetIndexById]);

  // Push filtered results up to map so highlights & markers respect chip filter.
  useEffect(() => {
    if (!lastResult) return;
    onResult({ pois: filteredView.pois, matches: filteredView.matches, radiusM });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredView.pois, filteredView.matches, radiusM]);

  const filteredMatchesByPoi = useMemo(() => {
    const m = new Map<string, POIMatch[]>();
    for (const match of filteredView.matches) {
      let arr = m.get(match.poiId);
      if (!arr) { arr = []; m.set(match.poiId, arr); }
      arr.push(match);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.distanceM - b.distanceM);
    return m;
  }, [filteredView.matches]);

  // ---------- Export ----------

  const buildCsv = (scope: "filtered" | "all"): string => {
    if (!lastResult) return "";
    const pois = scope === "filtered" ? filteredView.pois : lastResult.pois;
    const mByPoi = scope === "filtered" ? filteredMatchesByPoi : matchesByPoi;
    const rows: string[][] = [
      [
        "POI (ต้นทางวัดระยะ)", "ประเภท POI", "POI Lat", "POI Lng",
        "Asset (Old Code)", "Asset Name",
        "Media Type", "Department", "Project",
        "ระยะจาก POI ถึงป้าย (m)",
      ],
    ];
    for (const p of pois) {
      const preset = PRESET_BY_KEY[p.presetKey];
      const matches = mByPoi.get(p.id) ?? [];
      if (matches.length === 0) {
        rows.push([p.name, preset?.label ?? p.presetKey, String(p.lat), String(p.lng), "", "", "", "", "", ""]);
      } else {
        for (const m of matches) {
          const a = assetIndexById.get(m.assetId);
          rows.push([
            p.name, preset?.label ?? p.presetKey, String(p.lat), String(p.lng),
            a?.old_code ?? "", a?.name ?? "",
            a?.media_type ?? "", a?.department ?? "",
            projectForDepartment(a?.department) ?? "",
            m.distanceM.toFixed(1),
          ]);
        }
      }
    }
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  };

  const downloadCsv = (scope: "filtered" | "all") => {
    if (!lastResult) return;
    const csv = buildCsv(scope);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `poi-search-${scope}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = () => {
    if (!onShare || !lastResult) return;
    onShare({
      presetKeys: selectedPresets,
      freeText: freeText.trim(),
      radiusM,
      matchMode,
      bbox: lastResult.usedBbox ?? effectiveBbox,
      chipProjects: Array.from(chipProjects),
      chipMedia: Array.from(chipMedia),
    });
  };

  const summaryLabel = selectedPresets.length === 0
    ? "เลือกประเภท…"
    : selectedPresets.length === 1
      ? PRESET_BY_KEY[selectedPresets[0]]?.label ?? selectedPresets[0]
      : `เลือก ${selectedPresets.length} ประเภท`;

  const hasChipFilter = chipProjects.size > 0 || chipMedia.size > 0;

  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col h-full">
      <SearchProgressDialog
        open={mut.isPending}
        showAfterMs={3000}
        estimatedTotalMs={Math.max(8000, 4000 + selectedPresets.length * 2500)}
        onCancel={cancelSearch}
      />

      <div className="px-3 py-2 border-b bg-muted/30">
        <div className="text-sm font-semibold flex items-center gap-1">
          <MapPin className="size-4" /> ค้นหาป้ายใกล้ POI
          {locked && <Lock className="size-3 ml-1 text-amber-600" />}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          ใช้ Overpass (OpenStreetMap) — ฟรี ไม่ต้องสมัคร key
        </div>
        {(preProjects.length > 0 || preMedias.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
            <span className="text-muted-foreground">กำลังค้นหาเฉพาะ:</span>
            {preProjects.map((p) => (
              <span key={`pp-${p}`} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {p}
              </span>
            ))}
            {preMedias.map((m) => (
              <span key={`pm-${m}`} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {m}
              </span>
            ))}
          </div>
        )}
        {locked && (
          <div className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 rounded px-2 py-1">
            มุมมองที่แชร์ — ตัวกรองหลักถูกล็อกโดยผู้ส่งลิงก์
          </div>
        )}
      </div>

      <div className="p-3 space-y-3 border-b flex-1 min-h-0 overflow-y-auto">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase">ประเภทสถานที่</label>
          <Popover open={dropdownOpen} onOpenChange={(v) => !locked && setDropdownOpen(v)}>
            <PopoverTrigger asChild>
              <button
                disabled={locked}
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-xs inline-flex items-center justify-between hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="truncate">{summaryLabel}</span>
                <ChevronsUpDown className="size-3.5 opacity-60 shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[280px] z-[1100]" align="start">
              <Command>
                <CommandInput placeholder="ค้นหาประเภท…" />
                <CommandList>
                  <CommandEmpty>ไม่พบ</CommandEmpty>
                  <CommandGroup>
                    {POI_PRESETS.map((p) => {
                      const sel = selectedPresets.includes(p.key);
                      return (
                        <CommandItem
                          key={p.key}
                          value={p.label}
                          onSelect={() => togglePreset(p.key)}
                          className="cursor-pointer"
                        >
                          <div className={cn(
                            "mr-2 size-4 rounded border grid place-items-center",
                            sel ? "bg-primary border-primary text-primary-foreground" : "bg-background",
                          )}>
                            {sel && <Check className="size-3" />}
                          </div>
                          <span className="mr-2">{p.icon}</span>
                          <span className="flex-1 text-xs">{p.label}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selectedPresets.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedPresets.map((k) => {
                const p = PRESET_BY_KEY[k];
                if (!p) return null;
                return (
                  <span key={k}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border"
                    style={{ borderColor: p.color, color: p.color }}
                  >
                    <span>{p.icon}</span>{p.label}
                    {!locked && (
                      <button onClick={() => togglePreset(k)} className="opacity-60 hover:opacity-100">
                        <X className="size-2.5" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase">ค้นหาชื่อ (Free Text)</label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              disabled={locked}
              placeholder='เช่น "Central", "Toyota", "7-Eleven"'
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-xs disabled:opacity-60"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase">รัศมี</label>
          <div className="mt-1 inline-flex rounded-md border overflow-hidden w-full">
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => !locked && setRadiusM(r)}
                disabled={locked}
                className={cn(
                  "flex-1 h-8 text-[11px] border-l first:border-l-0 disabled:opacity-60 disabled:cursor-not-allowed",
                  radiusM === r ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {r >= 1000 ? `${r/1000}km` : `${r}m`}
              </button>
            ))}
          </div>
        </div>

        {selectedPresets.length >= 2 && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase">เงื่อนไข</label>
            <div className="mt-1 inline-flex rounded-md border overflow-hidden w-full">
              <button
                onClick={() => !locked && setMatchMode("any")}
                disabled={locked}
                className={cn("flex-1 h-8 text-[11px] disabled:opacity-60", matchMode === "any" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                ใกล้อย่างน้อย 1 ประเภท
              </button>
              <button
                onClick={() => !locked && setMatchMode("all")}
                disabled={locked}
                className={cn("flex-1 h-8 text-[11px] border-l disabled:opacity-60", matchMode === "all" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                ต้องใกล้ทุกประเภท
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => runSearch()}
            disabled={mut.isPending || (selectedPresets.length === 0 && !freeText.trim())}
            className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {mut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            ค้นหา
          </button>
          {lastResult && !locked && (
            <button onClick={clearAll} className="h-9 px-3 rounded-md border text-xs hover:bg-accent">
              ล้าง
            </button>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground">
          ค้นหาในขอบเขตแผนที่ปัจจุบัน · ขยายแผนที่เพื่อจำกัดพื้นที่
        </div>
      </div>

      {lastResult && (
        <>
          <div className="px-3 py-2 border-b bg-blue-50 dark:bg-blue-950/30 text-xs flex items-center justify-between gap-2 flex-wrap">
            <div className="text-blue-900 dark:text-blue-100">
              <b>{filteredView.pois.length}</b>
              {hasChipFilter && <span className="text-muted-foreground">/{lastResult.pois.length}</span>}
              {" "}POI · <b>{filteredView.matchedAssetCount}</b>
              {hasChipFilter && <span className="text-muted-foreground">/{lastResult.matchedAssetCount}</span>}
              {" "}ป้ายใกล้เคียง
              {lastResult.elapsedMs != null && (
                <span className="text-muted-foreground ml-1">· {(lastResult.elapsedMs / 1000).toFixed(1)}s</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {onShare && (
                <button
                  onClick={handleShare}
                  className="h-7 px-2 rounded-md border text-[11px] hover:bg-accent inline-flex items-center gap-1 bg-background"
                  title="คัดลอกลิงก์ที่ล็อกตัวกรองปัจจุบัน"
                >
                  <Link2 className="size-3" /> แชร์ลิงก์
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-7 px-2 rounded-md border text-[11px] hover:bg-accent inline-flex items-center gap-1 bg-background">
                    <Download className="size-3" /> CSV
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[1100]">
                  <DropdownMenuItem onClick={() => downloadCsv("filtered")}>
                    เฉพาะที่กรองอยู่ ({filteredView.pois.length} POI)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadCsv("all")}>
                    ทั้งหมดที่ค้นเจอ ({lastResult.pois.length} POI)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Post-search chip filters */}
          {(projectOptions.length > 0 || mediaOptions.length > 0) && (
            <div className="px-3 py-2 border-b bg-muted/20 space-y-1.5">
              {projectOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-muted-foreground mr-1 shrink-0">Project:</span>
                  {projectOptions.map((o) => {
                    const sel = chipProjects.has(o.value);
                    return (
                      <button
                        key={o.value}
                        onClick={() =>
                          setChipProjects((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.value)) next.delete(o.value);
                            else next.add(o.value);
                            return next;
                          })
                        }
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] border transition-colors",
                          sel
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-accent",
                        )}
                      >
                        {o.value} <span className="opacity-70">{o.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {mediaOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-muted-foreground mr-1 shrink-0">Media:</span>
                  {mediaOptions.map((o) => {
                    const sel = chipMedia.has(o.value);
                    return (
                      <button
                        key={o.value}
                        onClick={() =>
                          setChipMedia((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.value)) next.delete(o.value);
                            else next.add(o.value);
                            return next;
                          })
                        }
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] border transition-colors",
                          sel
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-accent",
                        )}
                      >
                        {o.value} <span className="opacity-70">{o.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {hasChipFilter && (
                <button
                  onClick={() => { setChipProjects(new Set()); setChipMedia(new Set()); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                >
                  ล้าง chip filter
                </button>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto divide-y">
            {filteredView.pois.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                {hasChipFilter ? "ไม่มี POI ที่ตรงกับ chip filter — ลองล้าง chip filter" : "ไม่พบ POI ในขอบเขตนี้"}
              </div>
            ) : (
              filteredView.pois
                .slice()
                .sort((a, b) => (filteredMatchesByPoi.get(b.id)?.length ?? 0) - (filteredMatchesByPoi.get(a.id)?.length ?? 0))
                .map((p) => {
                  const preset = PRESET_BY_KEY[p.presetKey];
                  const matches = filteredMatchesByPoi.get(p.id) ?? [];
                  return (
                    <div key={p.id} className="text-xs">
                      <button onClick={() => onFocusPOI(p)}
                        className="w-full text-left px-3 py-2 hover:bg-accent flex items-start gap-2">
                        <span className="text-base leading-none mt-0.5">{preset?.icon ?? "📍"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{p.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {preset?.label ?? p.presetKey} · ป้ายในรัศมี: <b>{matches.length}</b>
                          </div>
                        </div>
                      </button>
                      {matches.length > 0 && (
                        <div className="pl-8 pr-3 pb-2 space-y-0.5">
                          {matches.slice(0, 5).map((m) => {
                            const a = assetIndexById.get(m.assetId);
                            return (
                              <button
                                key={m.assetId + m.poiId}
                                onClick={() => onFocusAsset(m.assetId)}
                                className="w-full text-left flex items-center justify-between gap-2 py-0.5 hover:text-primary"
                              >
                                <span className="truncate text-[11px]">
                                  {a?.old_code ?? m.assetId.slice(0, 6)} · <span className="text-muted-foreground">{a?.name ?? "—"}</span>
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                  {m.distanceM.toFixed(0)}m
                                </span>
                              </button>
                            );
                          })}
                          {matches.length > 5 && (
                            <div className="text-[10px] text-muted-foreground pl-0">+ อีก {matches.length - 5} ป้าย</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </>
      )}
    </div>
  );
}
