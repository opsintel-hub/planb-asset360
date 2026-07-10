import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { MapPin, AlertTriangle, Layers, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAssetsForMap, listOpenClaimOldCodes } from "@/lib/map.functions";
import { PROJECT_TO_DEPARTMENTS } from "@/lib/project-department-map";

const AssetMap = lazy(() => import("@/components/asset-map"));

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "แผนที่ป้าย — Asset History 360" },
      { name: "description", content: "แผนที่ป้ายโฆษณาทั้งหมด กรองตาม Department / Media Type พร้อมสัญลักษณ์เตือนป้ายที่กำลังซ่อม" },
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
  const departments = assetsData?.departments ?? [];
  const mediaTypes = assetsData?.mediaTypes ?? [];
  const claimedCodes = useMemo(
    () => new Set(claimsData?.oldCodes ?? []),
    [claimsData?.oldCodes],
  );

  const [fProject, setFProject] = useState("all");
  const [fDept, setFDept] = useState("all");
  const [fMedia, setFMedia] = useState("all");
  const [q, setQ] = useState("");
  const [onlyClaimed, setOnlyClaimed] = useState(false);

  const filtered = useMemo(() => {
    const projectDepts = fProject !== "all"
      ? new Set(PROJECT_TO_DEPARTMENTS[fProject] ?? [])
      : null;
    const qq = q.trim().toLowerCase();
    return allAssets.filter((a) => {
      if (projectDepts && (!a.department || !projectDepts.has(a.department))) return false;
      if (fDept !== "all" && a.department !== fDept) return false;
      if (fMedia !== "all" && a.media_type !== fMedia) return false;
      if (onlyClaimed && (!a.old_code || !claimedCodes.has(a.old_code))) return false;
      if (qq) {
        const hay = `${a.old_code ?? ""} ${a.name ?? ""} ${a.location ?? ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [allAssets, fProject, fDept, fMedia, onlyClaimed, q, claimedCodes]);

  const shownClaimed = useMemo(
    () => filtered.filter((a) => a.old_code && claimedCodes.has(a.old_code)).length,
    [filtered, claimedCodes],
  );

  const projects = Object.keys(PROJECT_TO_DEPARTMENTS);

  return (
    <div className="space-y-4">
      <PageHeader
        title="แผนที่ป้าย"
        subtitle="ตำแหน่งป้ายโฆษณาทั้งหมด แยกสีตาม Department • ป้ายที่มีเคลมเปิดจะขึ้นสัญลักษณ์เตือนสีเหลือง"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="ป้ายที่แสดง" value={filtered.length.toLocaleString()} icon={<MapPin className="size-5" />} />
        <StatCard label="กำลังซ่อม (ในผลลัพธ์)" value={shownClaimed.toLocaleString()} tone="warning" icon={<AlertTriangle className="size-5" />} />
        <StatCard label="ทั้งหมดที่มีพิกัด" value={allAssets.length.toLocaleString()} icon={<Layers className="size-5" />} />
      </div>

      <div className="flex flex-wrap gap-3 items-end rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-1 min-w-[220px] flex-1">
          <label className="text-xs text-muted-foreground">ค้นหา (Old Code / ชื่อ / ทำเล)</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="พิมพ์เพื่อค้นหา"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <FilterSelect label="Project" value={fProject} onChange={setFProject} options={projects} />
        <FilterSelect label="Department" value={fDept} onChange={setFDept} options={departments} />
        <FilterSelect label="Media Type" value={fMedia} onChange={setFMedia} options={mediaTypes} />
        <label className="flex items-center gap-2 h-9 px-3 rounded-md border cursor-pointer hover:bg-accent text-sm">
          <input
            type="checkbox"
            checked={onlyClaimed}
            onChange={(e) => setOnlyClaimed(e.target.checked)}
          />
          <span>เฉพาะที่กำลังซ่อม</span>
        </label>
        {(fProject !== "all" || fDept !== "all" || fMedia !== "all" || q || onlyClaimed) && (
          <button
            onClick={() => { setFProject("all"); setFDept("all"); setFMedia("all"); setQ(""); setOnlyClaimed(false); }}
            className="text-xs px-3 py-2 rounded-md border hover:bg-accent h-9"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden" style={{ height: "calc(100vh - 340px)", minHeight: 480 }}>
        {loadingAssets ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <ClientOnly fallback={<Skeleton className="w-full h-full" />}>
            <Suspense fallback={<Skeleton className="w-full h-full" />}>
              <AssetMap assets={filtered} claimedCodes={claimedCodes} />
            </Suspense>
          </ClientOnly>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-col gap-1 min-w-[160px]">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder="ทั้งหมด" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">ทั้งหมด</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
