import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { Wrench, AlertCircle, CheckCircle2, Search, Building2, Pencil, StickyNote, RefreshCw, MessageSquareText, ShieldAlert, Settings2 } from "lucide-react";
import { listClaims, upsertClaimNextStep } from "@/lib/data.functions";
import { useAuth } from "@/lib/auth-context";
import { isUrgentRisk } from "@/lib/risk-colors";
import { getCurrentAdsByCodes } from "@/lib/ad-contracts.functions";
import { syncClaimsNow } from "@/lib/admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  PROJECT_TO_DEPARTMENTS,
  projectForDepartment,
} from "@/lib/project-department-map";
import { RiskChip, useAssetRiskMap } from "@/components/asset-risk";
import { useMyRoles } from "@/hooks/use-my-roles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

// Bumped to v2 when the "Media Type" column was added, so returning users
// pick up newly added default columns instead of their stale saved set.
const COLUMN_STORAGE_KEY = "claims-visible-columns-v2";

const ALL_COLUMNS = [
  { key: "ticket", label: "Ticket", default: true },
  { key: "oldCode", label: "Old Code", default: true },
  { key: "department", label: "Department", default: true },
  { key: "mediaType", label: "Media Type", default: true },
  { key: "currentAd", label: "โฆษณาปัจจุบัน", default: true },
  { key: "symptom", label: "อาการ", default: true },
  { key: "assetStatus", label: "Asset Status", default: true },
  { key: "ticketStatus", label: "สถานะ Ticket", default: true },
  { key: "age", label: "อายุงาน", default: true },
  { key: "sla", label: "SLA", default: true },
  { key: "remark", label: "Remark Ticket", default: true },
  { key: "nextStep", label: "Next Step", default: true },
] as const;

