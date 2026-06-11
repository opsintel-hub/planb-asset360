import { createRootRouteWithContext, Outlet, HeadContent, Scripts, Link, useRouter, useLocation, useNavigate } from "@tanstack/react-router";
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">เกิดข้อผิดพลาด</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
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
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f856023a-779b-49ea-964f-4022d8d87972/id-preview-1333a767--6d2903c3-530f-4343-83c9-b9ada7a70d18.lovable.app-1779268647975.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f856023a-779b-49ea-964f-4022d8d87972/id-preview-1333a767--6d2903c3-530f-4343-83c9-b9ada7a70d18.lovable.app-1779268647975.png" },
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
  const isAuthed = !!user && !!session?.access_token;

  useEffect(() => {
    if (!loading && !isAuthed && !isLogin) nav({ to: "/login" });
  }, [loading, isAuthed, isLogin, nav]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
        กำลังโหลด...
      </div>
    );
  }
  if (isLogin) return <Outlet />;
  if (!isAuthed) return null;
  return <AppShell><Outlet /></AppShell>;
}
