// Ad Campaigns — browse ad names (product_name) synced from the CRM database,
// see which assets each ad runs on, historical placements, period occupancy and
// the vacant-asset prospect list. Data comes from public.ad_contracts +
// public.ad_current_by_asset (no AI, no paid API).
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Megaphone,
  Search as SearchIcon,
  MapPin,
  CalendarClock,
  Download,
  Share2,
  Loader2,
  Building2,
  Camera,
  Navigation,
} from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  getAdSummary,
  listAdProducts,
  getAdPlacements,
  getAdsInPeriod,
  getVacantAssets,
  listAdBrands,
  listNewlyLaunchedAds,
  type AdAsset,
  type AdRow,
} from "@/lib/ad-contracts.functions";
import { createPoiShare } from "@/lib/poi-share.functions";


export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Ad Campaigns — ชื่อโฆษณาและสัญญาป้าย" },
      {
        name: "description",
        content:
          "ค้นหาชื่อโฆษณา ดูรายการป้ายที่โฆษณาขึ้นอยู่ วันสิ้นสุดสัญญา ประวัติย้อนหลัง และป้ายที่ยังว่าง",
      },
      { property: "og:title", content: "Ad Campaigns — ชื่อโฆษณาและสัญญาป้าย" },
      {
        property: "og:description",
        content: "ข้อมูลโฆษณาปัจจุบัน/ย้อนหลังรายป้าย พร้อมรายการป้ายว่างสำหรับทีมขาย",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampaignsPage,
});

/** sessionStorage handoff read by /map to focus a campaign's assets. */
export const AD_FOCUS_KEY = "ad_campaign_focus";
/** sessionStorage handoff read by /route-monitoring to build a "photo" plan. */
export const PHOTO_ROUTE_KEY = "ad_photo_route";
/** Default lookback window (days) for "โฆษณาขึ้นใหม่". */
export const NEW_AD_WINDOW_DAYS = 7;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function daysLeft(end: string | null | undefined): number | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - Date.now();
  return Math.ceil(ms / 86400_000);
}

function EndBadge({ end }: { end: string | null | undefined }) {
  const d = daysLeft(end);
  if (d == null) return <span className="text-muted-foreground">-</span>;
  const tone =
    d < 0
      ? "bg-muted text-muted-foreground"
      : d <= 30
        ? "bg-destructive/15 text-destructive"
        : d <= 90
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", tone)}>
      {fmtDate(end)}
      <span className="opacity-70">({d < 0 ? "หมดแล้ว" : `${d} วัน`})</span>
    </span>
  );
}

