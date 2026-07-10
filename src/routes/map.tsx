import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui-bits";
import { MapPin, AlertTriangle, Layers, Search, Maximize2, Minimize2, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listAssetsForMap, listOpenClaimOldCodes } from "@/lib/map.functions";
import { PROJECT_TO_DEPARTMENTS, projectForDepartment } from "@/lib/project-department-map";

const AssetMap = lazy(() => import("@/components/asset-map"));

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Asset Map — Asset History 360" },
      { name: "description", content: "แผนที่ป้ายโฆษณาทั้งหมด กรองตาม Project / Media Type พร้อมสัญลักษณ์เตือนป้ายที่กำลังซ่อม" },
    ],
  }),
  component: MapPage,
});

function MapPage() {
  const assetsFn = useServerFn(listAssetsForMap);
  const claimsFn = useServerFn(listOpenClaimOldCodes);

  const { data: assetsData, isLoading: loadingAssets } = useQuery({
    queryKey: ["map", "assets"],
    queryFn: () => assetsFn({}),
    staleTime: 5 * 60_000,
  });
  const { data: claimsData } = useQuery({
    queryKey: ["map", "open-claims"],
    queryFn: () => claimsFn({}),
    staleTime: 60_000,
  });

  const allAssets = assetsData?.assets ?? [];
  const mediaTypes = assetsData?.mediaTypes ?? [];
  const claimedCodes = useMemo(
    () => new Set(claimsData?.oldCodes ?? []),
    [claimsData?.oldCodes],
  );
  const totalTickets = claimsData?.totalTickets ?? 0;

  const [fProject, setFProject] = useState("all");
  const [fMedia, setFMedia] = useState("all");
  const [q, setQ] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [onlyClaimed, setOnlyClaimed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const projectDepts = fProject !== "all"
      ? new Set(PROJECT_TO_DEPARTMENTS[fProject] ?? [])
      : null;
    return allAssets.filter((a) => {
      if (projectDepts && (!a.department || !projectDepts.has(a.department))) return false;
      if (fMedia !== "all" && a.media_type !== fMedia) return false;
      if (onlyClaimed && (!a.old_code || !claimedCodes.has(a.old_code))) return false;
      return true;
    });
  }, [allAssets, fProject, fMedia, onlyClaimed, claimedCodes]);

  const suggestions = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return [];
    const out: typeof filtered = [];
    for (const a of filtered) {
      const hay = `${a.old_code ?? ""} ${a.name ?? ""} ${a.location ?? ""}`.toLowerCase();
      if (hay.includes(qq)) out.push(a);
      if (out.length >= 12) break;
    }
    return out;
  }, [filtered, q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Esc to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const projects = Object.keys(PROJECT_TO_DEPARTMENTS);
  const hasFilter = fProject !== "all" || fMedia !== "all" || q || onlyClaimed;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2">
      {/* Inline stats */}
      <div className="flex items-center gap-3 px-2 border-r pr-3">
        <Stat icon={<MapPin className="size-4 text-primary" />} label="Shown" value={filtered.length} />
        <Stat icon={<AlertTriangle className="size-4 text-warning" />} label="Repairing" value={totalTickets} />
        <Stat icon={<Layers className="size-4 text-muted-foreground" />} label="Total" value={allAssets.length} />
      </div>

      {/* Search */}
      <div ref={searchWrapRef} className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSuggestOpen(true); }}
          onFocus={() => setSuggestOpen(true)}
          placeholder="ค้นหา Old Code / ชื่อ / ทำเล"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {suggestOpen && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-[1100] bg-popover text-popover-foreground border rounded-md shadow-lg max-h-80 overflow-y-auto">
            {suggestions.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setFocusId(a.id);
                  setQ(a.old_code ?? a.name ?? "");
                  setSuggestOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-b-0"
              >
                <div className="font-semibold truncate">{a.old_code ?? "—"}</div>
                <div className="text-xs text-muted-foreground truncate">{a.name ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[projectForDepartment(a.department) ?? a.department, a.media_type, a.location].filter(Boolean).join(" • ")}
                </div>
              </button>
            ))}
          </div>
        )}
        {suggestOpen && q.trim() && suggestions.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-[1100] bg-popover text-popover-foreground border rounded-md shadow-lg p-3 text-xs text-muted-foreground">
            ไม่พบผลลัพธ์
          </div>
        )}
      </div>

      <CompactSelect placeholder="Project" value={fProject} onChange={setFProject} options={projects} />
      <CompactSelect placeholder="Media Type" value={fMedia} onChange={setFMedia} options={mediaTypes} />

      <label className="flex items-center gap-2 h-9 px-3 rounded-md border cursor-pointer hover:bg-accent text-xs">
        <input
          type="checkbox"
          checked={onlyClaimed}
          onChange={(e) => setOnlyClaimed(e.target.checked)}
        />
        <span>เฉพาะที่กำลังซ่อม</span>
      </label>

      {hasFilter && (
        <button
          onClick={() => { setFProject("all"); setFMedia("all"); setQ(""); setOnlyClaimed(false); setFocusId(null); }}
          className="text-xs px-2.5 h-9 rounded-md border hover:bg-accent inline-flex items-center gap-1"
          title="ล้างตัวกรอง"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}

      <button
        onClick={() => setFullscreen((v) => !v)}
        className="ml-auto h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 text-xs"
        title={fullscreen ? "ออกจากโหมดเต็มจอ" : "ขยายเต็มจอ"}
      >
        {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        <span className="hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
      </button>
    </div>
  );

  const mapBox = (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden relative z-0",
      )}
      style={fullscreen ? { height: "calc(100vh - 88px)" } : { height: "calc(100vh - 240px)", minHeight: 480 }}
    >
      {loadingAssets ? (
        <Skeleton className="w-full h-full" />
      ) : (
        <ClientOnly fallback={<Skeleton className="w-full h-full" />}>
          <Suspense fallback={<Skeleton className="w-full h-full" />}>
            <AssetMap assets={filtered} claimedCodes={claimedCodes} focusId={focusId} />
          </Suspense>
        </ClientOnly>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[1000] bg-background p-3 flex flex-col gap-2">
        {toolbar}
        {mapBox}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Asset Map"
        subtitle="ตำแหน่งป้ายโฆษณาทั้งหมด แยกสีตาม Project • ป้ายที่มีเคลมเปิดจะขึ้นสัญลักษณ์เตือนสีเหลือง"
      />
      {toolbar}
      {mapBox}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}

function CompactSelect({
  placeholder,
  value,
  onChange,
  options,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[150px] text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="z-[1100]">
        <SelectItem value="all">{placeholder}: ทั้งหมด</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
