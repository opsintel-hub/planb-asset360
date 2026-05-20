import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, MapPin, Building2, ChevronDown } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { autocompleteAssets, getAssetWithHistory } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "ค้นหาประวัติป้ายโฆษณา — Asset History 360" },
      { name: "description", content: "ค้นหาและตรวจสอบประวัติการบำรุงรักษา งานซ่อม และ Monitoring ของป้ายโฆษณา" },
    ],
  }),
  component: SearchPage,
});

const tabs = [
  { id: "PM", label: "PM (Preventive Maintenance)" },
  { id: "Claim", label: "Claim (เคลม/แจ้งซ่อม)" },
  { id: "Monitor", label: "Monitoring (ตรวจสื่อ)" },
] as const;
type TabId = typeof tabs[number]["id"];

const RECENT_KEY = "asset-search-recent";

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function SearchPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("PM");
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(r)) setRecent(r.slice(0, 5));
    } catch { /* ignore */ }
  }, []);

  const debounced = useDebounced(query, 250);
  const autoFn = useServerFn(autocompleteAssets);
  const { data: ac, isFetching: acLoading } = useQuery({
    queryKey: ["autocomplete", debounced],
    queryFn: () => autoFn({ data: { q: debounced, limit: 20 } }),
    staleTime: 30_000,
  });

  const detailFn = useServerFn(getAssetWithHistory);
  const { data: detail, isFetching: detailLoading, refetch } = useQuery({
    queryKey: ["asset-detail", selectedCode, tab],
    queryFn: () => detailFn({ data: { oldCode: selectedCode!, tab } }),
    enabled: !!selectedCode,
  });

  function pickAsset(oldCode: string) {
    setSelectedCode(oldCode);
    setQuery(oldCode);
    setOpen(false);
    const next = [oldCode, ...recent.filter((c) => c !== oldCode)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  async function handleResync() {
    if (!selectedCode) return;
    toast.promise(
      detailFn({ data: { oldCode: selectedCode, tab, forceSync: true } }).then(() => refetch()),
      { loading: "กำลังดึงประวัติจาก PlanB...", success: "ซิงค์ประวัติสำเร็จ", error: (e) => `ซิงค์ไม่สำเร็จ: ${e?.message ?? e}` },
    );
  }

  const rows = ac?.rows ?? [];
  const asset = detail?.asset;
  const history = detail?.history ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="ค้นหาประวัติป้ายโฆษณา"
        subtitle="พิมพ์ Old Code, ชื่อ หรือพื้นที่ — เลือกจากรายการที่ขึ้นมา"
      />

      {/* Combobox */}
      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-3">
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="เริ่มพิมพ์เพื่อค้นหา เช่น 'asoke', 'PB-A12', 'สีลม'..."
            className="w-full h-11 rounded-lg border bg-background pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <ChevronDown className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />

          {open && (
            <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover text-popover-foreground shadow-lg max-h-96 overflow-auto">
              {acLoading ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-sm text-center text-muted-foreground">
                  ไม่พบทรัพย์สินตรงเงื่อนไข
                </div>
              ) : (
                <ul className="py-1">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickAsset(r.old_code)}
                        className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-3"
                      >
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted shrink-0">{r.old_code}</span>
                        <span className="flex-1 truncate">
                          <span className="text-sm font-medium">{r.name ?? "—"}</span>
                          <span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1">
                            <MapPin className="size-3" />{r.area ?? "—"}
                            <Building2 className="size-3 ml-1" />{r.department ?? "—"}
                          </span>
                        </span>
                        {r.status && <Badge tone="info">{r.status}</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Recent */}
        {recent.length > 0 && !selectedCode && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">ค้นล่าสุด:</span>
            {recent.map((code) => (
              <button
                key={code}
                onClick={() => pickAsset(code)}
                className="font-mono px-2 py-1 rounded-md border bg-background hover:bg-accent transition"
              >
                {code}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedCode && (
        <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          {detailLoading && !detail ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-32" />
            </div>
          ) : !asset ? (
            <div className="p-8 text-center text-muted-foreground text-sm">ไม่พบทรัพย์สิน {selectedCode}</div>
          ) : (
            <>
              <div className="p-5 border-b flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-2 py-1 rounded bg-muted">{asset.old_code}</span>
                    {asset.status && <Badge tone="info">{asset.status}</Badge>}
                  </div>
                  <h3 className="text-lg font-semibold mt-1">{asset.name ?? "—"}</h3>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                    <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{asset.area ?? "—"}</span>
                    <span className="inline-flex items-center gap-1"><Building2 className="size-3" />{asset.department ?? "—"}</span>
                  </div>
                </div>
                <button
                  onClick={handleResync}
                  disabled={detailLoading}
                  className="inline-flex items-center gap-2 text-sm h-9 px-3 rounded-lg border hover:bg-accent transition disabled:opacity-50"
                >
                  <RefreshCw className={cn("size-4", detailLoading && "animate-spin")} />
                  ดึงประวัติจาก PlanB ใหม่
                </button>
              </div>

              <div className="flex border-b overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition",
                      tab === t.id
                        ? "border-primary text-primary bg-primary/5"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {detail?.syncError && (
                  <div className="mb-3 text-xs text-destructive">ซิงค์อัตโนมัติไม่สำเร็จ: {detail.syncError}</div>
                )}
                {history.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center border rounded-lg">
                    ยังไม่มีประวัติประเภท {tab} สำหรับทรัพย์สินนี้
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="text-left px-4 py-2.5">วันที่เปิด</th>
                          <th className="text-left px-4 py-2.5">Ticket</th>
                          <th className="text-left px-4 py-2.5">รายการ</th>
                          <th className="text-left px-4 py-2.5">สถานะ</th>
                          <th className="text-left px-4 py-2.5">ปิดเมื่อ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {history.map((h) => (
                          <tr key={h.id} className="hover:bg-accent/30">
                            <td className="px-4 py-2.5 text-xs">{h.opened_at ? new Date(h.opened_at).toLocaleString("th-TH") : "—"}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">{h.ticket_code ?? "—"}</td>
                            <td className="px-4 py-2.5">{h.title ?? "—"}</td>
                            <td className="px-4 py-2.5"><Badge tone={h.status === "Finished" ? "success" : "warning"}>{h.status ?? "—"}</Badge></td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{h.closed_at ? new Date(h.closed_at).toLocaleString("th-TH") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {!selectedCode && (
        <div className="rounded-xl border bg-card/50 p-12 text-center text-sm text-muted-foreground">
          เริ่มต้นด้วยการพิมพ์ในช่องค้นหาด้านบน แล้วเลือกทรัพย์สินจากรายการ
        </div>
      )}
    </div>
  );
}
