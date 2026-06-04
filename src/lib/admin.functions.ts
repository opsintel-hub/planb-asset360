import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runClaimSync, runAssetHistorySync, runAssetListSync, runAssetHistorySyncBatch } from "./sync.server";

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
        role: z.enum(["admin", "manager", "technician", "viewer"]),
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
const ALL_MENUS = ["/search", "/claims", "/pm-insights", "/settings", "/permissions"];

export const getMyMenuAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rolesData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (rolesData ?? []).map((r) => r.role as string);
    const isAdmin = roles.includes("admin");
    if (isAdmin) return { isAdmin: true, roles, allowed: ALL_MENUS };

    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "role_menu_permissions")
      .maybeSingle();
    const perms = (setting?.value ?? {}) as Record<string, string[]>;
    const allowed = new Set<string>();
    for (const r of roles) for (const m of perms[r] ?? []) allowed.add(m);
    // จัดการสิทธิ์ เห็นเฉพาะ admin เท่านั้น
    allowed.delete("/permissions");
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

export const syncAssetHistoryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ oldCode: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const result = await runAssetHistorySync(data.oldCode);
    return result;
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
export const syncMssqlAssetHistoryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ days: z.number().int().min(1).max(3650).optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: res, error } = await supabaseAdmin.functions.invoke("sync-asset-history", {
      body: { days: data.days ?? 90 },
    });
    if (error) return { ok: false, rows: 0, error: `sync-asset-history failed: ${error.message}` };
    const r = res as { ok?: boolean; rows?: number; error?: string } | null;
    if (!r?.ok) return { ok: false, rows: r?.rows ?? 0, error: r?.error ?? "no result" };
    return { ok: true, rows: r.rows ?? 0 };
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
