import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Filter, Download } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { searchAssets } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";

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

function SearchPage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabId>("PM");
  const fn = useServerFn(searchAssets);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["search", q, tab],
    queryFn: () => fn({ data: { q, tab, limit: 50 } }),
  });

  const assets = data?.assets ?? [];
  const history = data?.history ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="ค้นหาประวัติป้ายโฆษณา"
        subtitle="ค้นหาจาก Old Code, ชื่อ หรือพื้นที่ติดตั้ง"
        actions={
          <button className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90 transition">
            <Download className="size-4" /> Export
          </button>
        }
      />

      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-4">
        <form
          onSubmit={(e) => { e.preventDefault(); refetch(); }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Old Code, ชื่อ หรือพื้นที่ เช่น PB-A12048 / Asoke"
              className="w-full h-10 rounded-lg border bg-background pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button type="submit" className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">
            ค้นหา
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Filter className="size-4" /> ค้นจากตาราง assets ทั้งหมด · พบ {assets.length} ทรัพย์สิน · ประวัติ {history.length} รายการ
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition",
                tab === t.id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-6">
          {/* Assets */}
          <div>
            <h4 className="font-semibold text-sm mb-3">ทรัพย์สินที่พบ</h4>
            {isLoading || isFetching ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : assets.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg">ไม่พบทรัพย์สินตามเงื่อนไข</div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5">Old Code</th>
                      <th className="text-left px-4 py-2.5">ชื่อ</th>
                      <th className="text-left px-4 py-2.5">Department</th>
                      <th className="text-left px-4 py-2.5">Area</th>
                      <th className="text-left px-4 py-2.5">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {assets.map((a) => (
                      <tr key={a.id} className="hover:bg-accent/30">
                        <td className="px-4 py-2.5 font-mono text-xs">{a.old_code}</td>
                        <td className="px-4 py-2.5 font-medium">{a.name ?? "—"}</td>
                        <td className="px-4 py-2.5">{a.department ?? "—"}</td>
                        <td className="px-4 py-2.5">{a.area ?? "—"}</td>
                        <td className="px-4 py-2.5"><Badge tone="info">{a.status ?? "—"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* History */}
          <div>
            <h4 className="font-semibold text-sm mb-3">ประวัติ {tab}</h4>
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg">ยังไม่มีประวัติประเภทนี้</div>
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
        </div>
      </div>
    </div>
  );
}
