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
} from "lucide-react";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { getMyMenuAccess } from "@/lib/admin.functions";

const NAV_ALL = [
  { to: "/search", label: "Asset history", icon: Search },
  { to: "/claims", label: "Claim Aging", icon: Wrench },
  { to: "/pm-insights", label: "PM Insights", icon: BarChart3 },
  { to: "/monitoring", label: "Monitoring", icon: Activity },
  { to: "/rca", label: "Root Cause Analysis", icon: Microscope },
  { to: "/map", label: "แผนที่ป้าย", icon: MapPin },
  { to: "/settings", label: "ตั้งค่าระบบ", icon: Settings },
  { to: "/permissions", label: "จัดการสิทธิ์", icon: Users },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const fn = useServerFn(getMyMenuAccess);
  const { data } = useQuery({
    queryKey: ["my-menu-access"],
    queryFn: () => fn({}),
    staleTime: 60_000,
  });
  const allowed = data?.allowed ?? null;
  const isAdmin = data?.isAdmin ?? false;
  const nav = NAV_ALL.filter(
    (n) => isAdmin || allowed === null || allowed.includes(n.to),
  );

  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

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
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-sidebar-accent text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="size-9 shrink-0 rounded-full bg-sidebar-primary grid place-items-center text-sm font-semibold text-sidebar-primary-foreground">
            A
          </div>
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-sm font-medium truncate">Admin User</div>
            <div className="text-[11px] text-sidebar-foreground/60 truncate">
              admin@planb.co.th
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
                A
              </div>
              <span className="hidden sm:inline text-sm font-medium">Admin</span>
              <ChevronDown className="hidden sm:inline size-4 text-muted-foreground" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8 min-w-0">{children}</main>

      </div>
    </div>
  );
}
