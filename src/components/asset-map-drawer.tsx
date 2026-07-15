import { lazy, Suspense, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Info, MapPin, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import type { MapAsset } from "@/lib/map.functions";
import NearbyPoiSection, { CopyLinkPill } from "@/components/nearby-poi-section";
import { projectForDepartment } from "@/lib/project-department-map";

const BillboardAnalyticsPanel = lazy(() => import("@/components/billboard-analytics-panel"));

type Props = {
  asset: MapAsset | null;
  claimed: boolean;
  onClose: () => void;
};

export default function AssetMapDrawer({ asset, claimed, onClose }: Props) {
  const [tab, setTab] = useState("overview");
  const [showAnalytics, setShowAnalytics] = useState(false);

  const open = !!asset;
  const gmapsUrl = asset ? `https://www.google.com/maps?q=${asset.lat},${asset.lng}` : "";
  const streetViewUrl = asset
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${asset.lat},${asset.lng}`
    : "";
  const historyUrl = asset?.old_code ? `/search?q=${encodeURIComponent(asset.old_code)}` : null;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[640px] p-0 flex flex-col gap-0 overflow-hidden"
        >
          {asset && (
            <>
              <SheetHeader className="p-5 border-b space-y-1 shrink-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" />
                  <span>{projectForDepartment(asset.department) ?? "—"}</span>
                  {claimed && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                      <AlertTriangle className="size-3" /> กำลังซ่อม
                    </span>
                  )}
                </div>
                <SheetTitle className="text-lg font-semibold truncate">
                  {asset.old_code ?? "—"}
                </SheetTitle>
                <div className="text-xs text-muted-foreground truncate">
                  {asset.name ?? asset.location ?? "—"}
                </div>
              </SheetHeader>

              <Tabs
                value={tab}
                onValueChange={setTab}
                className="flex-1 flex flex-col min-h-0"
              >
                <TabsList className="mx-5 mt-3 grid grid-cols-3 shrink-0">
                  <TabsTrigger value="overview" className="gap-1.5">
                    <Info className="size-3.5" /> ภาพรวม
                  </TabsTrigger>
                  <TabsTrigger value="analytics" className="gap-1.5">
                    <BarChart3 className="size-3.5" /> Analytics
                  </TabsTrigger>
                  <TabsTrigger value="poi" className="gap-1.5">
                    <ExternalLink className="size-3.5" /> POI ใกล้เคียง
                  </TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-y-auto min-h-0">
                  <TabsContent value="overview" className="p-5 space-y-4 mt-0">
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                      <span className="text-muted-foreground">Department</span>
                      <span className="truncate">{asset.department ?? "—"}</span>
                      <span className="text-muted-foreground">Media Type</span>
                      <span className="truncate">{asset.media_type ?? "—"}</span>
                      <span className="text-muted-foreground">Location</span>
                      <span className="truncate">{asset.location ?? "—"}</span>
                      <span className="text-muted-foreground">Status</span>
                      <span className="truncate">{asset.status ?? "—"}</span>
                      <span className="text-muted-foreground">พิกัด</span>
                      <span className="truncate font-mono text-xs">
                        {asset.lat.toFixed(6)}, {asset.lng.toFixed(6)}
                      </span>
                    </div>

                    {claimed && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm inline-flex items-start gap-2">
                        <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                        <span>ป้ายนี้กำลังซ่อม (มีเคลมเปิดอยู่)</span>
                      </div>
                    )}

                    <div className="border-t pt-4 space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        คัดลอกลิงก์ไปเปิด tab ใหม่
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <CopyLinkPill url={gmapsUrl} label="Google Maps" />
                        <CopyLinkPill url={streetViewUrl} label="Street View" />
                      </div>
                    </div>

                    <div className="border-t pt-4 flex flex-wrap gap-2">
                      {historyUrl && (
                        <a
                          href={historyUrl}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                        >
                          <ExternalLink className="size-3.5" /> ดูประวัติป้าย
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setTab("analytics")}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium hover:bg-accent"
                      >
                        <BarChart3 className="size-3.5" /> ดู Analytics
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab("poi")}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium hover:bg-accent"
                      >
                        <ExternalLink className="size-3.5" /> ดู POI ใกล้เคียง
                      </button>
                    </div>
                  </TabsContent>

                  <TabsContent value="analytics" className="p-5 space-y-3 mt-0">
                    <p className="text-sm text-muted-foreground">
                      เปิด Analytics แบบเต็ม (Traffic, ประชากรเป้าหมาย, ช่วงเวลาหนาแน่น, Street View + Mockup, Export PPTX/PDF)
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAnalytics(true)}
                      className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                    >
                      <BarChart3 className="size-4" /> เปิด Analytics เต็มรูปแบบ
                    </button>
                  </TabsContent>

                  <TabsContent value="poi" className="p-5 mt-0">
                    {tab === "poi" && (
                      <NearbyPoiSection
                        assetId={asset.id}
                        lat={asset.lat}
                        lng={asset.lng}
                        enabled
                      />
                    )}
                  </TabsContent>
                </div>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {showAnalytics && asset && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[1300] bg-black/40 grid place-items-center">
              <Loader2 className="size-6 animate-spin text-white" />
            </div>
          }
        >
          <BillboardAnalyticsPanel asset={asset} onClose={() => setShowAnalytics(false)} />
        </Suspense>
      )}
    </>
  );
}