type ColumnKey = (typeof ALL_COLUMNS)[number]["key"];

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
  const upsertFn = useServerFn(upsertClaimNextStep);
  const syncFn = useServerFn(syncClaimsNow);
  const qc = useQueryClient();
  const { session, loading: authLoading } = useAuth();
  const isAuthed = !!session?.access_token;
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["claims", "all"],
    queryFn: () => fn({ data: { sla: "all" as const } }),
    enabled: isAuthed,
  });
  const isClaimsLoading = isLoading || authLoading || !isAuthed;

  const syncMut = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: async () => {
      toast.success("Sync ข้อมูล Claim สำเร็จ");
      await qc.invalidateQueries({ queryKey: ["claims"] });
    },
    onError: async () => {
      // Not an admin (or sync unavailable) — refresh from database instead.
      await refetch();
      toast.info("รีเฟรชข้อมูลจากฐานข้อมูลแล้ว (Sync ต้องใช้สิทธิ์ผู้ดูแลระบบ)");
    },
  });

  const [editing, setEditing] = useState<{ ticket_code: string; note: string } | null>(null);
  const [draft, setDraft] = useState("");

  const saveMut = useMutation({
    mutationFn: (v: { ticket_code: string; note: string }) => upsertFn({ data: v }),
    onSuccess: () => {
      toast.success("บันทึก Next Step แล้ว");
      qc.invalidateQueries({ queryKey: ["claims"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message ?? "บันทึกไม่สำเร็จ"),
  });

  const [fProject, setFProject] = useState<string>("all");
  const [fSla, setFSla] = useState<string>("all");
  const [fOldCode, setFOldCode] = useState<string>("all");
  const [qTicket, setQTicket] = useState<string>("");
  const [fRisk, setFRisk] = useState<boolean>(false);
  const [fBrand, setFBrand] = useState<string>("all");
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ColumnKey[];
        const valid = parsed.filter((k) => ALL_COLUMNS.some((c) => c.key === k));
        if (valid.length > 0) return new Set(valid);
      }
    } catch {
      // ignore
    }
    return new Set(ALL_COLUMNS.filter((c) => c.default).map((c) => c.key));
  });

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(Array.from(visibleColumns)));
  }, [visibleColumns]);

  const { canSeeMaintenance } = useMyRoles();
  const { map: riskMap, counts: riskCounts } = useAssetRiskMap(canSeeMaintenance);

  const allClaims = data?.claims ?? [];
  const rawDepartments = data?.departments ?? [];
  const oldCodes = data?.oldCodes ?? [];

  // Current ad (from CRM) per claimed asset — so the team knows a repair sits
  // under a live campaign and how many days are left on the contract.
  const adsFn = useServerFn(getCurrentAdsByCodes);
  const claimCodes = useMemo(
    () => Array.from(new Set(allClaims.map((c) => c.asset_old_code).filter(Boolean) as string[])).slice(0, 3000),
    [allClaims],
  );
  const { data: adByCode } = useQuery({
    queryKey: ["claims-current-ads", claimCodes.length],
    queryFn: () => adsFn({ data: { codes: claimCodes } }),
    enabled: claimCodes.length > 0,
    staleTime: 5 * 60_000,
  });

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
      if (fSla !== "all" && (c.sla_status ?? "") !== fSla) return false;
      if (fOldCode !== "all" && (c.asset_old_code ?? "") !== fOldCode) return false;
      if (q && !(c.ticket_code ?? "").toLowerCase().includes(q)) return false;
      if (fRisk && !isUrgentRisk(riskMap.get(c.asset_old_code ?? "")?.level)) return false;
      if (fBrand !== "all") {
        const ad = adByCode?.[c.asset_old_code ?? ""];
        if ((ad?.brand ?? "") !== fBrand) return false;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClaims, fProject, fSla, fOldCode, qTicket, fRisk, riskMap, fBrand, adByCode]);

  // Brand options come from the CRM ads currently live on the claimed assets.
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of Object.values(adByCode ?? {})) if (v.brand) set.add(v.brand);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
  }, [adByCode]);

  const breached = claims.filter((c) => c.sla_status === "breached").length;
  const onTrack = claims.filter((c) => c.sla_status === "ontrack").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claim Aging"
        subtitle="Snapshot ตั๋วเคลมที่ยังเปิดอยู่ (1 Ticket = 1 แถว) Auto-Sync ทุก 15 นาที จาก /Ticket/RemainingClaimTickets"
        actions={
          <Button
            variant="outline"
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending || isFetching}
          >
            <RefreshCw className={"size-4 mr-2 " + (syncMut.isPending || isFetching ? "animate-spin" : "")} />
            {syncMut.isPending ? "กำลัง Sync..." : "Sync / รีเฟรช"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Claim ทั้งหมด" value={String(allClaims.length)} tone="warning" icon={<Wrench className="size-5" />} />
        <StatCard label="เกิน SLA" value={String(breached)} tone="danger" icon={<AlertCircle className="size-5" />} />
        <StatCard label="On Track" value={String(onTrack)} tone="success" icon={<CheckCircle2 className="size-5" />} />
      </div>

      {deptCounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {deptCounts.map(([dept, count]) => (
            <div
              key={dept}
              className="text-left rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Building2 className="size-3.5" />
                <span className="truncate">{dept}</span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
              <div className="text-[11px] text-muted-foreground">ตั๋วที่ยังไม่ปิด</div>
            </div>
          ))}
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
        <FilterSelect
          label="กลุ่มสื่อ (Project)"
          value={fProject}
          onChange={setFProject}
          options={Object.keys(PROJECT_TO_DEPARTMENTS)}
        />
        <FilterSelect
          label="SLA Status"
          value={fSla}
          onChange={setFSla}
          options={["ontrack", "atrisk", "breached"]}
        />
        <FilterSelect label="Old Code" value={fOldCode} onChange={setFOldCode} options={oldCodes} />
        {brandOptions.length > 0 && (
          <FilterSelect label="แบรนด์ (CRM)" value={fBrand} onChange={setFBrand} options={brandOptions} />
        )}
        {canSeeMaintenance && (
        <button
          type="button"
          onClick={() => setFRisk((v) => !v)}
          className={
            "h-9 inline-flex items-center gap-1.5 rounded-md border px-3 text-xs transition " +
            (fRisk
              ? "border-destructive bg-destructive/10 text-destructive"
              : "hover:bg-accent text-muted-foreground")
          }
          title="แสดงเฉพาะตั๋วของป้ายที่มีความเสี่ยงสูง"
        >
          <ShieldAlert className="size-3.5" />
          เฉพาะป้ายเสี่ยงสูง
          {riskCounts?.high ? <span className="tabular-nums">({riskCounts.high})</span> : null}
        </button>
        )}
        {(fRisk || fProject !== "all" || fSla !== "all" || fOldCode !== "all" || fBrand !== "all" || qTicket !== "") && (
          <button
            onClick={() => { setFProject("all"); setFSla("all"); setFOldCode("all"); setQTicket(""); setFRisk(false); setFBrand("all"); }}
            className="text-xs px-3 py-2 rounded-md border hover:bg-accent"
          >
            ล้างตัวกรอง
          </button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Settings2 className="size-3.5" />
              แสดง/ซ่อน Column
              <span className="text-[10px] tabular-nums text-muted-foreground ml-0.5">
                ({visibleColumns.size}/{ALL_COLUMNS.length})
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium">เลือก Column</span>
              <span className="text-[10px] text-muted-foreground">{visibleColumns.size} / {ALL_COLUMNS.length}</span>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {ALL_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer"
                >
                  <Checkbox
                    checked={visibleColumns.has(col.key)}
                    onCheckedChange={(checked) => {
                      setVisibleColumns((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(col.key);
                        else next.delete(col.key);
                        return next;
                      });
                    }}
                    aria-label={col.label}
                  />
                  <span className="flex-1 text-[13px]">{col.label}</span>
                </label>
              ))}
            </div>
            <Separator className="my-2" />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => setVisibleColumns(new Set(ALL_COLUMNS.map((c) => c.key)))}
              >
                แสดงทั้งหมด
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => setVisibleColumns(new Set())}
              >
                ซ่อนทั้งหมด
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        {isClaimsLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : claims.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">ยังไม่มี Claim ตามตัวกรองที่เลือก</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] table-auto">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {visibleColumns.has("ticket") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Ticket</th>}
                  {visibleColumns.has("oldCode") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Old Code</th>}
                  {visibleColumns.has("department") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Department</th>}
                  {visibleColumns.has("mediaType") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Media Type</th>}
                  {visibleColumns.has("currentAd") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">โฆษณาปัจจุบัน</th>}
                  {visibleColumns.has("symptom") && <th className="text-left font-medium px-4 py-3">อาการ</th>}
                  {visibleColumns.has("assetStatus") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Asset Status</th>}
                  {visibleColumns.has("ticketStatus") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">สถานะ Ticket</th>}
                  {visibleColumns.has("age") && <th className="text-right font-medium px-4 py-3 whitespace-nowrap">อายุงาน</th>}
                  {visibleColumns.has("sla") && <th className="text-left font-medium px-4 py-3 whitespace-nowrap">SLA</th>}
                  {visibleColumns.has("remark") && <th className="text-left font-medium px-4 py-3 w-[220px]">Remark Ticket</th>}
                  {visibleColumns.has("nextStep") && <th className="text-left font-medium px-4 py-3 w-[180px]">Next Step</th>}
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
                      {visibleColumns.has("ticket") && (
                        <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{c.ticket_code}</span>
                            {isDup && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                                ซ้ำ ×{c._dupCount}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {visibleColumns.has("oldCode") && (
                        <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span>{c.asset_old_code ?? "—"}</span>
                            {canSeeMaintenance && (() => {
                              const r = riskMap.get(c.asset_old_code ?? "");
                              return <RiskChip level={r?.level} score={r?.score} />;
                            })()}
                          </span>
                        </td>
                      )}
                      {visibleColumns.has("department") && <td className="px-4 py-3 whitespace-nowrap">{c.department ?? "—"}</td>}
                      {visibleColumns.has("mediaType") && <td className="px-4 py-3 whitespace-nowrap">{c.media_type ?? "—"}</td>}
                      {visibleColumns.has("currentAd") && (
                        <td className="px-4 py-3 max-w-[200px]">
                          {(() => {
                            const ad = adByCode?.[c.asset_old_code ?? ""];
                            if (!ad?.brand && !ad?.ad_contract)
                              return <span className="text-muted-foreground text-[12px]">ไม่มีโฆษณาขึ้น</span>;
                            const d = ad.days_to_end;
                            return (
                              <span className="inline-flex flex-col leading-tight">
                                <span className="truncate max-w-[180px] font-medium">
                                  {ad.brand ?? ad.ad_contract}
                                  {ad.brand_eng ? ` (${ad.brand_eng})` : ""}
                                </span>
                                {ad.brand && ad.ad_contract && (
                                  <span className="truncate max-w-[180px] text-[11px] text-muted-foreground">
                                    {ad.ad_contract}
                                  </span>
                                )}
                                <span
                                  className={
                                    "text-[11px] " +
                                    (d != null && d <= 30 ? "text-destructive font-medium" : "text-muted-foreground")
                                  }
                                >
                                  หมด {ad.end_date_contract ?? "—"}
                                  {d != null ? ` (${d} วัน)` : ""}
                                </span>
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      {visibleColumns.has("symptom") && (
                        <td className="px-4 py-3 max-w-[220px]">
                          <span className="line-clamp-2 leading-snug">{c.title ?? "—"}</span>
                        </td>
                      )}
                      {visibleColumns.has("assetStatus") && <td className="px-4 py-3 whitespace-nowrap">{c.asset_status ?? "—"}</td>}
                      {visibleColumns.has("ticketStatus") && <td className="px-4 py-3 whitespace-nowrap">{c.status ?? "—"}</td>}
                      {visibleColumns.has("age") && <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{ageDays != null ? `${ageDays} วัน` : "—"}</td>}
                      {visibleColumns.has("sla") && <td className="px-4 py-3 whitespace-nowrap"><Badge tone={tone}>{c.sla_status ?? "—"}</Badge></td>}
                      {visibleColumns.has("remark") && (
                        <td className="px-4 py-3 align-middle w-[220px] max-w-[220px]">
                          {c.remark_ticket ? (
                            <HoverCard openDelay={120} closeDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  className="flex w-full max-w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] leading-snug hover:bg-accent/50 transition"
                                  title="ดู Remark เต็ม"
                                >
                                  <MessageSquareText className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                                  <span className="line-clamp-2 min-w-0 flex-1">{c.remark_ticket}</span>
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent side="left" align="start" className="w-96 max-h-80 overflow-y-auto">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                                  <MessageSquareText className="size-3.5" />
                                  Remark Ticket
                                </div>
                                <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                  {c.remark_ticket}
                                </div>
                              </HoverCardContent>
                            </HoverCard>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {visibleColumns.has("nextStep") && (
                        <td className="px-4 py-3 align-middle w-[180px] max-w-[180px]">
                          {c.next_step ? (
                            <HoverCard openDelay={120} closeDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditing({ ticket_code: c.ticket_code ?? "", note: c.next_step ?? "" });
                                    setDraft(c.next_step ?? "");
                                  }}
                                  className="group flex w-full max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 pl-2.5 pr-2 py-1 text-[12px] text-foreground hover:border-primary/40 hover:bg-primary/10 transition"
                                  title="ดู/แก้ไข Next Step"
                                >
                                  <StickyNote className="size-3.5 shrink-0 text-primary" />
                                  <span className="truncate min-w-0 flex-1 text-left">{c.next_step}</span>
                                  <Pencil className="size-3 shrink-0 text-muted-foreground group-hover:text-primary transition" />
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent side="left" align="start" className="w-80">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-2">
                                  <StickyNote className="size-3.5" />
                                  Next Step
                                </div>
                                <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                  {c.next_step}
                                </div>
                                {(c.next_step_by || c.next_step_at) && (
                                  <div className="mt-3 pt-2 border-t text-[11px] text-muted-foreground">
                                    {c.next_step_by ?? "—"}
                                    {c.next_step_at ? ` · ${new Date(c.next_step_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}` : ""}
                                  </div>
                                )}
                              </HoverCardContent>
                            </HoverCard>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditing({ ticket_code: c.ticket_code ?? "", note: "" });
                                setDraft("");
                              }}
                              className="inline-flex size-7 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/60 hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition"
                              title="เพิ่ม Next Step"
                              aria-label="เพิ่ม Next Step"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>


      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Next Step — แผนติดตามงาน</DialogTitle>
            <DialogDescription>
              Ticket <span className="font-mono">{editing?.ticket_code}</span> — เขียนสั้นๆ ว่าจะดำเนินการอย่างไร เช่น "รออะไหล่เข้าวันที่ 20/07"
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="เช่น รออะไหล่ AC จาก supplier ETA 20/07, นัดเข้าหน้างานพรุ่งนี้ 09:00"
            className="min-h-[140px]"
            maxLength={2000}
          />
          <div className="text-[11px] text-muted-foreground text-right">{draft.length}/2000</div>
          <DialogFooter className="gap-2">
            {editing?.note && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => editing && saveMut.mutate({ ticket_code: editing.ticket_code, note: "" })}
                disabled={saveMut.isPending}
              >
                ลบ Next Step
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saveMut.isPending}>ยกเลิก</Button>
            <Button
              onClick={() => editing && saveMut.mutate({ ticket_code: editing.ticket_code, note: draft })}
              disabled={saveMut.isPending || !draft.trim()}
            >
              {saveMut.isPending ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
