import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Search, Loader2, X, MapPin, Download, Filter } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { POI_PRESETS, PRESET_BY_KEY, type Bbox } from "@/lib/overpass";
import {
  searchPOIsNearAssets, getPOIFilterOptions, searchLocations,
  type POI, type POIMatch,
} from "@/lib/poi-search.functions";
import { SearchProgressDialog } from "./search-progress-dialog";

const RADIUS_OPTIONS = [50, 100, 200, 500, 1000];

type Props = {
  bbox: Bbox | null;
  onResult: (r: { pois: POI[]; matches: POIMatch[]; radiusM: number } | null) => void;
  onFocusAsset: (id: string) => void;
  onFocusPOI: (poi: POI) => void;
  assetIndexById: Map<string, { old_code: string | null; name: string | null }>;
};

export default function PoiProximityPanel({
  bbox, onResult, onFocusAsset, onFocusPOI, assetIndexById,
}: Props) {
  const searchFn = useServerFn(searchPOIsNearAssets);
  const filterOptsFn = useServerFn(getPOIFilterOptions);
  const searchLocationsFn = useServerFn(searchLocations);

  const [selectedPresets, setSelectedPresets] = useState<string[]>(["mall", "car_dealer", "subway"]);
  const [freeText, setFreeText] = useState("");
  const [radiusM, setRadiusM] = useState(200);
  const [matchMode, setMatchMode] = useState<"any" | "all">("any");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Filter state (Phase B)
  const [bkkupc, setBkkupc] = useState<"" | "BKK" | "UPC">("");
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [selectedMediaTypes, setSelectedMediaTypes] = useState<string[]>([]);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [terrOpen, setTerrOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [locQuery, setLocQuery] = useState("");

  const [lastResult, setLastResult] = useState<{
    pois: POI[]; matches: POIMatch[]; matchedAssetCount: number; elapsedMs?: number;
  } | null>(null);

  const filterOpts = useQuery({
    queryKey: ["poi-filter-options"],
    queryFn: () => filterOptsFn(),
    staleTime: 5 * 60_000,
  });

  const locationSearch = useQuery({
    queryKey: ["poi-location-typeahead", locQuery],
    queryFn: () => searchLocationsFn({ data: { q: locQuery } }),
    enabled: locOpen && locQuery.trim().length >= 2,
    staleTime: 60_000,
  });

  const mut = useMutation({
    mutationFn: async () => {
      if (!bbox) throw new Error("รอโหลดแผนที่ก่อน");
      return searchFn({
        data: {
          presetKeys: selectedPresets,
          freeText: freeText.trim() || null,
          bbox,
          radiusM,
          matchMode,
          bkkupc: bkkupc || null,
          districts: selectedDistricts,
          territories: selectedTerritories,
          locations: selectedLocations,
          departments: selectedDepartments,
          mediaTypes: selectedMediaTypes,
        },
      });
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error ?? "ค้นหาล้มเหลว");
        setLastResult(null);
        onResult(null);
        return;
      }
      const result = { pois: r.pois, matches: r.matches, matchedAssetCount: r.matchedAssetCount, elapsedMs: r.elapsedMs };
      setLastResult(result);
      onResult({ pois: r.pois, matches: r.matches, radiusM });
      const ms = r.elapsedMs ? ` · ${(r.elapsedMs / 1000).toFixed(1)}s` : "";
      toast.success(`พบ ${r.poiCount} POI · ${r.matchedAssetCount} ป้ายใกล้เคียง${ms}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePreset = (key: string) => {
    setSelectedPresets((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const clearAll = () => {
    setLastResult(null);
    onResult(null);
  };

  const clearGeoFilters = () => {
    setBkkupc("");
    setSelectedDistricts([]);
    setSelectedTerritories([]);
    setSelectedLocations([]);
    setSelectedDepartments([]);
    setSelectedMediaTypes([]);
  };

  const hasGeoFilter = bkkupc !== ""
    || selectedDistricts.length > 0
    || selectedTerritories.length > 0
    || selectedLocations.length > 0
    || selectedDepartments.length > 0
    || selectedMediaTypes.length > 0;

  const matchesByPoi = useMemo(() => {
    if (!lastResult) return new Map<string, POIMatch[]>();
    const m = new Map<string, POIMatch[]>();
    for (const match of lastResult.matches) {
      let arr = m.get(match.poiId);
      if (!arr) { arr = []; m.set(match.poiId, arr); }
      arr.push(match);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.distanceM - b.distanceM);
    return m;
  }, [lastResult]);

  const exportCsv = () => {
    if (!lastResult) return;
    const rows: string[][] = [
      ["POI", "ประเภท", "POI Lat", "POI Lng", "Asset (Old Code)", "Asset Name", "Distance (m)"],
    ];
    for (const p of lastResult.pois) {
      const preset = PRESET_BY_KEY[p.presetKey];
      const matches = matchesByPoi.get(p.id) ?? [];
      if (matches.length === 0) {
        rows.push([p.name, preset?.label ?? p.presetKey, String(p.lat), String(p.lng), "", "", ""]);
      } else {
        for (const m of matches) {
          const a = assetIndexById.get(m.assetId);
          rows.push([
            p.name, preset?.label ?? p.presetKey, String(p.lat), String(p.lng),
            a?.old_code ?? "", a?.name ?? "", m.distanceM.toFixed(1),
          ]);
        }
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `poi-search-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summaryLabel = selectedPresets.length === 0
    ? "เลือกประเภท…"
    : selectedPresets.length === 1
      ? PRESET_BY_KEY[selectedPresets[0]]?.label ?? selectedPresets[0]
      : `เลือก ${selectedPresets.length} ประเภท`;

  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col h-full">
      <SearchProgressDialog
        open={mut.isPending}
        showAfterMs={3000}
        estimatedTotalMs={Math.max(8000, 4000 + selectedPresets.length * 2500)}
      />

      <div className="px-3 py-2 border-b bg-muted/30">
        <div className="text-sm font-semibold flex items-center gap-1">
          <MapPin className="size-4" /> ค้นหาป้ายใกล้ POI
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          ใช้ Overpass (OpenStreetMap) — ฟรี ไม่ต้องสมัคร key
        </div>
      </div>

      <div className="p-3 space-y-3 border-b flex-1 min-h-0 overflow-y-auto">
        {/* Geographic filters */}
        <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-2 space-y-2">
          <div className="text-[11px] font-medium text-amber-900 dark:text-amber-100 uppercase flex items-center gap-1">
            <Filter className="size-3" /> ตัวกรองพื้นที่ (เพิ่มความเร็ว)
          </div>
          {filterOpts.isError && (
            <div className="text-[10px] text-destructive">โหลดตัวเลือกไม่สำเร็จ: {(filterOpts.error as Error)?.message}</div>
          )}

          {/* BKKUPC segment */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1">กรุงเทพ / ต่างจังหวัด (BKKUPC)</div>
            <div className="inline-flex rounded-md border overflow-hidden w-full bg-background">
              {([
                { v: "" as const, l: "ทั้งหมด" },
                { v: "BKK" as const, l: "BKK" },
                { v: "UPC" as const, l: "UPC" },
              ]).map((o) => (
                <button
                  key={o.l}
                  onClick={() => setBkkupc(o.v)}
                  className={cn(
                    "flex-1 h-7 text-[11px] border-l first:border-l-0",
                    bkkupc === o.v ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <MultiSelectDropdown
            open={districtOpen}
            setOpen={setDistrictOpen}
            label="เขต / อำเภอ (District)"
            placeholder={filterOpts.isLoading ? "กำลังโหลด…" : "เลือกเขต/อำเภอ…"}
            options={(filterOpts.data?.districts ?? []).map((t) => ({ value: t.value, label: `${t.value} (${t.count})` }))}
            selected={selectedDistricts}
            onToggle={(v) => setSelectedDistricts((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            loading={filterOpts.isLoading}
          />
          <MultiSelectDropdown
            open={terrOpen}
            setOpen={setTerrOpen}
            label="พื้นที่ (Territory)"
            placeholder={filterOpts.isLoading ? "กำลังโหลด…" : "เลือกพื้นที่…"}
            options={(filterOpts.data?.territories ?? []).map((t) => ({ value: t.value, label: `${t.value} (${t.count})` }))}
            selected={selectedTerritories}
            onToggle={(v) => setSelectedTerritories((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            loading={filterOpts.isLoading}
          />

          {/* Location typeahead */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1">จุดติดตั้ง (Location)</div>
            <Popover open={locOpen} onOpenChange={setLocOpen}>
              <PopoverTrigger asChild>
                <button className="h-8 w-full rounded-md border bg-background px-2.5 text-[11px] inline-flex items-center justify-between hover:bg-accent">
                  <span className="truncate">
                    {selectedLocations.length === 0 ? "พิมพ์เพื่อค้นหาจุดติดตั้ง…"
                      : selectedLocations.length === 1 ? selectedLocations[0]
                      : `${selectedLocations.length} จุด`}
                  </span>
                  <ChevronsUpDown className="size-3 opacity-60 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[300px] z-[1100]" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="พิมพ์ ≥ 2 ตัวอักษร…"
                    value={locQuery}
                    onValueChange={setLocQuery}
                  />
                  <CommandList className="max-h-[240px]">
                    {locQuery.trim().length < 2 && (
                      <div className="py-4 text-center text-[11px] text-muted-foreground">
                        พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา
                      </div>
                    )}
                    {locQuery.trim().length >= 2 && locationSearch.isLoading && (
                      <div className="py-4 text-center text-[11px] text-muted-foreground">กำลังค้นหา…</div>
                    )}
                    {locQuery.trim().length >= 2 && !locationSearch.isLoading && (locationSearch.data ?? []).length === 0 && (
                      <CommandEmpty>ไม่พบ</CommandEmpty>
                    )}
                    <CommandGroup>
                      {(locationSearch.data ?? []).map((o) => {
                        const sel = selectedLocations.includes(o.value);
                        return (
                          <CommandItem
                            key={o.value}
                            value={o.value}
                            onSelect={() => setSelectedLocations((p) => p.includes(o.value) ? p.filter((x) => x !== o.value) : [...p, o.value])}
                            className="cursor-pointer"
                          >
                            <div className={cn(
                              "mr-2 size-4 rounded border grid place-items-center shrink-0",
                              sel ? "bg-primary border-primary text-primary-foreground" : "bg-background",
                            )}>
                              {sel && <Check className="size-3" />}
                            </div>
                            <span className="text-xs truncate flex-1">{o.value}</span>
                            <span className="text-[10px] text-muted-foreground ml-1">{o.count}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedLocations.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selectedLocations.map((v) => (
                  <span key={v} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border bg-background max-w-full">
                    <span className="truncate max-w-[180px]">{v}</span>
                    <button onClick={() => setSelectedLocations((p) => p.filter((x) => x !== v))} className="opacity-60 hover:opacity-100 shrink-0">
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <MultiSelectDropdown
            open={deptOpen}
            setOpen={setDeptOpen}
            label="แผนก (Department)"
            placeholder={filterOpts.isLoading ? "กำลังโหลด…" : "เลือกแผนก…"}
            options={(filterOpts.data?.departments ?? []).map((t) => ({ value: t.value, label: `${t.value} (${t.count})` }))}
            selected={selectedDepartments}
            onToggle={(v) => setSelectedDepartments((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            loading={filterOpts.isLoading}
          />
          <MultiSelectDropdown
            open={mediaOpen}
            setOpen={setMediaOpen}
            label="ประเภทสื่อ (Media Type)"
            placeholder={filterOpts.isLoading ? "กำลังโหลด…" : "เลือกประเภทสื่อ…"}
            options={(filterOpts.data?.mediaTypes ?? []).map((t) => ({ value: t.value, label: `${t.value} (${t.count})` }))}
            selected={selectedMediaTypes}
            onToggle={(v) => setSelectedMediaTypes((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            loading={filterOpts.isLoading}
          />

          {hasGeoFilter && (
            <button
              onClick={clearGeoFilters}
              className="text-[10px] text-amber-800 dark:text-amber-200 hover:underline"
            >
              ล้างตัวกรองพื้นที่ทั้งหมด
            </button>
          )}
        </div>


        {/* Multi-select dropdown */}
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase">ประเภทสถานที่</label>
          <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <PopoverTrigger asChild>
              <button
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-xs inline-flex items-center justify-between hover:bg-accent"
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
                    <button onClick={() => togglePreset(k)} className="opacity-60 hover:opacity-100">
                      <X className="size-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Free text */}
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase">ค้นหาชื่อ (Free Text)</label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder='เช่น "Central", "Toyota", "7-Eleven"'
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-xs"
            />
          </div>
        </div>

        {/* Radius */}
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase">รัศมี</label>
          <div className="mt-1 inline-flex rounded-md border overflow-hidden w-full">
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => setRadiusM(r)}
                className={cn(
                  "flex-1 h-8 text-[11px] border-l first:border-l-0",
                  radiusM === r ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {r >= 1000 ? `${r/1000}km` : `${r}m`}
              </button>
            ))}
          </div>
        </div>

        {/* Match mode (only when 2+ presets) */}
        {selectedPresets.length >= 2 && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase">เงื่อนไข</label>
            <div className="mt-1 inline-flex rounded-md border overflow-hidden w-full">
              <button
                onClick={() => setMatchMode("any")}
                className={cn("flex-1 h-8 text-[11px]", matchMode === "any" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                ใกล้อย่างน้อย 1 ประเภท
              </button>
              <button
                onClick={() => setMatchMode("all")}
                className={cn("flex-1 h-8 text-[11px] border-l", matchMode === "all" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                ต้องใกล้ทุกประเภท
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !bbox || (selectedPresets.length === 0 && !freeText.trim())}
            className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {mut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            ค้นหา
          </button>
          {lastResult && (
            <button onClick={clearAll} className="h-9 px-3 rounded-md border text-xs hover:bg-accent">
              ล้าง
            </button>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground">
          ค้นหาในขอบเขตแผนที่ปัจจุบัน · ขยายแผนที่เพื่อจำกัดพื้นที่
        </div>
      </div>

      {/* Results */}
      {lastResult && (
        <>
          <div className="px-3 py-2 border-b bg-blue-50 dark:bg-blue-950/30 text-xs flex items-center justify-between gap-2">
            <div className="text-blue-900 dark:text-blue-100">
              <b>{lastResult.pois.length}</b> POI · <b>{lastResult.matchedAssetCount}</b> ป้ายใกล้เคียง
              {lastResult.elapsedMs != null && (
                <span className="text-muted-foreground ml-1">· {(lastResult.elapsedMs / 1000).toFixed(1)}s</span>
              )}
            </div>
            <button onClick={exportCsv}
              className="h-7 px-2 rounded-md border text-[11px] hover:bg-accent inline-flex items-center gap-1 bg-background">
              <Download className="size-3" /> CSV
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {lastResult.pois.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">ไม่พบ POI ในขอบเขตนี้</div>
            ) : (
              lastResult.pois
                .slice()
                .sort((a, b) => (matchesByPoi.get(b.id)?.length ?? 0) - (matchesByPoi.get(a.id)?.length ?? 0))
                .map((p) => {
                  const preset = PRESET_BY_KEY[p.presetKey];
                  const matches = matchesByPoi.get(p.id) ?? [];
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

function MultiSelectDropdown({
  open, setOpen, label, placeholder, options, selected, onToggle, loading,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  label: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  loading?: boolean;
}) {
  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} รายการ`;
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={loading}
            className="h-8 w-full rounded-md border bg-background px-2.5 text-[11px] inline-flex items-center justify-between hover:bg-accent disabled:opacity-50"
          >
            <span className="truncate">{loading ? "กำลังโหลด…" : summary}</span>
            <ChevronsUpDown className="size-3 opacity-60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[260px] z-[1100]" align="start">
          <Command>
            <CommandInput placeholder={`ค้นหา ${label}…`} />
            <CommandList className="max-h-[240px]">
              <CommandEmpty>ไม่พบ</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const sel = selected.includes(o.value);
                  return (
                    <CommandItem
                      key={o.value}
                      value={o.label}
                      onSelect={() => onToggle(o.value)}
                      className="cursor-pointer"
                    >
                      <div className={cn(
                        "mr-2 size-4 rounded border grid place-items-center shrink-0",
                        sel ? "bg-primary border-primary text-primary-foreground" : "bg-background",
                      )}>
                        {sel && <Check className="size-3" />}
                      </div>
                      <span className="text-xs truncate">{o.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border bg-background">
              {v}
              <button onClick={() => onToggle(v)} className="opacity-60 hover:opacity-100">
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
