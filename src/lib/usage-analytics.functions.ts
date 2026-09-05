// Usage analytics: activity tracking + admin-only aggregation reads.
// Aggregation runs inside Postgres (get_usage_analytics / get_user_usage_detail),
// both of which verify the caller is an admin before returning anything.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ---------------- Types shared with the UI ---------------- */

export type UsageKpis = {
  totalUsers: number;
  activeToday: number;
  activeWeek: number;
  activeMonth: number;
  totalSessions: number;
  avgSessionMinutes: number;
};

export type UsageRow = {
  userId: string | null;
  name: string;
  email: string | null;
  department: string;
  lastLogin: string | null;
  loginCount: number;
  sessions: number;
  totalMinutes: number;
  avgSessionMinutes: number;
  pagesVisited: number;
  topFeature: string | null;
  lastActivity: string | null;
};

export type UsageAnalytics = {
  kpis: UsageKpis;
  daily: { day: string; users: number; events: number }[];
  hourly: { hour: number; events: number; users: number }[];
  weekly: { week: string; users: number; events: number }[];
  monthly: { month: string; users: number; events: number }[];
  topUsers: { userId: string | null; name: string; events: number; sessions: number }[];
  byDepartment: { department: string; users: number; events: number }[];
  heatmap: { dow: number; hour: number; events: number }[];
  devices: { name: string; value: number }[];
  browsers: { name: string; value: number }[];
  analytics: {
    dau: number;
    wau: number;
    mau: number;
    retentionRate: number;
    avgSessionMinutes: number;
    avgVisitsPerUser: number;
    bounceRate: number;
    returningUsers: number;
    newUsers: number;
  };
  table: UsageRow[];
  alerts: {
    unusualLogins: { userId: string | null; name: string; day: string; failed: number }[];
    inactiveUsers: { userId: string | null; name: string | null; lastActivity: string | null }[];
    heavyUsers: { userId: string | null; name: string; minutes: number }[];
  };
  options: {
    departments: string[];
    devices: string[];
    platforms: string[];
    browsers: string[];
    users: { id: string; name: string | null }[];
    roles: string[];
  };
};

export type UserUsageDetail = {
  logins: {
    at: string;
    success: boolean;
    ip: string | null;
    country: string | null;
    browser: string | null;
    device: string | null;
  }[];
  sessions: {
    sessionId: string;
    startedAt: string;
    endedAt: string;
    minutes: number;
    pageViews: number;
  }[];
  daily: { day: string; minutes: number }[];
  features: { name: string; count: number }[];
  pages: { path: string; count: number }[];
  environments: {
    browser: string | null;
    device: string | null;
    platform: string | null;
    os: string | null;
    ip: string | null;
    country: string | null;
    count: number;
  }[];
  loginStats: { success: number; failed: number };
};

/* ---------------- Tracking ---------------- */

const trackInput = z.object({
  sessionId: z.string().min(1).max(80),
  eventType: z.enum(["login", "page_view", "feature"]),
  path: z.string().max(300).nullish(),
  feature: z.string().max(120).nullish(),
  deviceType: z.string().max(40).nullish(),
  platform: z.string().max(40).nullish(),
  browser: z.string().max(60).nullish(),
  os: z.string().max(60).nullish(),
  success: z.boolean().optional(),
});

export const trackActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => trackInput.parse(d))
  .handler(async ({ data, context }) => {
    const req = getRequest();
    const h = req?.headers;
    const ip =
      h?.get("cf-connecting-ip") ??
      h?.get("x-real-ip") ??
      h?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const country = h?.get("cf-ipcountry") ?? null;
    const userAgent = h?.get("user-agent")?.slice(0, 400) ?? null;
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;

    const { error } = await context.supabase
      .from("user_activity_events" as never)
      .insert({
        user_id: context.userId,
        email,
        session_id: data.sessionId,
        event_type: data.eventType,
        path: data.path ?? null,
        feature: data.feature ?? null,
        device_type: data.deviceType ?? null,
        platform: data.platform ?? null,
        browser: data.browser ?? null,
        os: data.os ?? null,
        ip,
        country,
        success: data.success ?? true,
        user_agent: userAgent,
      } as never);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Admin reads ---------------- */

const filterInput = z.object({
  from: z.string(),
  to: z.string(),
  userId: z.string().uuid().nullish(),
  department: z.string().nullish(),
  role: z.string().nullish(),
  device: z.string().nullish(),
  platform: z.string().nullish(),
  browser: z.string().nullish(),
});

export const getUsageAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filterInput.parse(d))
  .handler(async ({ data, context }) => {
    const rpc = context.supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data: res, error } = await rpc("get_usage_analytics", {
      _from: data.from,
      _to: data.to,
      _user_id: data.userId ?? null,
      _department: data.department ?? null,
      _role: data.role ?? null,
      _device: data.device ?? null,
      _platform: data.platform ?? null,
      _browser: data.browser ?? null,
    });
    if (error) throw new Error(error.message);
    return res as UsageAnalytics;
  });

export const getUserUsageDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), from: z.string(), to: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rpc = context.supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data: res, error } = await rpc("get_user_usage_detail", {
      _user_id: data.userId,
      _from: data.from,
      _to: data.to,
    });
    if (error) throw new Error(error.message);
    return res as UserUsageDetail;
  });
