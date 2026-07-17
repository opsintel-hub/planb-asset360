import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { Wrench, AlertCircle, CheckCircle2, Search, Building2 } from "lucide-react";
import { listClaims } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PROJECT_TO_DEPARTMENTS,
  departmentsForProjects,
  projectForDepartment,
} from "@/lib/project-department-map";
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

  const [fProject, setFProject] = useState<string>("all");
  const [fDept, setFDept] = useState<string>("all");
  const [fSla, setFSla] = useState<string>("all");
  const [fOldCode, setFOldCode] = useState<string>("all");
  const [qTicket, setQTicket] = useState<string>("");

  const allClaims = data?.claims ?? [];
  const rawDepartments = data?.departments ?? [];
  const oldCodes = data?.oldCodes ?? [];

  // Cascade: department options depend on selected project
  const departments = useMemo(() => {
    if (fProject === "all") return rawDepartments;
    const allowed = departmentsForProjects([fProject]);
    return rawDepartments.filter((d) => allowed.has(d));
  }, [rawDepartments, fProject]);

  // Auto-clear department when it no longer belongs to the selected project
  useEffect(() => {
    if (fDept !== "all" && !departments.includes(fDept)) setFDept("all");
  }, [departments, fDept]);

  const inProject = (dept: string | null | undefined) =>
    fProject === "all" || projectForDepartment(dept) === fProject;

  // Count claims per department across ALL open tickets (respects Project filter)
  const deptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allClaims) {
      if (!inProject(c.department)) continue;
      const k = c.department ?? "ไม่ระบุ";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClaims, fProject]);

  const claims = useMemo(() => {
    const q = qTicket.trim().toLowerCase();
    const filtered = allClaims.filter((c) => {
      if (!inProject(c.department)) return false;
      if (fDept !== "all" && (c.department ?? "") !== fDept) return false;
      if (fSla !== "all" && (c.sla_status ?? "") !== fSla) return false;
      if (fOldCode !== "all" && (c.asset_old_code ?? "") !== fOldCode) return false;
      if (q && !(c.ticket_code ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    // Count by asset_old_code to detect duplicate tickets on the same asset
    const counts = new Map<string, number>();
    for (const c of filtered) {
      const k = c.asset_old_code ?? "";
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ageOf = (c: typeof filtered[number]) =>
      c.total_time != null
        ? Number(c.total_time)
        : c.age_hours != null
          ? Number(c.age_hours) / 24
          : 0;
    // Sort: duplicate-old-code first, then age desc
    return [...filtered]
      .map((c) => ({ ...c, _dupCount: counts.get(c.asset_old_code ?? "") ?? 1 }))
      .sort((a, b) => {
        const dupA = a._dupCount > 1 ? 1 : 0;
        const dupB = b._dupCount > 1 ? 1 : 0;
        if (dupA !== dupB) return dupB - dupA;
        if (dupA === 1) {
          // keep duplicates of the same old_code grouped together
          const oa = a.asset_old_code ?? "";
          const ob = b.asset_old_code ?? "";
          if (oa !== ob) return oa.localeCompare(ob);
        }
        return ageOf(b) - ageOf(a);
      });
  }, [allClaims, fDept, fSla, fOldCode, qTicket]);

  const breached = claims.filter((c) => c.sla_status === "breached").length;
  const onTrack = claims.filter((c) => c.sla_status === "ontrack").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Claim Aging" subtitle="Snapshot ตั๋วเคลมที่ยังเปิดอยู่ (1 Ticket = 1 แถว) Auto-Sync ทุก 15 นาที จาก /Ticket/RemainingClaimTickets" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Claim ทั้งหมด" value={String(allClaims.length)} tone="warning" icon={<Wrench className="size-5" />} />
        <StatCard label="เกิน SLA" value={String(breached)} tone="danger" icon={<AlertCircle className="size-5" />} />
        <StatCard label="On Track" value={String(onTrack)} tone="success" icon={<CheckCircle2 className="size-5" />} />
      </div>

      {deptCounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {deptCounts.map(([dept, count]) => {
            const active = fDept === dept;
            return (
              <button
                key={dept}
                onClick={() => setFDept(active ? "all" : dept)}
                className={
                  "text-left rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] transition hover:border-primary/50 " +
                  (active ? "border-primary ring-1 ring-primary" : "")
                }
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="size-3.5" />
                  <span className="truncate">{dept}</span>
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
                <div className="text-[11px] text-muted-foreground">ตั๋วที่ยังไม่ปิด</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-1 min-w-[220px] flex-1">
          <label className="text-xs text-muted-foreground">ค้นหา Ticket Number</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={qTicket}
              onChange={(e) => setQTicket(e.target.value)}
              placeholder="เช่น BB202606000290"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <FilterSelect label="Department" value={fDept} onChange={setFDept} options={departments} />
        <FilterSelect
          label="SLA Status"
          value={fSla}
          onChange={setFSla}
          options={["ontrack", "atrisk", "breached"]}
        />
        <FilterSelect label="Old Code" value={fOldCode} onChange={setFOldCode} options={oldCodes} />
        {(fDept !== "all" || fSla !== "all" || fOldCode !== "all" || qTicket !== "") && (
          <button
            onClick={() => { setFDept("all"); setFSla("all"); setFOldCode("all"); setQTicket(""); }}
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
            <table className="w-full text-sm table-auto">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Ticket</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Old Code</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Department</th>
                  <th className="text-left px-4 py-3">อาการ</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">ASSET STATUS</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">สถานะ(TICKET)</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">อายุงาน</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {claims.map((c) => {
                  const tone = c.sla_status === "breached" ? "danger" : c.sla_status === "atrisk" ? "warning" : "success";
                  const isDup = c._dupCount > 1;
                  const ageDays = c.total_time != null
                    ? Number(c.total_time)
                    : c.age_hours != null
                      ? Number(c.age_hours) / 24
                      : null;
                  return (
                    <tr key={c.id} className={isDup ? "bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-950/50" : "hover:bg-accent/30"}>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{c.ticket_code}</span>
                          {isDup && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                              ซ้ำ ×{c._dupCount}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{c.asset_old_code ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.department ?? "—"}</td>
                      <td className="px-4 py-3">{c.title ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.asset_status ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.status ?? "—"}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{ageDays != null ? `${ageDays} วัน` : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><Badge tone={tone}>{c.sla_status ?? "—"}</Badge></td>
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
