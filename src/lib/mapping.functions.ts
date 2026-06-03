import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VALID_IMPACTS = [
  "จอดับ/ไม่เห็นโฆษณา",
  "แสดงผลไม่สมบูรณ์",
  "ไม่มีผลต่อการมองเห็น",
] as const;

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("ต้องมีสิทธิ์ผู้ดูแลระบบ (admin)");
}

export const listInformedMapping = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("informed_mapping")
      .select("informed, impact_level, informed_group, team, informed_detail")
      .order("team", { ascending: true })
      .order("informed", { ascending: true })
      .limit(10000);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

const rowSchema = z.object({
  informed: z.string().min(1).max(500),
  impact_level: z.enum(VALID_IMPACTS),
  informed_group: z.string().max(500).nullable().optional(),
  team: z.string().max(200).nullable().optional(),
  informed_detail: z.string().min(1).max(500),
});

export const replaceInformedMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ rows: z.array(rowSchema).min(1).max(5000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // dedupe by informed_detail
    const seen = new Set<string>();
    const rows = data.rows
      .filter((r) => {
        if (seen.has(r.informed_detail)) return false;
        seen.add(r.informed_detail);
        return true;
      })
      .map((r) => ({
        informed: r.informed.trim(),
        impact_level: r.impact_level,
        informed_group: r.informed_group?.trim() || null,
        team: r.team?.trim() || null,
        informed_detail: r.informed_detail.trim(),
      }));
    const del = await supabaseAdmin
      .from("informed_mapping")
      .delete()
      .neq("informed_detail", "__never__");
    if (del.error) throw new Error(del.error.message);
    // chunked insert
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const ins = await supabaseAdmin.from("informed_mapping").insert(slice);
      if (ins.error) throw new Error(ins.error.message);
    }
    return { ok: true, count: rows.length };
  });
