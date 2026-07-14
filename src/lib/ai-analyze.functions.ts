import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_PROMPT_SEGMENTS, DEFAULT_MODEL, buildSystemPrompt } from "./ai-prompts-defaults";

const InputSchema = z.object({
  context: z.string().min(1).max(20000),
});

export const aiAnalyzeAssets = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Load user-editable prompt overrides + model choice from app_settings.
    let overrides: Record<string, string> = {};
    let model = DEFAULT_MODEL;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "ai_prompts")
        .maybeSingle();
      const value = (row?.value ?? {}) as { segments?: Record<string, string>; model?: string };
      if (value.segments && typeof value.segments === "object") {
        for (const seg of AI_PROMPT_SEGMENTS) {
          const v = value.segments[seg.key];
          if (typeof v === "string" && v.trim()) overrides[seg.key] = v;
        }
      }
      if (typeof value.model === "string" && value.model.trim()) model = value.model.trim();
    } catch {
      // fallback to defaults if settings unavailable
      overrides = {};
    }

    const systemPrompt = buildSystemPrompt(overrides);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: data.context },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI ถูกจำกัดการเรียก กรุณาลองใหม่ภายหลัง");
      if (res.status === 402) throw new Error("เครดิต AI หมด — กรุณาเติมเครดิตที่ Workspace Settings");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { text: json.choices?.[0]?.message?.content ?? "ไม่มีคำตอบ" };
  });
