import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ONLY_MENUS, ALL_MENU_PATHS } from "@/lib/app-menus";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runClaimSync, runAssetListSync, runAssetHistorySyncBatch } from "./sync.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("ต้องมีสิทธิ์ผู้ดูแลระบบ (admin)");
}

// ---------- Settings writes ----------
export const updateAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        key: z.string().min(1).max(100),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value: z.any(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: data.key, value: data.value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateAirtableSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.number().int().min(1).max(8),
        name: z.string().max(255).nullable().optional(),
        base_id: z.string().max(255).nullable().optional(),
        table_name: z.string().max(255).nullable().optional(),
        enabled: z.boolean().optional(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schedule: z.array(z.any()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin
      .from("airtable_connections")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Roles ----------
export const listUsersWithRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email, display_name, created_at")
      .order("created_at", { ascending: false });
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const byUser: Record<string, string[]> = {};
    for (const r of roles ?? []) {
      (byUser[r.user_id] ??= []).push(r.role);
    }
    return {
      users: (profiles ?? []).map((p) => ({
        ...p,
        roles: byUser[p.user_id] ?? [],
      })),
    };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "manager", "technician", "viewer", "sale", "crm", "production"]),
        grant: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.grant) {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
    } else {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", data.role);
    }
    return { ok: true };
  });

export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) > 0) throw new Error("มีผู้ดูแลระบบอยู่แล้ว");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    return { roles: (data ?? []).map((r) => r.role as string) };
  });

// ---------- Menu access ----------
const ALL_MENUS = ALL_MENU_PATHS;

export const getMyMenuAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // อ่านบทบาทของตัวเองผ่าน client ของผู้ใช้ (RLS อนุญาต select ตัวเอง)
    // ถ้าล้มเหลว จึงค่อย fallback ไปใช้ admin client — กัน sidebar หายเพราะ
    // การอ่านบทบาทพลาดแล้วถูกตีความว่า "ไม่มีบทบาท"
    let roles: string[] | null = null;
    const own = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!own.error && own.data?.length) roles = own.data.map((r) => r.role as string);
    // ถ้าอ่านผ่าน client ของผู้ใช้ไม่ได้ (หรือได้ 0 แถวเพราะ policy) ให้ยืนยันด้วย admin client
    if (roles === null) {

      const fb = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      if (fb.error) throw new Error(fb.error.message);
      roles = (fb.data ?? []).map((r) => r.role as string);
    }

    const isAdmin = roles.includes("admin");
    if (isAdmin) return { isAdmin: true, roles, allowed: ALL_MENUS };

    const { data: setting, error: settingErr } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "role_menu_permissions")
      .maybeSingle();
    if (settingErr) throw new Error(settingErr.message);
    const perms = (setting?.value ?? {}) as Record<string, string[]>;
    const allowed = new Set<string>();
    for (const r of roles) for (const m of perms[r] ?? []) allowed.add(m);
    // เมนู admin-only ไม่ให้บทบาทอื่นเห็นเสมอ
    for (const m of ADMIN_ONLY_MENUS) allowed.delete(m);
    return { isAdmin: false, roles, allowed: Array.from(allowed) };
  });


export const getRoleMenuPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "role_menu_permissions")
      .maybeSingle();
    return {
      permissions: (data?.value ?? {}) as Record<string, string[]>,
      menus: ALL_MENUS,
    };
  });

export const setRoleMenuPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        permissions: z.record(z.string(), z.array(z.string())),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: "role_menu_permissions",
      value: data.permissions,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminResetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        user_id: z.string().uuid(),
        new_password: z.string().min(8).max(100),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Sync ----------
export const syncClaimsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const result = await runClaimSync();
    return result;
  });

// Deprecated: Plan B per-asset HTTP sync was removed when we consolidated to MSSQL.
// Kept as a no-op so any old caller fails loudly rather than silently writing stale data.
export const syncAssetHistoryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ oldCode: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return {
      ok: false,
      rows: 0,
      error:
        "Per-asset Plan B sync ถูกยกเลิกแล้ว — ใช้การ Sync จาก MSSQL (Settings → AssetHistory) เป็นแหล่งเดียว",
    };
  });


export const syncAssetsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return runAssetListSync();
  });

export const syncAssetHistoryBatchNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ limit: z.number().int().min(1).max(2000).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    return runAssetHistorySyncBatch(data.limit ?? 200);
  });

// Invoke the dedicated MSSQL AssetHistory sync edge function.
// `reset=true` does a full wipe + re-pull; otherwise it runs incremental from the saved cursor.
export const syncMssqlAssetHistoryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ reset: z.boolean().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: res, error } = await supabaseAdmin.functions.invoke("sync-asset-history", {
      body: { reset: data.reset === true },
    });
    if (error) return { ok: false, rows: 0, error: `sync-asset-history failed: ${error.message}` };
    const r = res as { ok?: boolean; queued?: boolean; error?: string } | null;
    if (!r?.ok) return { ok: false, rows: 0, error: r?.error ?? "no result" };
    return { ok: true, rows: 0 };
  });

