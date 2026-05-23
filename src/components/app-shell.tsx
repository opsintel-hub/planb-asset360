import { Link, useLocation } from "@tanstack/react-router";
import {
  Search,
  Settings,
  Users,
  Wrench,
  Bell,
  ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { getMyMenuAccess } from "@/lib/admin.functions";

const NAV_ALL = [
  { to: "/search", label: "ค้นหาประวัติป้าย", icon: Search },
  { to: "/claims", label: "Claim Aging", icon: Wrench },
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
  const allowed = data?.allowed ?? null; // null = loading (show all so admin sees menus immediately)
  const isAdmin = data?.isAdmin ?? false;
  const nav = NAV_ALL.filter(
    (n) => isAdmin || allowed === null || allowed.includes(n.to),
  );

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        className="w-64 shrink-0 text-sidebar-foreground flex flex-col"
        style={{ background: "var(--gradient-sidebar)" }}
      >
        <div className="px-6 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div
              className="size-10 rounded-xl grid place-items-center font-bold text-primary-foreground shadow-lg"
              style={{ background: "var(--gradient-primary)" }}
            >
              PB
            </div>
            <div className="leading-tight">
              <div className="font-bold tracking-tight text-base">PlanB Media</div>
              <div className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
                Asset History 360
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
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
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-sidebar-primary grid place-items-center text-sm font-semibold text-sidebar-primary-foreground">
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
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-card/80 backdrop-blur sticky top-0 z-10 px-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>PlanB</span>
            <span>/</span>
            <span className="text-foreground font-medium">
              {nav.find((n) => pathname.startsWith(n.to))?.label ?? "Page"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative size-9 rounded-lg hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground transition">
              <Bell className="size-4" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
            </button>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition">
              <div className="size-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                A
              </div>
              <span className="text-sm font-medium">Admin</span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
