import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FilterX, Layers3, Navigation, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import SearchableSelect from "@/components/searchable-select";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetRiskMap } from "@/components/asset-risk";
import { useMyRoles } from "@/hooks/use-my-roles";
import { projectForDepartment } from "@/lib/project-department-map";
import { RISK_LABELS, type RiskLevelName } from "@/lib/risk-colors";
import { listAssetHistoryCounts360, listOpenClaimCounts } from "@/lib/route-risk.functions";

export const Route = createFileRoute("/asset-risk-score")({
  head: () => ({
    meta: [
      { title: "Asset Risk Score — ตารางวางแผน PM" },
      { name: "description", content: "ตารางคะแนนความเสี่ยงรายป้าย พร้อมจำนวน Claim และ PM ย้อนหลัง 360 วัน" },
      { property: "og:title", content: "Asset Risk Score — ตารางวางแผน PM" },
      { property: "og:description", content: "กรองและจัดลำดับป้ายจากคะแนนความเสี่ยง ประวัติ Claim และ PM ย้อนหลัง 360 วัน" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssetRiskScorePage,
});

const LEVELS: RiskLevelName[] = ["critical", "high", "medium", "low"];
const PM_GAPS = [
  { value: "all", label: "ช่วงที่ไม่ได้ PM: ทั้งหมด" },
  { value: "30", label: "ไม่ได้ PM ≥ 30 วัน" },
  { value: "60", label: "ไม่ได้ PM ≥ 60 วัน" },
  { value: "90", label: "ไม่ได้ PM ≥ 90 วัน" },
  { value: "180", label: "ไม่ได้ PM ≥ 180 วัน" },
  { value: "none", label: "ไม่มีประวัติ PM" },
];

function unique(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, "th"));
}

function AssetRiskScorePage() {
  const { canSeeMaintenance, isLoading: rolesLoading } = useMyRoles();
  const { map, isLoading } = useAssetRiskMap(canSeeMaintenance);
  const openFn = useServerFn(listOpenClaimCounts);
  const historyFn = useServerFn(listAssetHistoryCounts360);
  const openQ = useQuery({
    queryKey: ["risk-open-claims"],
    queryFn: () => openFn(),
    staleTime: 5 * 60 * 1000,
    enabled: canSeeMaintenance,
  });
  const historyQ = useQuery({
    queryKey: ["asset-history-counts-360"],
    queryFn: () => historyFn(),
    staleTime: 10 * 60 * 1000,
    enabled: canSeeMaintenance,
  });

  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [department, setDepartment] = useState("all");
  const [mediaType, setMediaType] = useState("all");
  const [district, setDistrict] = useState("all");
  const [level, setLevel] = useState("all");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [pmGap, setPmGap] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState("score");
  const [grouping, setGrouping] = useState<"project" | "department">("project");

  const all = useMemo(() => Array.from(map.values()).map((risk) => ({
    ...risk,
    openClaims: openQ.data?.counts[risk.code] ?? risk.openClaims,
    claims360: historyQ.data?.counts[risk.code]?.claims ?? 0,
    pm360: historyQ.data?.counts[risk.code]?.pm ?? 0,
  })), [map, openQ.data, historyQ.data]);

  const projectOptions = useMemo(() => unique(all.map((row) => projectForDepartment(row.department))), [all]);
  const departmentOptions = useMemo(() => unique(all.filter((row) => project === "all" || projectForDepartment(row.department) === project).map((row) => row.department)), [all, project]);
  const mediaOptions = useMemo(() => unique(all.map((row) => row.mediaType)), [all]);
  const districtOptions = useMemo(() => unique(all.map((row) => row.district)), [all]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const minimum = minScore === "" ? null : Number(minScore);
    const maximum = maxScore === "" ? null : Number(maxScore);
    return all.filter((row) => {
      if (needle && !row.code.toLowerCase().includes(needle)) return false;
      if (project !== "all" && projectForDepartment(row.department) !== project) return false;
      if (department !== "all" && row.department !== department) return false;
      if (mediaType !== "all" && row.mediaType !== mediaType) return false;
      if (district !== "all" && row.district !== district) return false;
      if (level !== "all" && row.level !== level) return false;
      if (minimum != null && Number.isFinite(minimum) && row.score < minimum) return false;
      if (maximum != null && Number.isFinite(maximum) && row.score > maximum) return false;
      if (pmGap === "none" && row.daysSincePm != null) return false;
      if (pmGap !== "all" && pmGap !== "none" && (row.daysSincePm ?? -1) < Number(pmGap)) return false;
      if (openOnly && row.openClaims <= 0) return false;
      return true;
    });
  }, [all, query, project, department, mediaType, district, level, minScore, maxScore, pmGap, openOnly]);

  const rows = useMemo(() => [...filtered].sort((a, b) => {
    if (sort === "claims") return b.claims360 - a.claims360 || b.score - a.score;
    if (sort === "pm") return b.pm360 - a.pm360 || b.score - a.score;
    if (sort === "pm-gap") return (b.daysSincePm ?? -1) - (a.daysSincePm ?? -1) || b.score - a.score;
    if (sort === "open") return b.openClaims - a.openClaims || b.score - a.score;
    return b.score - a.score;
  }), [filtered, sort]);

  const totals = useMemo(() => Object.fromEntries(LEVELS.map((riskLevel) => [riskLevel, filtered.filter((row) => row.level === riskLevel).length])) as Record<RiskLevelName, number>, [filtered]);
  const groups = useMemo(() => {
    const result = new Map<string, Record<RiskLevelName | "total", number>>();
    for (const row of filtered) {
      const label = grouping === "project" ? projectForDepartment(row.department) ?? "ไม่ระบุ Project" : row.department ?? "ไม่ระบุ Department";
      const current = result.get(label) ?? { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
      current.total += 1;
      current[row.level] += 1;
      result.set(label, current);
    }
    return Array.from(result, ([label, values]) => ({ label, ...values })).sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total);
  }, [filtered, grouping]);

  const hasFilters = query !== "" || project !== "all" || department !== "all" || mediaType !== "all" || district !== "all" || level !== "all" || minScore !== "" || maxScore !== "" || pmGap !== "all" || openOnly;
  const clearFilters = () => {
    setQuery(""); setProject("all"); setDepartment("all"); setMediaType("all"); setDistrict("all");
    setLevel("all"); setMinScore(""); setMaxScore(""); setPmGap("all"); setOpenOnly(false);
  };

  const exportCsv = () => {
    const header = ["old_code", "project", "department", "media_type", "district", "risk_level", "score", "claims_360_days", "pm_360_days", "open_claims", "days_since_pm", "top_problem"];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((row) => [row.code, projectForDepartment(row.department), row.department, row.mediaType, row.district, RISK_LABELS[row.level], row.score, row.claims360, row.pm360, row.openClaims, row.daysSincePm, row.topProblem].map(escape).join(","));
    const url = URL.createObjectURL(new Blob(["\uFEFF" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `asset-risk-score-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };

  const sendToRoutePlan = () => {
    const codes = rows.slice(0, 300).map((row) => row.code);
    if (!codes.length) return;
    window.sessionStorage.setItem("ad_photo_route", JSON.stringify({ codes, label: "แผน PM จาก Asset Risk Score" }));
    toast.success(`ส่ง ${codes.length} ป้ายไปหน้า Route Monitoring แล้ว`);
    window.location.href = "/route-monitoring";
  };

  if (!rolesLoading && !canSeeMaintenance) return <div className="p-4 sm:p-6"><PageHeader title="Asset Risk Score" /><div className="rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground">บัญชีของคุณไม่มีสิทธิ์ดูข้อมูลงานซ่อมบำรุง</div></div>;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Asset Risk Score" subtitle="ตารางจัดลำดับงาน PM จากคะแนนความเสี่ยง พร้อมจำนวน Claim และ PM ที่เกิดขึ้นจริงย้อนหลัง 360 วัน" />

      <section className="rounded-lg border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold">ตัวกรองสำหรับวางแผน PM</div>
          <div className="text-xs text-muted-foreground">พบ {filtered.length.toLocaleString("th-TH")} ป้ายจากทั้งหมด {all.length.toLocaleString("th-TH")} ป้าย</div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={clearFilters} disabled={!hasFilters}><FilterX />ล้างตัวกรอง</Button>
            <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download />ดาวน์โหลด CSV</Button>
            <Button type="button" size="sm" onClick={sendToRoutePlan} disabled={!rows.length}><Navigation />สร้างแผนตรวจจากรายการนี้</Button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SearchableSelect value={project} onChange={(value) => { setProject(value); setDepartment("all"); }} options={projectOptions} allLabel="กลุ่มสื่อ: ทั้งหมด" title="กลุ่มสื่อ (Project)" />
          <SearchableSelect value={department} onChange={setDepartment} options={departmentOptions} allLabel="แผนก: ทั้งหมด" title="แผนก (Department)" />
          <SearchableSelect value={mediaType} onChange={setMediaType} options={mediaOptions} allLabel="Media Type: ทั้งหมด" title="Media Type" />
          <SearchableSelect value={district} onChange={setDistrict} options={districtOptions} allLabel="พื้นที่/เขต: ทั้งหมด" title="พื้นที่ (District)" />
          <select value={level} onChange={(event) => setLevel(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs" aria-label="ระดับความเสี่ยง"><option value="all">ระดับความเสี่ยง: ทั้งหมด</option>{LEVELS.map((riskLevel) => <option key={riskLevel} value={riskLevel}>{RISK_LABELS[riskLevel]}</option>)}</select>
          <div className="flex items-center gap-1.5"><Input value={minScore} onChange={(event) => setMinScore(event.target.value)} inputMode="numeric" placeholder="คะแนนต่ำสุด" className="h-9 text-xs" /><span className="text-muted-foreground">–</span><Input value={maxScore} onChange={(event) => setMaxScore(event.target.value)} inputMode="numeric" placeholder="สูงสุด" className="h-9 text-xs" /></div>
          <select value={pmGap} onChange={(event) => setPmGap(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs" aria-label="ช่วงเวลาที่ไม่ได้ PM">{PM_GAPS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <div className="flex gap-2"><select value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" aria-label="เรียงลำดับ"><option value="score">เรียง: คะแนนสูงสุด</option><option value="claims">เรียง: Claim 1 ปีมากสุด</option><option value="pm">เรียง: PM 1 ปีมากสุด</option><option value="pm-gap">เรียง: ไม่ได้ PM นานสุด</option><option value="open">เรียง: เคลมค้างมากสุด</option></select><label className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs" title="แสดงเฉพาะป้ายที่มีตั๋วค้างใน Claim Aging"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />เคลมค้าง</label></div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(250px,0.7fr)_minmax(0,2fr)]">
        <section className="rounded-lg border bg-card p-4 shadow-[var(--shadow-card)]"><div className="flex items-start justify-between"><div><div className="text-xs font-semibold uppercase text-muted-foreground">Filter Result Summary</div><div className="mt-2 text-4xl font-black tabular-nums text-primary">{filtered.length.toLocaleString("th-TH")}</div><div className="mt-1 text-sm text-muted-foreground">ป้ายที่ตรงตามตัวกรองปัจจุบัน</div></div><span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary"><Layers3 /></span></div><div className="mt-4 grid grid-cols-4 gap-2 border-t pt-3 text-center">{LEVELS.map((riskLevel) => <div key={riskLevel}><div className="font-bold tabular-nums">{totals[riskLevel]}</div><div className="text-[10px] text-muted-foreground">{RISK_LABELS[riskLevel]}</div></div>)}</div></section>
        <section className="rounded-lg border bg-card p-4 shadow-[var(--shadow-card)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase text-muted-foreground">Risk Breakdown by Category</div><div className="mt-1 text-sm font-bold">สรุปความเสี่ยงเพื่อจัดลำดับแผน PM</div></div><div className="inline-flex rounded-md border bg-muted/40 p-0.5"><Button type="button" size="sm" variant={grouping === "project" ? "default" : "ghost"} onClick={() => setGrouping("project")}>Project</Button><Button type="button" size="sm" variant={grouping === "department" ? "default" : "ghost"} onClick={() => setGrouping("department")}>Department</Button></div></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-xs"><thead className="border-b text-muted-foreground"><tr><th className="py-2 text-left">{grouping === "project" ? "Project" : "Department"}</th><th>วิกฤต</th><th>สูง</th><th>กลาง</th><th>ต่ำ</th><th className="text-right">รวม</th></tr></thead><tbody className="divide-y">{groups.slice(0, 8).map((group) => <tr key={group.label}><td className="py-2 font-medium">{group.label}</td><td className="text-center">{group.critical}</td><td className="text-center">{group.high}</td><td className="text-center">{group.medium}</td><td className="text-center">{group.low}</td><td className="text-right font-bold text-primary">{group.total}</td></tr>)}</tbody></table></div></section>
      </div>

      <section className="overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3"><div className="relative min-w-[240px] flex-1 md:max-w-md"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา Old Code…" className="pl-8" /></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldAlert className="size-4" />Claim/PM 1 ปี = จำนวนครั้งที่บันทึกในช่วง 360 วันที่ผ่านมา</div></div>
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full min-w-[1180px] text-xs">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground"><tr><th className="px-3 py-3 text-left">Old Code</th><th className="px-3 py-3 text-left">Project</th><th className="px-3 py-3 text-left">Department</th><th className="px-3 py-3 text-left">Media Type</th><th className="px-3 py-3 text-left">พื้นที่</th><th className="px-3 py-3 text-center">ระดับ</th><th className="px-3 py-3 text-right">คะแนน</th><th className="px-3 py-3 text-right" title="จำนวน Claim ในช่วง 360 วันที่ผ่านมา">Claim 1 ปี</th><th className="px-3 py-3 text-right" title="จำนวน PM ในช่วง 360 วันที่ผ่านมา">PM 1 ปี</th><th className="px-3 py-3 text-right">เคลมค้าง</th><th className="px-3 py-3 text-right">ไม่ได้ PM</th><th className="px-3 py-3 text-left">ปัญหาหลัก</th></tr></thead>
            <tbody className="divide-y">
              {isLoading || historyQ.isLoading ? Array.from({ length: 10 }).map((_, index) => <tr key={index}><td colSpan={12} className="p-2"><Skeleton className="h-8 w-full" /></td></tr>) : rows.length === 0 ? <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">ไม่พบป้ายตามเงื่อนไข</td></tr> : rows.map((row) => <tr key={row.code} className="hover:bg-accent/30"><td className="px-3 py-2.5 font-mono font-semibold">{row.code}</td><td className="px-3 py-2.5">{projectForDepartment(row.department) ?? "ไม่ระบุ"}</td><td className="px-3 py-2.5">{row.department ?? "ไม่ระบุ"}</td><td className="px-3 py-2.5">{row.mediaType ?? "ไม่ระบุ"}</td><td className="px-3 py-2.5">{row.district ?? "ไม่ระบุ"}</td><td className="px-3 py-2.5 text-center font-medium">{RISK_LABELS[row.level]}</td><td className="px-3 py-2.5 text-right font-bold tabular-nums">{row.score}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums">{row.claims360}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums">{row.pm360}</td><td className="px-3 py-2.5 text-right tabular-nums">{row.openClaims}</td><td className="px-3 py-2.5 text-right tabular-nums">{row.daysSincePm == null ? "ไม่มีข้อมูล" : `${row.daysSincePm} วัน`}</td><td className="max-w-[220px] truncate px-3 py-2.5" title={row.topProblem ?? ""}>{row.topProblem ?? "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}