// Invoke the dedicated MSSQL Asset_PM_Schedule sync edge function.
export const syncPmSchedulesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: res, error } = await supabaseAdmin.functions.invoke("sync-pm-schedules", { body: {} });
    if (error) return { ok: false, rows: 0, error: `sync-pm-schedules failed: ${error.message}` };
    const r = res as { ok?: boolean; rows?: number; error?: string } | null;
    if (!r?.ok) return { ok: false, rows: r?.rows ?? 0, error: r?.error ?? "no result" };
    return { ok: true, rows: r.rows ?? 0 };
  });

// ---------- MSSQL Explorer (list tables / preview rows / columns) ----------
export const mssqlListTables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: res, error } = await supabaseAdmin.functions.invoke("mssql-explore", {
      body: { mode: "list" },
    });
    if (error) return { ok: false, error: error.message, tables: [] as Array<{ schema: string; table: string; row_count: number; column_count: number }> };
    const r = res as { ok?: boolean; error?: string; tables?: Array<{ schema: string; table: string; row_count: number; column_count: number }> } | null;
    if (!r?.ok) return { ok: false, error: r?.error ?? "no result", tables: [] };
    return { ok: true, tables: r.tables ?? [] };
  });

export const mssqlPreviewTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      table: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.]+$/, "ใช้ตัวอักษร a-z 0-9 _ . เท่านั้น"),
      limit: z.number().int().min(1).max(50).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    type Cell = string | number | boolean | null;
    const empty: { ok: boolean; error?: string; columns: { name: string; type: string }[]; rows: Record<string, Cell>[] } =
      { ok: false, error: undefined, columns: [], rows: [] };
    const { data: res, error } = await supabaseAdmin.functions.invoke("mssql-explore", {
      body: { mode: "preview", table: data.table, limit: data.limit ?? 10 },
    });
    if (error) return { ...empty, error: error.message };
    const r = res as {
      ok?: boolean; error?: string;
      columns?: Array<{ name: string; type: string }>;
      rows?: Array<Record<string, unknown>>;
    } | null;
    if (!r?.ok) return { ...empty, error: r?.error ?? "no result" };
    const toCell = (v: unknown): Cell => {
      if (v == null) return null;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
      return String(v);
    };
    const rows: Record<string, Cell>[] = (r.rows ?? []).map((row) => {
      const o: Record<string, Cell> = {};
      for (const [k, v] of Object.entries(row)) o[k] = toCell(v);
      return o;
    });
    return { ok: true, columns: r.columns ?? [], rows };
  });

// ---------- MSSQL Daily Cron Schedule (UTC stored, Thai displayed in UI) ----------
const MSSQL_CRON_JOBS = [
  "mssql-sync-assets-daily",
  "mssql-sync-pm-schedules-daily",
  "mssql-sync-asset-history-daily",
  "crm-sync-ad-contracts-daily",
] as const;

function parseDailyCron(schedule: string): { hour: number; minute: number } | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const m = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isInteger(m) || !Number.isInteger(h)) return null;
  if (m < 0 || m > 59 || h < 0 || h > 23) return null;
  return { hour: h, minute: m };
}

export const getMssqlCronSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("get_mssql_cron_schedules");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ job_name: string; schedule: string }>;
    const map = new Map(rows.map((r) => [r.job_name, r.schedule]));
    return MSSQL_CRON_JOBS.map((job) => {
      const sched = map.get(job) ?? null;
      const parsed = sched ? parseDailyCron(sched) : null;
      return {
        job,
        scheduleUtc: sched,
        hourUtc: parsed?.hour ?? null,
        minuteUtc: parsed?.minute ?? null,
      };
    });
  });

export const updateMssqlCronSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        job: z.enum(MSSQL_CRON_JOBS),
        hourUtc: z.number().int().min(0).max(23),
        minuteUtc: z.number().int().min(0).max(59),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.rpc("set_mssql_cron_schedule", {
      p_job: data.job,
      p_hour_utc: data.hourUtc,
      p_minute_utc: data.minuteUtc,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---------- Diagram Mappings writes ----------
const mappingInput = z.object({
  id: z.string().uuid().optional(),
  category: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/, "ใช้ตัวพิมพ์เล็ก ตัวเลข _ - เท่านั้น"),
  label: z.string().min(1).max(120),
  icon: z.string().max(60).nullable().optional(),
  keywords: z.array(z.string().min(1).max(120)).max(80),
  sort_order: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().optional(),
});

export const upsertDiagramMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => mappingInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const payload = { ...data, updated_by: context.userId, updated_at: new Date().toISOString() };
    const { error } = await supabaseAdmin
      .from("diagram_mappings")
      .upsert(payload, { onConflict: "category" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDiagramMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("diagram_mappings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const replaceDiagramMappings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ rows: z.array(mappingInput).min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // ลบของเดิมทั้งหมดแล้ว insert ใหม่ (Import CSV แบบแทนที่)
    const del = await supabaseAdmin.from("diagram_mappings").delete().neq("category", "__never__");
    if (del.error) throw new Error(del.error.message);
    const stamp = new Date().toISOString();
    const rows = data.rows.map((r, idx) => ({
      ...r,
      sort_order: r.sort_order ?? idx + 1,
      enabled: r.enabled ?? true,
      updated_by: context.userId,
      updated_at: stamp,
    }));
    const ins = await supabaseAdmin.from("diagram_mappings").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
    return { ok: true, count: rows.length };
  });
