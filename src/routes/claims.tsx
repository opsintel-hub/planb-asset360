import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { Wrench, Clock, AlertCircle } from "lucide-react";
import { listClaims } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/claims")({
  head: () => ({
    meta: [
      { title: "Claim Aging — Asset History 360" },
      { name: "description", content: "รายการ Claim ที่กำลังซ่อม พร้อม Aging และระดับความเร่งด่วน" },
    ],
  }),
  component: ClaimsPage,
});

function ClaimsPage() {
  const fn = useServerFn(listClaims);
  const { data, isLoading } = useQuery({
    queryKey: ["claims", "all"],
    queryFn: () => fn({ data: { sla: "all" as const } }),
  });

  const [fDept, setFDept] = useState<string>("all");
  const [fSla, setFSla] = useState<string>("all");
  const [fOldCode, setFOldCode] = useState<string>("all");

  const allClaims = data?.claims ?? [];
  const departments = data?.departments ?? [];
  const oldCodes = data?.oldCodes ?? [];

  const claims = useMemo(() => {
    const filtered = allClaims.filter((c) => {
      if (fDept !== "all" && (c.department ?? "") !== fDept) return false;
      if (fSla !== "all" && (c.sla_status ?? "") !== fSla) return false;
      if (fOldCode !== "all" && (c.asset_old_code ?? "") !== fOldCode) return false;
      return true;
    });
    // Count by ticket_code to detect duplicates
    const counts = new Map<string, number>();
    for (const c of filtered) {
      const k = c.ticket_code ?? "";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // Sort: duplicates first (by count desc), then by ticket_code asc, then age_hours desc
    return [...filtered]
      .map((c) => ({ ...c, _dupCount: counts.get(c.ticket_code ?? "") ?? 1 }))
      .sort((a, b) => {
        const dupA = a._dupCount > 1 ? 1 : 0;
        const dupB = b._dupCount > 1 ? 1 : 0;
        if (dupA !== dupB) return dupB - dupA;
        const tA = a.ticket_code ?? "";
        const tB = b.ticket_code ?? "";
        if (tA !== tB) return tA.localeCompare(tB);
        return (Number(b.age_hours) || 0) - (Number(a.age_hours) || 0);
      });
  }, [allClaims, fDept, fSla, fOldCode]);

  const breached = claims.filter((c) => c.sla_status === "breached").length;
  const avgAge = claims.length ? claims.reduce((s, c) => s + (Number(c.age_hours) || 0), 0) / claims.length : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Claim Aging" subtitle="Snapshot ตั๋วเคลมที่ยังเปิดอยู่ (1 Ticket = 1 แถว) Auto-Sync ทุก 15 นาที จาก /Ticket/RemainingClaimTickets" />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Claim ทั้งหมด" value={String(claims.length)} tone="warning" icon={<Wrench className="size-5" />} />
        <StatCard label="เกิน SLA" value={String(breached)} tone="danger" icon={<AlertCircle className="size-5" />} />
        <StatCard label="อายุงานเฉลี่ย" value={`${(avgAge / 24).toFixed(1)} วัน`} tone="default" icon={<Clock className="size-5" />} />
        <StatCard label="On Track" value={String(claims.filter((c) => c.sla_status === "ontrack").length)} tone="success" icon={<Clock className="size-5" />} />
      </div>

      <div className="flex flex-wrap gap-3 items-end rounded-xl border bg-card p-4">
        <FilterSelect label="Department" value={fDept} onChange={setFDept} options={departments} />
        <FilterSelect
          label="SLA Status"
          value={fSla}
          onChange={setFSla}
          options={["ontrack", "atrisk", "breached"]}
        />
        <FilterSelect label="Old Code" value={fOldCode} onChange={setFOldCode} options={oldCodes} />
        {(fDept !== "all" || fSla !== "all" || fOldCode !== "all") && (
          <button
            onClick={() => { setFDept("all"); setFSla("all"); setFOldCode("all"); }}
            className="text-xs px-3 py-2 rounded-md border hover:bg-accent"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : claims.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">ยังไม่มี Claim ตามตัวกรองที่เลือก</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Ticket</th>
                  <th className="text-left px-4 py-3">Old Code</th>
                  <th className="text-left px-4 py-3">Department</th>
                  <th className="text-left px-4 py-3">อาการ</th>
                  <th className="text-left px-4 py-3">สถานะงานที่ป้าย</th>
                  <th className="text-left px-4 py-3">สถานะตั๋ว</th>
                  <th className="text-left px-4 py-3">Severity</th>
                  <th className="text-left px-4 py-3">อายุงาน</th>
                  <th className="text-left px-4 py-3">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {claims.map((c) => {
                  const tone = c.sla_status === "breached" ? "danger" : c.sla_status === "atrisk" ? "warning" : "success";
                  const isDup = c._dupCount > 1;
                  return (
                    <tr key={c.id} className={isDup ? "bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-950/50" : "hover:bg-accent/30"}>
                      <td className="px-4 py-3 font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <span>{c.ticket_code}</span>
                          {isDup && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                              ซ้ำ ×{c._dupCount}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{c.asset_old_code ?? "—"}</td>
                      <td className="px-4 py-3">{c.department ?? "—"}</td>
                      <td className="px-4 py-3">{c.title ?? "—"}</td>
                      <td className="px-4 py-3">{c.asset_status ?? "—"}</td>
                      <td className="px-4 py-3">{c.status ?? "—"}</td>
                      <td className="px-4 py-3">{c.severity ?? "—"}</td>
                      <td className="px-4 py-3">{c.age_hours ? `${(Number(c.age_hours) / 24).toFixed(1)} วัน` : "—"}</td>
                      <td className="px-4 py-3"><Badge tone={tone}>{c.sla_status ?? "—"}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
    <div className="flex flex-col gap-1 min-w-[180px]">
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