function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function CampaignsPage() {
  const [tab, setTab] = useState("current");

  const summaryFn = useServerFn(getAdSummary);
  const { data: summary } = useQuery({
    queryKey: ["ad-summary"],
    queryFn: () => summaryFn(),
    staleTime: 5 * 60_000,
  });

  const newFn = useServerFn(listNewlyLaunchedAds);
  const { data: newAds } = useQuery({
    queryKey: ["new-ads", NEW_AD_WINDOW_DAYS],
    queryFn: () => newFn({ data: { days: NEW_AD_WINDOW_DAYS } }),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Ad Campaigns"
        subtitle="แบรนด์ เลขที่สัญญา และป้ายที่ขึ้นโฆษณา (ซิงก์จากฐานข้อมูล CRM)"
      />

      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 mb-5">
        <Kpi label="ป้ายทั้งหมด" value={summary?.totalAssets} icon={<Building2 className="h-4 w-4" />} />
        <Kpi label="ป้ายมีโฆษณาอยู่" value={summary?.occupiedAssets} icon={<Megaphone className="h-4 w-4" />} />
        <Kpi label="ป้ายว่าง" value={summary?.vacantAssets} icon={<MapPin className="h-4 w-4" />} />
        <Kpi label="สัญญาที่กำลังขึ้น" value={summary?.activeContracts ?? summary?.activeProducts} icon={<Megaphone className="h-4 w-4" />} />
        <Kpi label="แบรนด์ที่กำลังขึ้น" value={summary?.activeBrands} icon={<Megaphone className="h-4 w-4" />} />
        <Kpi
          label={`ป้ายขึ้นใหม่ ${NEW_AD_WINDOW_DAYS} วัน (รอถ่ายรูป)`}
          value={newAds?.assetCount}
          icon={<Camera className="h-4 w-4" />}
          highlight
        />
        <Kpi
          label="สัญญาหมดใน 30 วัน"
          value={summary?.expiring30}
          icon={<CalendarClock className="h-4 w-4" />}
          alert
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="current">โฆษณาปัจจุบัน</TabsTrigger>
          <TabsTrigger value="new" className="gap-1.5">
            <Camera className="h-3.5 w-3.5" /> ขึ้นใหม่ / รอถ่ายรูป
            {(newAds?.assetCount ?? 0) > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {newAds?.assetCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">ประวัติย้อนหลัง</TabsTrigger>
          <TabsTrigger value="period">ตามช่วงเวลา</TabsTrigger>
          <TabsTrigger value="vacant">ป้ายว่าง</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4">
          <ProductBrowser scope="current" />
        </TabsContent>
        <TabsContent value="new" className="mt-4">
          <NewLaunchTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <ProductBrowser scope="all" />
        </TabsContent>
        <TabsContent value="period" className="mt-4">
          <PeriodTab />
        </TabsContent>
        <TabsContent value="vacant" className="mt-4">
          <VacantTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  alert,
  highlight,
}: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  alert?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && (value ?? 0) > 0 && "ring-1 ring-primary/40")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
          <span className="truncate">{label}</span>
          {icon}
        </div>
        <div
          className={cn(
            "text-2xl font-bold",
            alert && (value ?? 0) > 0 && "text-destructive",
            highlight && (value ?? 0) > 0 && "text-primary",
          )}
        >

          {value == null ? <Skeleton className="h-7 w-16" /> : value.toLocaleString("th-TH")}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Product browser (current / all history) ----------------

function ProductBrowser({ scope }: { scope: "current" | "all" }) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showSug, setShowSug] = useState(false);

  const brandsFn = useServerFn(listAdBrands);
  const { data: brands } = useQuery({
    queryKey: ["ad-brands", scope],
    queryFn: () => brandsFn({ data: { scope } }),
    staleTime: 5 * 60_000,
  });

  const listFn = useServerFn(listAdProducts);
  const { data: products, isLoading } = useQuery({
    queryKey: ["ad-products", scope, q, brand],
    queryFn: () => listFn({ data: { q: q || undefined, brand: brand || undefined, scope } }),
    staleTime: 60_000,
  });

  // Type-ahead: closest matches from brand / brand_eng / ad name
  const suggestions = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 1) return [] as Array<{ kind: "brand" | "product"; label: string; sub: string | null; count: number }>;
    const out: Array<{ kind: "brand" | "product"; label: string; sub: string | null; count: number }> = [];
    for (const b of brands ?? []) {
      if (b.brand.toLowerCase().includes(t) || (b.brandEng ?? "").toLowerCase().includes(t))
        out.push({ kind: "brand", label: b.brand, sub: b.brandEng, count: b.assetCount });
      if (out.length >= 6) break;
    }
    for (const p of products ?? []) {
      if (out.length >= 10) break;
      if (p.product.toLowerCase().includes(t)) out.push({ kind: "product", label: p.product, sub: p.brand, count: p.assetCount });
    }
    return out;
  }, [q, brands, products]);

  const placementsFn = useServerFn(getAdPlacements);
  const { data: placements, isLoading: loadingPlacements } = useQuery({
    queryKey: ["ad-placements", scope, selected],
    queryFn: () => placementsFn({ data: { product: selected as string, scope: scope === "all" ? "all" : "current" } }),
    enabled: !!selected,
    staleTime: 60_000,
  });

  const rowsByCode = useMemo(() => {
    const m = new Map<string, AdRow>();
    for (const c of placements?.contracts ?? []) if (c.asset_old_code) m.set(c.asset_old_code, c);
    return m;
  }, [placements?.contracts]);

  const assets: AdAsset[] = placements?.assets ?? [];

  const focusOnMap = () => {
    const codes = assets.map((a) => a.old_code).filter(Boolean);
    if (!codes.length) return toast.error("ไม่พบพิกัดป้ายของโฆษณานี้");
    sessionStorage.setItem(
      AD_FOCUS_KEY,
      JSON.stringify({ product: selected, codes, at: Date.now() }),
    );
    window.location.href = "/map";
  };

  const exportCsv = () => {
    if (!selected) return;
    const rows: (string | number | null)[][] = [
      ["Brand", "Brand (EN)", "Package", "Ad Contract", "Asset Code", "ชื่อป้าย", "Media Type", "แผนก", "เขต", "ทำเล", "สถานะสัญญา", "เริ่มสัญญา", "สิ้นสุดสัญญา", "ติดตั้งจริง", "Lat", "Lng"],
    ];
    for (const a of assets) {
      const c = rowsByCode.get(a.old_code);
      rows.push([
        c?.brand ?? null,
        c?.brand_eng ?? null,
        c?.package_name ?? null,
        selected,
        a.old_code,
        a.name,
        a.media_type,
        a.department,
        a.district,
        a.location,
        c?.status ?? null,
        c?.start_date_contract ?? null,
        c?.end_date_contract ?? null,
        c?.favor_start_date_contract ?? null,
        a.lat,
        a.lng,
      ]);
    }
    downloadCsv(`ad-${selected}.csv`, rows);
  };

  const shareFn = useServerFn(createPoiShare);
  const share = async () => {
    if (!selected) return;
    const withGeo = assets.filter((a) => a.lat != null && a.lng != null);
    if (!withGeo.length) return toast.error("ไม่มีป้ายที่มีพิกัดสำหรับแชร์");
    setSharing(true);
    try {
      const lats = withGeo.map((a) => a.lat as number);
      const lngs = withGeo.map((a) => a.lng as number);
      const res = await shareFn({
        data: {
          payload: {
            pois: [],
            matches: [],
            radiusM: 200,
            matchMode: "any",
            bbox: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)],
            presetKeys: [],
            freeText: `สัญญา: ${selected}`,
            chipProjects: [],
            chipMedia: [],
            project: "all",
            media: "all",
            assets: withGeo.map((a) => ({
              id: a.old_code,
              old_code: a.old_code,
              name: a.name,
              department: a.department,
              media_type: a.media_type,
              location: a.location,
              lat: a.lat as number,
              lng: a.lng as number,
            })),
          },
        },
      });
      const url = `${window.location.origin}/shared/poi/${res.token}`;
      await navigator.clipboard.writeText(url).catch(() => null);
      toast.success("คัดลอกลิงก์แชร์แล้ว (อายุ 72 ชม.)", { description: url });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ค้นหาแบรนด์ / เลขที่สัญญา</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowSug(true);
              }}
              onFocus={() => setShowSug(true)}
              onBlur={() => window.setTimeout(() => setShowSug(false), 150)}
              placeholder="ค้นหาแบรนด์ / เลขที่สัญญา เช่น พรอมิส, PROMISE, PB26010558"
              className="pl-9"
            />
            {showSug && suggestions.length > 0 && (
              <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-md border bg-popover shadow-lg">
                {suggestions.map((sg) => (
                  <li key={`${sg.kind}-${sg.label}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (sg.kind === "brand") {
                          setBrand(sg.label);
                          setQ("");
                          setSelected(null);
                        } else {
                          setQ(sg.label);
                          setSelected(sg.label);
                        }
                        setShowSug(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/70 transition"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">
                          <span className="mr-1 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                            {sg.kind === "brand" ? "แบรนด์" : "สัญญา"}
                          </span>
                          {sg.label}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{sg.count} ป้าย</span>
                      </div>
                      {sg.sub && <div className="truncate text-[11px] text-muted-foreground">{sg.sub}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <select
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              setSelected(null);
            }}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            title="กรองตามแบรนด์"
          >
            <option value="">แบรนด์ทั้งหมด</option>
            {(brands ?? []).map((b) => (
              <option key={b.brand} value={b.brand}>
                {b.brand}
                {b.brandEng ? ` (${b.brandEng})` : ""} · {b.assetCount} ป้าย
              </option>
            ))}
          </select>
          {brand && (
            <button
              type="button"
              onClick={() => setBrand("")}
              className="text-xs text-muted-foreground underline"
            >
              ล้างตัวกรองแบรนด์
            </button>
          )}
          <div className="max-h-[520px] overflow-auto -mx-2">
            {isLoading ? (
              <div className="space-y-2 px-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (products ?? []).length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground text-center">
                ไม่พบสัญญาโฆษณา — ตรวจการซิงก์ CRM ที่ “ตั้งค่าระบบ”
              </p>
            ) : (
              <ul className="px-2">
                {(products ?? []).map((p) => (
                  <li key={p.product}>
                    <button
                      onClick={() => setSelected(p.product)}
                      className={cn(
                        "w-full text-left rounded-md px-3 py-2 hover:bg-muted/60 transition",
                        selected === p.product && "bg-primary/10 ring-1 ring-primary/30",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {p.brand ?? "(ไม่ระบุแบรนด์)"}
                          {p.brandEng ? ` (${p.brandEng})` : ""}
                        </span>
                        <Badge variant="secondary" className="shrink-0" title="จำนวนป้ายในสัญญานี้">
                          {p.assetCount} ป้าย
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        สัญญา {p.product}
                        {p.packageName ? ` · ${p.packageName}` : ""}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtDate(p.firstStart)} → {fmtDate(p.lastEnd)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              {selected ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {placements?.contracts?.[0]?.brand ?? "(ไม่ระบุแบรนด์)"}
                    {placements?.contracts?.[0]?.brand_eng ? ` (${placements.contracts[0].brand_eng})` : ""}
                  </span>
                  <Badge variant="outline" title="เลขที่สัญญาจาก CRM">สัญญา {selected}</Badge>
                  {placements?.contracts?.[0]?.package_name && (
                    <Badge variant="secondary">{placements.contracts[0].package_name}</Badge>
                  )}
                  <Badge variant="secondary">
                    {assets.length} / {placements?.contracts?.length ?? 0} ป้ายที่จับคู่ได้
                  </Badge>
                </span>
              ) : (
                "เลือกสัญญาด้านซ้าย"
              )}
            </CardTitle>
            {selected && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={focusOnMap}>
                  <MapPin className="h-4 w-4 mr-1" /> ดูบนแผนที่
                </Button>
                <Button size="sm" variant="secondary" onClick={exportCsv}>
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button size="sm" variant="secondary" onClick={share} disabled={sharing}>
                  {sharing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Share2 className="h-4 w-4 mr-1" />}
                  แชร์ให้ลูกค้า
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              เลือกสัญญาด้านซ้ายเพื่อดูรายการป้าย วันเริ่ม/สิ้นสุดสัญญา และวันติดตั้งจริง
            </p>
          ) : loadingPlacements ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-auto max-h-[560px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">รหัสป้าย</th>
                    <th className="py-2 pr-3">แบรนด์</th>
                    <th className="py-2 pr-3">ทำเล</th>
                    <th className="py-2 pr-3">Media</th>
                    <th className="py-2 pr-3">สถานะ</th>
                    <th className="py-2 pr-3">เริ่มสัญญา</th>
                    <th className="py-2 pr-3">สิ้นสุดสัญญา</th>
                    <th className="py-2 pr-3">ติดตั้งจริง</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => {
                    const c = rowsByCode.get(a.old_code);
                    return (
                      <tr key={a.old_code} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 pr-3 font-medium">{a.old_code}</td>
                        <td className="py-2 pr-3 max-w-[180px]">
                          <span className="block truncate font-medium">{c?.brand ?? "-"}</span>
                          {c?.brand_eng && (
                            <span className="block truncate text-[11px] text-muted-foreground">{c.brand_eng}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 max-w-[280px] truncate">{a.location ?? a.name ?? "-"}</td>
                        <td className="py-2 pr-3">{a.media_type ?? "-"}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={c?.status === "current" ? "default" : "secondary"}>
                            {c?.status ?? "-"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">{fmtDate(c?.start_date_contract)}</td>
                        <td className="py-2 pr-3"><EndBadge end={c?.end_date_contract} /></td>
                        <td className="py-2 pr-3">{fmtDate(c?.favor_start_date_contract)}</td>
                      </tr>
                    );
                  })}
                  {assets.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        ป้ายในสัญญานี้ยังจับคู่กับฐานข้อมูลป้ายของเราไม่ได้ (รหัสจาก CRM ไม่ตรงกับตารางป้าย)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Period tab ----------------

function PeriodTab() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);

  const fn = useServerFn(getAdsInPeriod);
  const { data, isLoading } = useQuery({
    queryKey: ["ads-period", applied?.from, applied?.to],
    queryFn: () => fn({ data: { from: applied!.from, to: applied!.to } }),
    enabled: !!applied,
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">โฆษณาที่ขึ้นในช่วงเวลา</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            จากวันที่
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">
            ถึงวันที่
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
          </label>
          <Button onClick={() => setApplied({ from, to })}>ดูข้อมูล</Button>
        </div>

        {!applied ? (
          <p className="text-sm text-muted-foreground">เลือกช่วงเวลาแล้วกด “ดูข้อมูล”</p>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              พบรายการสัญญา-ป้าย {data?.total.toLocaleString("th-TH")} แถว / {data?.products.length} เลขที่สัญญา
            </p>
            <div className="overflow-auto max-h-[520px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">แบรนด์</th>
                    <th className="py-2 pr-3">เลขที่สัญญา</th>
                    <th className="py-2 pr-3">จำนวนป้าย</th>
                    <th className="py-2 pr-3">สัญญา</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.products ?? []).map((p) => (
                    <tr key={p.product} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-3 font-medium">
                        {p.rows.find((r) => r.brand)?.brand ?? "-"}
                        {p.rows.find((r) => r.brand_eng)?.brand_eng
                          ? ` (${p.rows.find((r) => r.brand_eng)?.brand_eng})`
                          : ""}
                      </td>
                      <td className="py-2 pr-3">{p.product}</td>
                      <td className="py-2 pr-3">{p.assetCount}</td>
                      <td className="py-2 pr-3">{p.rows.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Vacant tab ----------------

function VacantTab() {
  const [media, setMedia] = useState<string>("");
  const fn = useServerFn(getVacantAssets);
  const { data, isLoading } = useQuery({
    queryKey: ["vacant-assets", media],
    queryFn: () => fn({ data: media ? { mediaType: media } : {} }),
    staleTime: 5 * 60_000,
  });

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      ["Asset Code", "ชื่อป้าย", "Media Type", "แผนก", "เขต", "ทำเล", "Lat", "Lng"],
    ];
    for (const a of data?.vacant ?? [])
      rows.push([a.old_code, a.name, a.media_type, a.department, a.district, a.location, a.lat, a.lng]);
    downloadCsv("vacant-assets.csv", rows);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            ป้ายที่ยังไม่มีโฆษณา {data ? <Badge variant="outline">{data.vacant.length}</Badge> : null}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <select
              value={media}
              onChange={(e) => setMedia(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Media Type ทั้งหมด</option>
              {(data?.mediaTypes ?? []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!data?.vacant.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3">รหัสป้าย</th>
                  <th className="py-2 pr-3">ทำเล</th>
                  <th className="py-2 pr-3">Media</th>
                  <th className="py-2 pr-3">แผนก</th>
                  <th className="py-2 pr-3">เขต</th>
                </tr>
              </thead>
              <tbody>
                {(data?.vacant ?? []).slice(0, 500).map((a) => (
                  <tr key={a.old_code} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3 font-medium">{a.old_code}</td>
                    <td className="py-2 pr-3 max-w-[280px] truncate">{a.location ?? a.name ?? "-"}</td>
                    <td className="py-2 pr-3">{a.media_type ?? "-"}</td>
                    <td className="py-2 pr-3">{a.department ?? "-"}</td>
                    <td className="py-2 pr-3">{a.district ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(data?.vacant.length ?? 0) > 500 && (
              <p className="pt-2 text-xs text-muted-foreground">
                แสดง 500 รายการแรก — ใช้ปุ่ม CSV เพื่อดูทั้งหมด
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Newly launched / photo queue tab ----------------

const WINDOW_OPTIONS = [3, 7, 14, 30];

function NewLaunchTab() {
  const [days, setDays] = useState(NEW_AD_WINDOW_DAYS);
  const [brand, setBrand] = useState("");
  const [sharing, setSharing] = useState(false);

  const fn = useServerFn(listNewlyLaunchedAds);
  const { data, isLoading } = useQuery({
    queryKey: ["new-ads-tab", days, brand],
    queryFn: () => fn({ data: { days, brand: brand || undefined } }),
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];
  const brandOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.brand) s.add(r.brand);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "th"));
  }, [rows]);

  const codes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.asset_old_code).filter(Boolean) as string[])),
    [rows],
  );
  const geoRows = useMemo(
    () => rows.filter((r) => r.asset?.lat != null && r.asset?.lng != null),
    [rows],
  );
  /** Codes that exist in the asset master — the only ones Route Monitoring can plan. */
  const matchedCodes = useMemo(
    () =>
      Array.from(
        new Set(rows.filter((r) => r.asset).map((r) => r.asset_old_code).filter(Boolean) as string[]),
      ),
    [rows],
  );
  const unmatchedCount = rows.filter((r) => !r.asset).length;

  const sendToRoute = () => {
    if (!matchedCodes.length)
      return toast.error("ยังไม่มีป้ายที่จับคู่กับฐานข้อมูลป้ายได้ จึงวางแผนเส้นทางไม่ได้", {
        description: `รายการทั้งหมด ${rows.length} แถวยังไม่มีในฐานข้อมูลป้าย (MSSQL) — ใช้ปุ่ม "แชร์ให้ทีมถ่ายรูป" เป็น checklist ได้`,
      });
    sessionStorage.setItem(
      PHOTO_ROUTE_KEY,
      JSON.stringify({
        codes: matchedCodes,
        label: `ถ่ายรูปโฆษณาขึ้นใหม่ ${days} วัน${brand ? ` · ${brand}` : ""}`,
        at: Date.now(),
      }),
    );
    if (unmatchedCount > 0)
      toast.info(`ส่งเข้าแผน ${matchedCodes.length} ป้าย (อีก ${unmatchedCount} แถวยังจับคู่ป้ายไม่ได้)`);
    window.location.href = "/route-monitoring";
  };

  const focusOnMap = () => {
    if (!geoRows.length)
      return toast.error("ไม่พบพิกัดป้ายของรายการนี้", {
        description: "ป้ายชุดนี้ยังไม่มีในฐานข้อมูลป้าย (MSSQL) จึงยังไม่มีพิกัดให้ปักหมุด",
      });
    sessionStorage.setItem(
      AD_FOCUS_KEY,
      JSON.stringify({ product: `ขึ้นใหม่ ${days} วัน`, codes: matchedCodes, at: Date.now() }),
    );
    window.location.href = "/map";
  };


  const exportCsv = () => {
    const out: (string | number | null)[][] = [
      ["Brand", "Brand (EN)", "เลขที่สัญญา", "Package", "รหัสป้าย", "ชื่อป้าย", "Media Type", "แผนก", "เขต", "ทำเล", "วันติดตั้งจริง", "ขึ้นมาแล้ว (วัน)", "สิ้นสุดสัญญา", "Lat", "Lng"],
    ];
    for (const r of rows)
      out.push([
        r.brand,
        r.brand_eng,
        r.ad_contract,
        r.package_name,
        r.asset_old_code,
        r.asset?.name ?? null,
        r.asset?.media_type ?? null,
        r.asset?.department ?? null,
        r.asset?.district ?? null,
        r.asset?.location ?? null,
        r.favor_start,
        r.days_since_launch,
        r.end_date_contract,
        r.asset?.lat ?? null,
        r.asset?.lng ?? null,
      ]);
    downloadCsv(`new-ads-${days}d.csv`, out);
  };

  const shareFn = useServerFn(createPoiShare);
  const share = async () => {
    if (!rows.length) return toast.error("ไม่มีรายการสำหรับแชร์");
    setSharing(true);
    try {
      const lats = geoRows.map((r) => r.asset!.lat as number);
      const lngs = geoRows.map((r) => r.asset!.lng as number);
      // No matched coordinates yet → fall back to a Bangkok-wide bbox so the
      // shared page still renders, and rely on the checklist below.
      const bbox: [number, number, number, number] = geoRows.length
        ? [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)]
        : [13.5, 100.3, 14.0, 100.95];
      const res = await shareFn({
        data: {
          payload: {
            pois: [],
            matches: [],
            radiusM: 200,
            matchMode: "any",
            bbox,
            presetKeys: [],
            freeText: `งานถ่ายรูปโฆษณาขึ้นใหม่ ${days} วัน`,
            chipProjects: [],
            chipMedia: [],
            project: "all",
            media: "all",
            assets: geoRows.map((r) => ({
              id: r.asset_old_code ?? r.id,
              old_code: r.asset_old_code ?? "",
              name: r.brand ? `${r.brand} · ${r.asset?.name ?? ""}` : (r.asset?.name ?? null),
              department: r.asset?.department ?? null,
              media_type: r.asset?.media_type ?? null,
              location: r.asset?.location ?? null,
              lat: r.asset!.lat as number,
              lng: r.asset!.lng as number,
            })),
            checklistTitle: `รายการถ่ายรูปโฆษณาขึ้นใหม่ ${days} วัน${brand ? ` · ${brand}` : ""}`,
            checklist: rows.map((r) => ({
              code: r.asset_old_code,
              brand: r.brand,
              contract: r.ad_contract,
              location: r.asset?.location ?? null,
              mediaType: r.asset?.media_type ?? null,
              favorStart: r.favor_start,
              endDate: r.end_date_contract,
              hasGeo: r.asset?.lat != null && r.asset?.lng != null,
            })),
          },
        },
      });
      const url = `${window.location.origin}/shared/poi/${res.token}`;
      await navigator.clipboard.writeText(url).catch(() => null);
      toast.success(
        `คัดลอกลิงก์งานถ่ายรูปแล้ว (อายุ 72 ชม.) — ${rows.length} รายการ, ปักหมุดได้ ${geoRows.length}`,
        { description: url },
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSharing(false);
    }
  };


  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4" /> โฆษณาที่ขึ้นใหม่ (รอทีมถ่ายรูป)
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              เกณฑ์: วันติดตั้งจริง (favor start) อยู่ในช่วง {days} วันล่าสุด — ป้าย {data?.assetCount ?? 0} ป้าย ·
              สัญญา {data?.contractCount ?? 0} · แบรนด์ {data?.brandCount ?? 0} · มีพิกัด {data?.withGeo ?? 0}
            </p>
            {unmatchedCount > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                {unmatchedCount} จาก {rows.length} แถวยังจับคู่กับฐานข้อมูลป้ายไม่ได้ (MSSQL ซิงก์ไม่ครบ) →
                วางแผนเส้นทาง/ปักหมุดได้เฉพาะ {matchedCodes.length} ป้าย ส่วนลิงก์แชร์จะได้ครบทุกแถวเป็น checklist
              </p>
            )}

          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              title="ช่วงเวลาที่ถือว่า 'ขึ้นใหม่'"
            >
              {WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  ย้อนหลัง {d} วัน
                </option>
              ))}
            </select>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              title="กรองตามแบรนด์"
            >
              <option value="">แบรนด์ทั้งหมด</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={sendToRoute} disabled={!rows.length} title="ส่งป้ายที่จับคู่ได้เข้า Route Monitoring">
              <Navigation className="h-4 w-4 mr-1" /> สร้างแผนถ่ายรูป
              {matchedCodes.length > 0 && unmatchedCount > 0 ? ` (${matchedCodes.length})` : ""}
            </Button>
            <Button size="sm" variant="secondary" onClick={focusOnMap} disabled={!rows.length}>
              <MapPin className="h-4 w-4 mr-1" /> ดูบนแผนที่
            </Button>
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={share} disabled={sharing || !rows.length}>
              {sharing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Share2 className="h-4 w-4 mr-1" />}
              แชร์ให้ทีมถ่ายรูป
            </Button>

          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            ไม่มีโฆษณาที่ขึ้นใหม่ในช่วง {days} วันล่าสุด
          </p>
        ) : (
          <div className="overflow-auto max-h-[560px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3">รหัสป้าย</th>
                  <th className="py-2 pr-3">แบรนด์</th>
                  <th className="py-2 pr-3">เลขที่สัญญา</th>
                  <th className="py-2 pr-3">ทำเล</th>
                  <th className="py-2 pr-3">Media</th>
                  <th className="py-2 pr-3">ติดตั้งจริง</th>
                  <th className="py-2 pr-3">ขึ้นมาแล้ว</th>
                  <th className="py-2 pr-3">สิ้นสุดสัญญา</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3 font-medium">
                      {r.asset_old_code ?? "-"}
                      {!r.asset && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(ยังจับคู่ป้ายไม่ได้)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 max-w-[180px]">
                      <span className="block truncate font-medium">{r.brand ?? "-"}</span>
                      {r.brand_eng && (
                        <span className="block truncate text-[11px] text-muted-foreground">{r.brand_eng}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block truncate">{r.ad_contract ?? "-"}</span>
                      {r.package_name && (
                        <span className="block truncate text-[11px] text-muted-foreground">{r.package_name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 max-w-[260px] truncate">
                      {r.asset?.location ?? r.asset?.name ?? "-"}
                    </td>
                    <td className="py-2 pr-3">{r.asset?.media_type ?? "-"}</td>
                    <td className="py-2 pr-3">{fmtDate(r.favor_start)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={(r.days_since_launch ?? 99) <= 2 ? "default" : "secondary"}>
                        {r.days_since_launch == null
                          ? "-"
                          : r.days_since_launch === 0
                            ? "วันนี้"
                            : `${r.days_since_launch} วัน`}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <EndBadge end={r.end_date_contract} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
