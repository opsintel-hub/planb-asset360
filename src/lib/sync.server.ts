import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function readSetting(key: string): Promise<unknown> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value;
}

async function logStart(source: string) {
  const { data } = await supabaseAdmin
    .from("sync_logs")
    .insert({ source, status: "running", message: "started" })
    .select("id")
    .single();
  return data?.id as number | undefined;
}
async function logFinish(id: number | undefined, status: "success" | "warning" | "error", message: string, rows: number) {
  if (!id) return;
  await supabaseAdmin
    .from("sync_logs")
    .update({ status, message, rows_affected: rows, finished_at: new Date().toISOString() })
    .eq("id", id);
}

async function fetchPlanB(url: string): Promise<unknown> {
  const apiKey = process.env.PLANB_API_KEY;
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } : { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

export async function runAssetListSync() {
  // Direct MSSQL connection is not possible from the Cloudflare Worker runtime
  // (no TDS / raw TCP). Delegate to the Supabase Edge Function `sync-assets`
  // which runs on Deno and uses `npm:mssql` to connect directly.
  const { data, error } = await supabaseAdmin.functions.invoke("sync-assets", {
    body: {},
  });
  if (error) return { ok: false, rows: 0, error: `sync-assets edge function failed: ${error.message}` };
  const result = data as { ok?: boolean; rows?: number; error?: string; fallback?: boolean } | null;
  if (!result?.ok) return { ok: false, rows: result?.rows ?? 0, error: result?.error ?? "sync-assets returned no result" };
  return { ok: true, rows: result.rows ?? 0 };
}


export async function runClaimSync() {
  const id = await logStart("claim");
  try {
    const url = (await readSetting("claim_api_url")) as string | undefined;
    if (!url) throw new Error("ยังไม่ได้ตั้งค่า claim_api_url");
    const raw = await fetchPlanB(url);
    const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);
    let n = 0;
    for (const item of list as Record<string, unknown>[]) {
      const ticketCode = String(
        item.refNumber ?? item.RefNumber ?? item.ref_number ??
        item.ticketCode ?? item.TicketCode ?? item.ticket_code ?? item.id ?? "",
      );
      if (!ticketCode) continue;
      const openedAt = (item.openedAt ?? item.OpenedAt ?? item.createdAt ?? null) as string | null;
      const totalTimeHours = typeof item.totalTime === "number" ? item.totalTime : Number(item.totalTime ?? NaN);
      const ageHours = openedAt
        ? (Date.now() - new Date(openedAt).getTime()) / 3_600_000
        : Number.isFinite(totalTimeHours) ? totalTimeHours : null;
      const sla = ageHours == null ? null : ageHours < 24 ? "ontrack" : ageHours < 72 ? "atrisk" : "breached";
      const oldCode = (item.oldCode ?? item.assetCode ?? item.AssetCode ?? null) as string | null;
      const title = (item.informDetail ?? item.title ?? item.subject ?? item.description ?? item.location ?? null) as string | null;
      await supabaseAdmin.from("claims").upsert(
        {
          ticket_code: ticketCode,
          asset_old_code: oldCode,
          title,
          opened_at: openedAt,
          age_hours: ageHours,
          sla_status: sla,
          severity: (item.severity ?? item.status ?? null) as string | null,
          payload: item as never,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "ticket_code" },
      );
      n++;
    }
    await logFinish(id, "success", `synced ${n} claims`, n);
    return { ok: true, rows: n };
  } catch (e) {
    await logFinish(id, "error", (e as Error).message, 0);
    throw e;
  }
}

export async function runAssetHistorySync(oldCode: string) {
  const id = await logStart("asset");
  try {
    const tmpl = (await readSetting("asset_api_url")) as string | undefined;
    if (!tmpl) throw new Error("ยังไม่ได้ตั้งค่า asset_api_url");
    const url = tmpl.replace("{id}", encodeURIComponent(oldCode));
    const raw = await fetchPlanB(url);
    const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);
    const { data: asset } = await supabaseAdmin
      .from("assets")
      .upsert({ old_code: oldCode }, { onConflict: "old_code" })
      .select("id")
      .single();
    let n = 0;
    for (const item of list as Record<string, unknown>[]) {
      const ticket = String(item.ticketCode ?? item.TicketCode ?? item.id ?? "");
      if (!ticket) continue;
      const rawType = String(item.type ?? item.Type ?? "").toLowerCase();
      const type = rawType.includes("pm")
        ? "PM"
        : rawType.includes("claim")
          ? "Claim"
          : rawType.includes("monitor")
            ? "Monitor"
            : "AssetHealth";
      await supabaseAdmin.from("asset_history").upsert(
        {
          asset_id: asset?.id ?? null,
          asset_old_code: oldCode,
          ticket_code: ticket,
          type,
          title: (item.title ?? item.subject ?? null) as string | null,
          status: (item.status ?? null) as string | null,
          opened_at: (item.openedAt ?? item.createdAt ?? null) as string | null,
          closed_at: (item.closedAt ?? null) as string | null,
          payload: item as never,
        },
        { onConflict: "ticket_code,type" },
      );
      n++;
    }
    await logFinish(id, "success", `synced ${n} history rows for ${oldCode}`, n);
    return { ok: true, rows: n };
  } catch (e) {
    await logFinish(id, "error", (e as Error).message, 0);
    throw e;
  }
}
