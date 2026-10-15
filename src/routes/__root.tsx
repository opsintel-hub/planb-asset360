import { createRootRouteWithContext, Outlet, HeadContent, Scripts, Link, useRouter, useLocation, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useEffect } from "react";
import appCss from "../styles.css?url";
import { AppShell } from "@/components/app-shell";
import { AuthProvider, useAuth } from "@/lib/auth-context";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">ไม่พบหน้านี้</p>
        <Link to="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">กลับหน้าหลัก</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">เกิดข้อผิดพลาด</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error instanceof Error ? error.message : "กรุณาลองอีกครั้ง"}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >ลองอีกครั้ง</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Asset History 360 — PlanB Media" },
      { name: "description", content: "ระบบบริหารจัดการทรัพย์สินสื่อโฆษณา PlanB Media — ติดตาม PM, Claim, Monitoring" },
      { property: "og:title", content: "Asset History 360 — PlanB Media" },
      { name: "twitter:title", content: "Asset History 360 — PlanB Media" },
      { property: "og:description", content: "ระบบบริหารจัดการทรัพย์สินสื่อโฆษณา PlanB Media — ติดตาม PM, Claim, Monitoring" },
      { name: "twitter:description", content: "ระบบบริหารจัดการทรัพย์สินสื่อโฆษณา PlanB Media — ติดตาม PM, Claim, Monitoring" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sarabun:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head><HeadContent /></head>
      <body style={{ fontFamily: "'Sarabun', 'Inter', system-ui, sans-serif" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { user, session, loading } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const isLogin = pathname === "/login";
  const isPublicShared = pathname.startsWith("/shared/");
  const isAuthed = !!user && !!session?.access_token;

  useEffect(() => {
    if (!loading && !isAuthed && !isLogin && !isPublicShared) nav({ to: "/login" });
  }, [loading, isAuthed, isLogin, isPublicShared, nav]);

  if (loading && !isPublicShared) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
        กำลังโหลด...
      </div>
    );
  }
  if (isPublicShared) return <Outlet />;
  if (isLogin) return <Outlet />;
  if (!isAuthed) return null;
  return <AppShell><Outlet /></AppShell>;
}
