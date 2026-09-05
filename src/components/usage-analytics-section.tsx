// Admin-only "Usage Analytics" dashboard (Settings ▸ Usage Analytics).
// All numbers come from public.user_activity_events, aggregated in Postgres.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Timer,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { StatCard, Badge } from "@/components/ui-bits";
import { useMyRoles } from "@/hooks/use-my-roles";
import {
  getUsageAnalytics,
  getUserUsageDetail,
  type UsageAnalytics,
  type UsageRow,
} from "@/lib/usage-analytics.functions";

const DOW_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const PIE_COLORS = [
  "hsl(var(--chart-1, 217 91% 60%))",
  "oklch(0.72 0.15 160)",
  "oklch(0.75 0.16 75)",
  "oklch(0.62 0.2 25)",
  "oklch(0.65 0.15 300)",
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDateTime(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}
function fmtMinutes(m: number | null | undefined) {
  const v = Number(m ?? 0);
  if (!v) return "0 น.";
  if (v < 60) return `${v.toFixed(0)} น.`;
  return `${Math.floor(v / 60)} ชม. ${Math.round(v % 60)} น.`;
}

const TABLE_HEADERS: { key: keyof UsageRow; label: string }[] = [
  { key: "name", label: "ผู้ใช้" },
  { key: "email", label: "อีเมล" },
  { key: "department", label: "หน่วยงาน" },
  { key: "lastLogin", label: "ล็อกอินล่าสุด" },
  { key: "loginCount", label: "จำนวนล็อกอิน" },
  { key: "sessions", label: "เซสชัน" },
  { key: "totalMinutes", label: "เวลารวม" },
  { key: "avgSessionMinutes", label: "เฉลี่ย/เซสชัน" },
  { key: "pagesVisited", label: "หน้าที่เข้าชม" },
  { key: "topFeature", label: "ฟีเจอร์ที่ใช้มากสุด" },
  { key: "lastActivity", label: "ใช้งานล่าสุด" },
];

export function UsageAnalyticsSection() {
  const { hasRole, isLoading: rolesLoading } = useMyRoles();
  const isAdmin = hasRole("admin");

  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [userId, setUserId] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [device, setDevice] = useState("");
  const [platform, setPlatform] = useState("");
  const [browser, setBrowser] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<keyof UsageRow>("lastActivity");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [openUser, setOpenUser] = useState<UsageRow | null>(null);
  const pageSize = 20;

  const fn = useServerFn(getUsageAnalytics);
  const filters = { from, to, userId, department, role, device, platform, browser };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["usage-analytics", filters],
    enabled: isAdmin,
    staleTime: 60_000,
    queryFn: () =>
      fn({
        data: {
          from: new Date(`${from}T00:00:00`).toISOString(),
          to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString(),
          userId: userId || null,
          department: department || null,
          role: role || null,
          device: device || null,
          platform: platform || null,
          browser: browser || null,
        },
      }) as Promise<UsageAnalytics>,
  });

  const rows = useMemo(() => {
    const list = (data?.table ?? []).filter((r) => {
      if (!q.trim()) return true;
      const s = q.trim().toLowerCase();
      return [r.name, r.email, r.department, r.topFeature]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
  }, [data?.table, q, sortKey, sortDesc]);

  const paged = rows.slice(page * pageSize, page * pageSize + pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  const exportRows = () =>
    rows.map((r) => ({
      "ผู้ใช้": r.name,
      "อีเมล": r.email ?? "",
      "หน่วยงาน": r.department,
      "ล็อกอินล่าสุด": fmtDateTime(r.lastLogin),
      "จำนวนล็อกอิน": r.loginCount,
      "เซสชัน": r.sessions,
      "เวลารวม (นาที)": r.totalMinutes,
      "เฉลี่ย/เซสชัน (นาที)": r.avgSessionMinutes,
      "หน้าที่เข้าชม": r.pagesVisited,
      "ฟีเจอร์ที่ใช้มากสุด": r.topFeature ?? "",
      "ใช้งานล่าสุด": fmtDateTime(r.lastActivity),
    }));

  const exportCsv = () => {
    const list = exportRows();
    if (!list.length) return;
    const head = Object.keys(list[0]!);
    const body = list.map((r) =>
      head.map((h) => `"${String((r as Record<string, unknown>)[h] ?? "").replace(/"/g, '""')}"`).join(","),
    );
    const blob = new Blob(["\uFEFF" + [head.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `usage-analytics-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportExcel = async () => {
    const list = exportRows();
    if (!list.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(list);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Usage");
    XLSX.writeFile(wb, `usage-analytics-${from}_${to}.xlsx`);
  };

  const resetFilters = () => {
    setFrom(isoDaysAgo(30));
    setTo(todayIso());
    setUserId("");
    setDepartment("");
    setRole("");
    setDevice("");
    setPlatform("");
    setBrowser("");
    setQ("");
    setPage(0);
  };

  if (rolesLoading) {
    return (
      <div className="rounded-xl border bg-card p-8 grid place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-xl border bg-card p-6 flex items-start gap-3">
        <ShieldAlert className="size-5 text-destructive shrink-0" />
        <div className="text-sm">
          <div className="font-semibold">เฉพาะผู้ดูแลระบบ</div>
          <div className="text-muted-foreground mt-1">
            หน้านี้แสดงสถิติการใช้งานของผู้ใช้ทุกคน จึงเปิดให้เฉพาะบทบาท admin
          </div>
        </div>
      </div>
    );
  }

  const k = data?.kpis;
  const a = data?.analytics;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-semibold flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" /> ตัวกรอง
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-accent"
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} /> รีเฟรช
            </button>
            <button
              onClick={resetFilters}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-accent"
            >
              ล้างตัวกรอง
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">ตั้งแต่วันที่</span>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(0); }}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">ถึงวันที่</span>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(0); }}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <FilterSelect
            label="ผู้ใช้"
            value={userId}
            onChange={setUserId}
            options={(data?.options.users ?? []).map((u) => ({
              value: u.id,
              label: u.name ?? u.id.slice(0, 8),
            }))}
          />
          <FilterSelect
            label="หน่วยงาน"
            value={department}
            onChange={setDepartment}
            options={(data?.options.departments ?? []).map((d) => ({ value: d, label: d }))}
          />
          <FilterSelect
            label="บทบาท"
            value={role}
            onChange={setRole}
            options={(data?.options.roles ?? []).map((r) => ({ value: r, label: r }))}
          />
          <FilterSelect
            label="ชนิดอุปกรณ์"
            value={device}
            onChange={setDevice}
            options={(data?.options.devices ?? []).map((d) => ({ value: d, label: d }))}
          />
          <FilterSelect
            label="แพลตฟอร์ม"
            value={platform}
            onChange={setPlatform}
            options={(data?.options.platforms ?? []).map((p) => ({ value: p, label: p }))}
          />
          <FilterSelect
            label="เบราว์เซอร์"
            value={browser}
            onChange={setBrowser}
            options={(data?.options.browsers ?? []).map((b) => ({ value: b, label: b }))}
          />
        </div>
      </div>

      {isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">โหลดสถิติไม่สำเร็จ</div>
            <div className="text-muted-foreground">{(error as Error)?.message}</div>
          </div>
        </div>
      ) : null}

      {/* KPIs */}
      {isLoading ? (
        <SkeletonGrid />
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="ผู้ใช้ทั้งหมด" value={k?.totalUsers ?? 0} icon={<Users className="size-4" />} />
          <StatCard label="ใช้งานวันนี้" value={k?.activeToday ?? 0} tone="success" icon={<Activity className="size-4" />} />
          <StatCard label="ใช้งาน 7 วัน" value={k?.activeWeek ?? 0} tone="success" icon={<UserCheck className="size-4" />} />
          <StatCard label="ใช้งาน 30 วัน" value={k?.activeMonth ?? 0} icon={<UserCheck className="size-4" />} />
          <StatCard label="เซสชันรวม" value={k?.totalSessions ?? 0} icon={<Clock className="size-4" />} />
          <StatCard
            label="เวลาเฉลี่ย/เซสชัน"
            value={fmtMinutes(k?.avgSessionMinutes)}
            icon={<Timer className="size-4" />}
          />
        </div>
      )}

      {/* Analytics summary */}
      <div className="rounded-xl border bg-card p-4">
        <div className="font-semibold mb-3">ตัวชี้วัดการใช้งาน</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
          <Metric label="DAU" value={a?.dau ?? 0} />
          <Metric label="WAU" value={a?.wau ?? 0} />
          <Metric label="MAU" value={a?.mau ?? 0} />
          <Metric label="Retention (สัปดาห์)" value={`${a?.retentionRate ?? 0}%`} />
          <Metric label="เวลาเฉลี่ย/เซสชัน" value={fmtMinutes(a?.avgSessionMinutes)} />
          <Metric label="เข้าใช้เฉลี่ย/คน" value={a?.avgVisitsPerUser ?? 0} />
          <Metric label="Bounce Rate" value={`${a?.bounceRate ?? 0}%`} />
          <Metric label="ผู้ใช้เดิมที่กลับมา" value={a?.returningUsers ?? 0} />
          <Metric label="ผู้ใช้ใหม่" value={a?.newUsers ?? 0} />
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="ผู้ใช้งานรายวัน (DAU)" empty={!data?.daily.length}>
          <LineChart data={data?.daily ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="day" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="users" name="ผู้ใช้" stroke="var(--primary)" strokeWidth={2} />
          </LineChart>
        </ChartCard>

        <ChartCard title="การใช้งานตามช่วงเวลา (ราย ชม.)" empty={!data?.hourly.length}>
          <BarChart data={data?.hourly ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="hour" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="events" name="เหตุการณ์" fill="var(--primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="แนวโน้มรายสัปดาห์" empty={!data?.weekly.length}>
          <LineChart data={data?.weekly ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="week" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="users" name="ผู้ใช้" stroke="var(--primary)" strokeWidth={2} />
            <Line type="monotone" dataKey="events" name="เหตุการณ์" stroke="oklch(0.72 0.15 160)" strokeWidth={2} />
          </LineChart>
        </ChartCard>

        <ChartCard title="แนวโน้มรายเดือน" empty={!data?.monthly.length}>
          <BarChart data={data?.monthly ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="users" name="ผู้ใช้" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="events" name="เหตุการณ์" fill="oklch(0.75 0.16 75)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="10 ผู้ใช้ที่ใช้งานมากสุด" empty={!data?.topUsers.length}>
          <BarChart data={data?.topUsers ?? []} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis type="number" fontSize={11} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={110} fontSize={11} />
            <Tooltip />
            <Bar dataKey="events" name="เหตุการณ์" fill="var(--primary)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="การใช้งานตามหน่วยงาน" empty={!data?.byDepartment.length}>
          <BarChart data={data?.byDepartment ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="department" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="users" name="ผู้ใช้" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="events" name="เหตุการณ์" fill="oklch(0.65 0.15 300)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <div className="rounded-xl border bg-card p-4">
          <div className="font-semibold mb-3">ช่วงเวลาที่ใช้งานหนาแน่น (Heatmap)</div>
          <Heatmap data={data?.heatmap ?? []} loading={isLoading} />
        </div>

        <ChartCard title="สัดส่วนอุปกรณ์" empty={!data?.devices.length}>
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie data={data?.devices ?? []} dataKey="value" nameKey="name" outerRadius={90} label>
              {(data?.devices ?? []).map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartCard>
      </div>

      {/* Alerts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <AlertCard
          title="ล็อกอินผิดปกติ"
          hint="ล็อกอินไม่สำเร็จ ≥ 5 ครั้งในวันเดียว"
          items={(data?.alerts.unusualLogins ?? []).map((x) => `${x.name} · ${x.day} · ${x.failed} ครั้ง`)}
          tone="danger"
        />
        <AlertCard
          title="ไม่ได้ใช้งานเกิน 30 วัน"
          hint="ควรตรวจสอบสิทธิ์การเข้าถึง"
          items={(data?.alerts.inactiveUsers ?? []).map(
            (x) => `${x.name ?? "ไม่ระบุชื่อ"} · ${x.lastActivity ? fmtDateTime(x.lastActivity) : "ยังไม่เคยใช้งาน"}`,
          )}
          tone="warning"
        />
        <AlertCard
          title="ใช้งานหนักผิดปกติ"
          hint="เวลาใช้งานรวมเกิน 10 ชั่วโมงในช่วงที่เลือก"
          items={(data?.alerts.heavyUsers ?? []).map((x) => `${x.name} · ${fmtMinutes(x.minutes)}`)}
          tone="info"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b">
          <div className="font-semibold">กิจกรรมผู้ใช้ ({rows.length})</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
                placeholder="ค้นหาชื่อ/อีเมล/หน่วยงาน"
                className="rounded-lg border bg-background pl-8 pr-3 py-1.5 text-sm w-56"
              />
            </div>
            <button
              onClick={exportCsv}
              disabled={!rows.length}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              <Download className="size-3.5" /> CSV
            </button>
            <button
              onClick={exportExcel}
              disabled={!rows.length}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              <FileSpreadsheet className="size-3.5" /> Excel
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !rows.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            ยังไม่มีข้อมูลการใช้งานในช่วงที่เลือก — ระบบเริ่มเก็บสถิติตั้งแต่วันนี้ ข้อมูลจะเพิ่มขึ้นเมื่อมีการใช้งาน
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    {TABLE_HEADERS.map((h) => (
                      <th
                        key={h.key}
                        onClick={() => {
                          if (sortKey === h.key) setSortDesc((v) => !v);
                          else { setSortKey(h.key); setSortDesc(true); }
                        }}
                        className="px-3 py-2 text-left whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                      >
                        {h.label}
                        {sortKey === h.key ? (sortDesc ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr
                      key={r.userId ?? r.name}
                      onClick={() => setOpenUser(r)}
                      className="border-t hover:bg-accent/50 cursor-pointer"
                    >
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.email ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.department}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.lastLogin)}</td>
                      <td className="px-3 py-2 tabular-nums">{r.loginCount}</td>
                      <td className="px-3 py-2 tabular-nums">{r.sessions}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtMinutes(r.totalMinutes)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtMinutes(r.avgSessionMinutes)}</td>
                      <td className="px-3 py-2 tabular-nums">{r.pagesVisited}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.topFeature ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.lastActivity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 flex items-center justify-between text-xs text-muted-foreground border-t">
              <span>
                หน้า {page + 1} / {pageCount}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-md border px-2.5 py-1 hover:bg-accent disabled:opacity-40"
                >
                  ก่อนหน้า
                </button>
                <button
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-md border px-2.5 py-1 hover:bg-accent disabled:opacity-40"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {openUser?.userId ? (
        <UserDetailPanel
          row={openUser}
          from={new Date(`${from}T00:00:00`).toISOString()}
          to={new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString()}
          onClose={() => setOpenUser(null)}
        />
      ) : null}
    </div>
  );
}

/* ---------------- Small building blocks ---------------- */

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-xs space-y-1">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
      >
        <option value="">ทั้งหมด</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: boolean;
  children: React.ReactElement;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="font-semibold mb-3">{title}</div>
      {empty ? (
        <div className="h-[240px] grid place-items-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูลในช่วงที่เลือก
        </div>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Heatmap({
  data,
  loading,
}: {
  data: { dow: number; hour: number; events: number }[];
  loading: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.events));
  const get = (dow: number, hour: number) =>
    data.find((d) => d.dow === dow && d.hour === hour)?.events ?? 0;

  if (loading) {
    return (
      <div className="h-[240px] grid place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!data.length) {
    return (
      <div className="h-[240px] grid place-items-center text-sm text-muted-foreground">
        ยังไม่มีข้อมูลในช่วงที่เลือก
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px] space-y-1">
        <div className="grid grid-cols-[28px_repeat(24,1fr)] gap-[2px] text-[9px] text-muted-foreground">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center">
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
        </div>
        {DOW_LABELS.map((label, dow) => (
          <div key={dow} className="grid grid-cols-[28px_repeat(24,1fr)] gap-[2px] items-center">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const v = get(dow, h);
              return (
                <div
                  key={h}
                  title={`${label} ${h}:00 — ${v} เหตุการณ์`}
                  className="h-4 rounded-[3px] bg-primary"
                  style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 0.06 }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertCard({
  title,
  hint,
  items,
  tone,
}: {
  title: string;
  hint: string;
  items: string[];
  tone: "danger" | "warning" | "info";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle
          className={cn(
            "size-4",
            tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-primary",
          )}
        />
        <div className="font-semibold">{title}</div>
        <Badge tone={tone === "info" ? "info" : tone}>{items.length}</Badge>
      </div>
      <div className="text-xs text-muted-foreground mb-2">{hint}</div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">ไม่พบรายการ</div>
      ) : (
        <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
          {items.slice(0, 30).map((t, i) => (
            <li key={i} className="rounded-md bg-muted/50 px-2 py-1">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="mt-3 h-7 w-16 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function UserDetailPanel({
  row,
  from,
  to,
  onClose,
}: {
  row: UsageRow;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const fn = useServerFn(getUserUsageDetail);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["usage-user-detail", row.userId, from, to],
    queryFn: () => fn({ data: { userId: row.userId!, from, to } }),
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative ml-auto h-full w-full max-w-xl bg-card border-l shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-semibold truncate">{row.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {row.email ?? "—"} · {row.department}
            </div>
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-md hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {isLoading ? (
            <div className="p-8 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-sm text-destructive">{(error as Error)?.message}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="ล็อกอินสำเร็จ" value={data?.loginStats.success ?? 0} />
                <Metric label="ล็อกอินไม่สำเร็จ" value={data?.loginStats.failed ?? 0} />
              </div>

              <DetailBlock title="ประวัติล็อกอิน" empty={!data?.logins.length}>
                <ul className="space-y-1 text-xs">
                  {(data?.logins ?? []).map((l, i) => (
                    <li key={i} className="rounded-md bg-muted/50 px-2 py-1.5 flex flex-wrap gap-2">
                      <span>{fmtDateTime(l.at)}</span>
                      <span className={l.success ? "text-success" : "text-destructive"}>
                        {l.success ? "สำเร็จ" : "ไม่สำเร็จ"}
                      </span>
                      <span className="text-muted-foreground">
                        {[l.browser, l.device, l.country, l.ip].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </DetailBlock>

              <DetailBlock title="ไทม์ไลน์เซสชัน" empty={!data?.sessions.length}>
                <ul className="space-y-1 text-xs">
                  {(data?.sessions ?? []).map((s) => (
                    <li key={s.sessionId} className="rounded-md bg-muted/50 px-2 py-1.5">
                      {fmtDateTime(s.startedAt)} → {fmtDateTime(s.endedAt)} ·{" "}
                      {fmtMinutes(s.minutes)} · {s.pageViews} หน้า
                    </li>
                  ))}
                </ul>
              </DetailBlock>

              <DetailBlock title="เวลาใช้งานรายวัน" empty={!data?.daily.length}>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.daily ?? []}>
                      <XAxis dataKey="day" fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="minutes" name="นาที" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DetailBlock>

              <DetailBlock title="ฟีเจอร์ที่ใช้" empty={!data?.features.length}>
                <div className="flex flex-wrap gap-1.5">
                  {(data?.features ?? []).map((f) => (
                    <span key={f.name} className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs">
                      {f.name} · {f.count}
                    </span>
                  ))}
                </div>
              </DetailBlock>

              <DetailBlock title="หน้าที่เข้าชม" empty={!data?.pages.length}>
                <ul className="space-y-1 text-xs">
                  {(data?.pages ?? []).map((p) => (
                    <li key={p.path} className="flex justify-between rounded-md bg-muted/50 px-2 py-1">
                      <span className="truncate">{p.path}</span>
                      <span className="tabular-nums">{p.count}</span>
                    </li>
                  ))}
                </ul>
              </DetailBlock>

              <DetailBlock title="อุปกรณ์ / เบราว์เซอร์ / IP / ประเทศ" empty={!data?.environments.length}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left py-1">เบราว์เซอร์</th>
                        <th className="text-left py-1">อุปกรณ์</th>
                        <th className="text-left py-1">OS</th>
                        <th className="text-left py-1">IP</th>
                        <th className="text-left py-1">ประเทศ</th>
                        <th className="text-right py-1">ครั้ง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.environments ?? []).map((e, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-1">{e.browser ?? "—"}</td>
                          <td className="py-1">{e.device ?? "—"}</td>
                          <td className="py-1">{e.os ?? "—"}</td>
                          <td className="py-1">{e.ip ?? "—"}</td>
                          <td className="py-1">{e.country ?? "—"}</td>
                          <td className="py-1 text-right tabular-nums">{e.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DetailBlock>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailBlock({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-semibold mb-2">{title}</div>
      {empty ? <div className="text-xs text-muted-foreground">ไม่มีข้อมูล</div> : children}
    </div>
  );
}
