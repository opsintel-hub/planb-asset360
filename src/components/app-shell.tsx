import { Link, useLocation } from "@tanstack/react-router";
import {
  Search,
  Settings,
  Users,
  Wrench,
  Bell,
  ChevronDown,
  BarChart3,
  Activity,
  Microscope,
  Menu,
  X,
  MapPin,
  Sparkles,
  Navigation,
  ShieldAlert,
  ExternalLink,

} from "lucide-react";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { getMyMenuAccess } from "@/lib/admin.functions";
import { countNewlyLaunchedAds } from "@/lib/ad-contracts.functions";
import { countOpenClaims } from "@/lib/data.functions";
import { useAuth } from "@/lib/auth-context";
import { APP_MENUS } from "@/lib/app-menus";

const MENU_ICONS: Record<string, typeof Search> = {
  "/search": Search,
  "/claims": Wrench,
  "/pm-insights": BarChart3,
  "/monitoring": Activity,
  "/risk-score": ShieldAlert,
  "/rca": Microscope,
  "/map": MapPin,
  "/route-monitoring": Navigation,
  "/settings": Settings,
  "/permissions": Users,
};

const NAV_ALL = APP_MENUS.map((m) => ({
  to: m.to,
  label: m.label,
  icon: MENU_ICONS[m.to] ?? Sparkles,
}));

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const fn = useServerFn(getMyMenuAccess);
  const { data, isLoading } = useQuery({
    queryKey: ["my-menu-access"],
    queryFn: () => fn({}),
    staleTime: 60_000,
  });
  // Badge on "Ad Campaigns": ads launched in the last 7 days waiting for photos.
  const newAdsFn = useServerFn(countNewlyLaunchedAds);
  const { data: newAds } = useQuery({
    queryKey: ["new-ads-count", 7],
    queryFn: () => newAdsFn({ data: { days: 7 } }),
    staleTime: 5 * 60_000,
  });
  // Badge on "Claim Aging": total open claim tickets waiting to be cleared.
  const claimCountFn = useServerFn(countOpenClaims);
  const { data: openClaims } = useQuery({
    queryKey: ["open-claims-count"],
    queryFn: () => claimCountFn({}),
    staleTime: 5 * 60_000,
  });
  const { user } = useAuth();
  const email = user?.email ?? "";
  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    (email ? email.split("@")[0] : "ผู้ใช้งาน");
  const initial = (displayName[0] ?? "?").toUpperCase();
  const roleLabel = data
    ? (data.roles.length ? data.roles.join(" · ") : "ยังไม่มีบทบาท") + (email ? ` · ${email}` : "")
    : email;

  const allowed = data?.allowed ?? null;
  const isAdmin = data?.isAdmin ?? false;
  const nav = NAV_ALL.filter(
    (n) => isAdmin || allowed === null || allowed.includes(n.to),
  );

  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // ---------- Open menus in a new browser tab (per-user preference) ----------
  // Read after mount so SSR markup and the first client render always match.
  const [newTab, setNewTab] = useState(false);
  useEffect(() => {
    setNewTab(window.localStorage.getItem("app:menu-new-tab") === "1");
  }, []);
  const toggleNewTab = () => {
    setNewTab((v) => {
      const next = !v;
      window.localStorage.setItem("app:menu-new-tab", next ? "1" : "0");
      return next;
    });
  };


  // ---------- Global Neon theme toggle ----------
  const [neon, setNeon] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("app:neon") === "1";
  });
  const excludeNeon = pathname.startsWith("/settings") || pathname.startsWith("/permissions");
  const neonActive = neon && !excludeNeon;
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("app:neon", neon ? "1" : "0");
    }
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("neon-theme", neonActive);
      document.body.classList.toggle("neon-theme", neonActive);
    }
  }, [neon, neonActive]);


  const SidebarContent = (
    <>
      <div className="px-6 py-6 border-b border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="size-10 shrink-0 rounded-xl grid place-items-center font-bold text-primary-foreground shadow-lg"
            style={{ background: "var(--gradient-primary)" }}
          >
            PB
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-bold tracking-tight text-base truncate">PlanB Media</div>
            <div className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60 truncate">
              Asset History 360
            </div>
          </div>
        </div>
        <button
          className="md:hidden size-8 rounded-md grid place-items-center hover:bg-sidebar-accent/60"
          onClick={() => setMobileOpen(false)}
          aria-label="ปิดเมนู"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {nav.length === 0 && !isLoading ? (
          <div className="rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 p-3 text-xs leading-relaxed text-sidebar-foreground/80">
            บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าเมนูใด ๆ
            <div className="mt-1 text-sidebar-foreground/60">
              โปรดติดต่อผู้ดูแลระบบเพื่อกำหนดบทบาท
            </div>
            <Link
              to="/permissions"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-sidebar-primary px-2.5 py-1.5 font-medium text-sidebar-primary-foreground"
            >
              <Users className="size-3.5" /> จัดการสิทธิ์
            </Link>
          </div>
        ) : null}
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              target={newTab ? "_blank" : undefined}
              rel={newTab ? "noopener" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-sidebar-accent text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >

              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.to === "/campaigns" && (newAds?.count ?? 0) > 0 && (
                <span
                  title={`มีป้ายที่โฆษณาขึ้นใหม่ ${newAds?.count} ป้ายใน 7 วัน (${newAds?.rowCount ?? 0} รายการสัญญา) — รอทีมถ่ายรูป`}
                  className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground"
                >
                  {newAds?.count}
                </span>
              )}
              {item.to === "/claims" && (openClaims?.count ?? 0) > 0 && (
                <span
                  title={`มีเคลมค้างอยู่ ${openClaims?.count} รายการ — รอเคลียร์`}
                  className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground"
                >
                  {openClaims?.count}
                </span>
              )}


            </Link>
          );
        })}
      </nav>


      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={toggleNewTab}
          aria-pressed={newTab}
          title="เปิดเมนูในแท็บใหม่ทุกครั้ง (ยังกด Ctrl/Cmd + คลิก ได้เหมือนเดิม)"
          className={cn(
            "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
            newTab
              ? "bg-sidebar-accent text-sidebar-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60",
          )}
        >
          <ExternalLink className="size-3.5 shrink-0" />
          <span className="truncate">เปิดเมนูในแท็บใหม่</span>
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
              newTab ? "bg-primary text-primary-foreground" : "bg-sidebar-border/60",
            )}
          >
            {newTab ? "เปิด" : "ปิด"}
          </span>
        </button>
      </div>

      <div className="p-4 border-t border-sidebar-border">

        <div className="flex items-center gap-3">
          <div className="size-9 shrink-0 rounded-full bg-sidebar-primary grid place-items-center text-sm font-semibold text-sidebar-primary-foreground">
            {initial}
          </div>
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{displayName}</div>
            <div className="text-[11px] text-sidebar-foreground/60 truncate">
              {roleLabel}
            </div>
          </div>
        </div>
      </div>

    </>
  );

  return (
    <div className={cn("min-h-screen flex bg-background", neonActive && "neon-theme")}>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex w-64 shrink-0 text-sidebar-foreground flex-col"
        style={{ background: "var(--gradient-sidebar)" }}
      >
        {SidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] text-sidebar-foreground flex flex-col shadow-xl"
            style={{ background: "var(--gradient-sidebar)" }}
          >
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 md:h-16 border-b bg-card/80 backdrop-blur sticky top-0 z-10 px-3 md:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="md:hidden size-9 rounded-lg hover:bg-accent grid place-items-center"
              onClick={() => setMobileOpen(true)}
              aria-label="เปิดเมนู"
            >
              <Menu className="size-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
              <span className="hidden sm:inline">PlanB</span>
              <span className="hidden sm:inline">/</span>
              <span className="text-foreground font-medium truncate">
                {nav.find((n) => pathname.startsWith(n.to))?.label ?? "Page"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {!excludeNeon && (
              <button
                onClick={() => setNeon((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs sm:text-sm h-9 px-2.5 sm:px-3 rounded-lg border transition",
                  neon
                    ? "bg-primary text-primary-foreground border-primary shadow-[0_0_16px_var(--primary)]"
                    : "hover:bg-accent",
                )}
                title="สลับธีม Neon / ปกติ"
              >
                <Sparkles className="size-4" />
                <span className="hidden sm:inline">{neon ? "Neon: On" : "Neon: Off"}</span>
              </button>
            )}
            <button className="relative size-9 rounded-lg hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground transition">
              <Bell className="size-4" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
            </button>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition">
              <div className="size-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                {initial}
              </div>
              <span className="hidden sm:inline text-sm font-medium">
                {displayName}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {data?.roles.length ? data.roles.join(", ") : ""}
                </span>
              </span>
              <ChevronDown className="hidden sm:inline size-4 text-muted-foreground" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8 min-w-0">{children}</main>

      </div>
    </div>
  );
}
