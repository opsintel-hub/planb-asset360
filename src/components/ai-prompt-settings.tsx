import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, RotateCcw, Save, Eye, EyeOff, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getAppSettings } from "@/lib/data.functions";
import { updateAppSetting } from "@/lib/admin.functions";
import {
  AI_PROMPT_SEGMENTS,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  buildSystemPrompt,
} from "@/lib/ai-prompts-defaults";

type StoredValue = { segments?: Record<string, string>; model?: string };

export function AiPromptSettings() {
  const settingsFn = useServerFn(getAppSettings);
  const updateFn = useServerFn(updateAppSetting);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsFn({}),
  });

  const stored = (data?.settings?.ai_prompts ?? {}) as StoredValue;

  const [segments, setSegments] = useState<Record<string, string>>({});
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [showPreview, setShowPreview] = useState(false);

  // hydrate local state when server data arrives
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const s of AI_PROMPT_SEGMENTS) {
      seeded[s.key] = stored.segments?.[s.key] ?? s.content;
    }
    setSegments(seeded);
    setModel(stored.model ?? DEFAULT_MODEL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof AI_PROMPT_SEGMENTS>();
    for (const s of AI_PROMPT_SEGMENTS) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return Array.from(map.entries());
  }, []);

  const isDirty = useMemo(() => {
    if ((stored.model ?? DEFAULT_MODEL) !== model) return true;
    for (const s of AI_PROMPT_SEGMENTS) {
      const cur = segments[s.key] ?? "";
      const orig = stored.segments?.[s.key] ?? s.content;
      if (cur !== orig) return true;
    }
    return false;
  }, [segments, model, stored]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateFn({ data: { key: "ai_prompts", value: { segments, model } } }),
    onSuccess: () => {
      toast.success("บันทึกการตั้งค่า AI แล้ว");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetAll = () => {
    const seeded: Record<string, string> = {};
    for (const s of AI_PROMPT_SEGMENTS) seeded[s.key] = s.content;
    setSegments(seeded);
    setModel(DEFAULT_MODEL);
    toast.info("ล้างค่ากลับเป็นค่าเริ่มต้นแล้ว — กด \"บันทึก\" เพื่อยืนยัน");
  };

  const resetOne = (key: string) => {
    const def = AI_PROMPT_SEGMENTS.find((s) => s.key === key)?.content ?? "";
    setSegments((prev) => ({ ...prev, [key]: def }));
  };

  const finalPrompt = useMemo(() => buildSystemPrompt(segments), [segments]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Bot className="size-5" />
              </div>
              <div>
                <CardTitle>AI Prompt & Model</CardTitle>
                <CardDescription>
                  ปรับแต่งบทบาท / โทนภาษา / โครงสร้างผลลัพธ์ ที่ AI ใช้วิเคราะห์ข้อมูลป้ายโฆษณา
                  — บันทึกครั้งเดียว มีผลทันทีทุกที่ที่เรียกใช้ AI
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={resetAll} disabled={isLoading}>
                <RotateCcw className="mr-1.5 size-4" /> คืนค่าเริ่มต้นทั้งหมด
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!isDirty || saveMutation.isPending}
              >
                <Save className="mr-1.5 size-4" />
                {saveMutation.isPending ? "กำลังบันทึก..." : isDirty ? "บันทึก" : "บันทึกแล้ว"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" /> โมเดล AI ที่ใช้
            </Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    <div className="flex flex-col">
                      <span className="font-medium">{m.label}</span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>สถานะ</Label>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {isDirty ? (
                <Badge variant="destructive">ยังไม่บันทึก</Badge>
              ) : (
                <Badge variant="secondary">ตรงกับที่บันทึกไว้</Badge>
              )}
              <span className="text-muted-foreground">
                {AI_PROMPT_SEGMENTS.length} ช่อง · แบ่งเป็น {grouped.length} หมวด
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      {grouped.map(([category, items]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-base">{category}</CardTitle>
            <CardDescription>
              {category === "บทบาท & โทน"
                ? "กำหนดว่า AI คือใคร และควรตอบด้วยภาษา/สไตล์แบบไหน"
                : "แต่ละช่องคือ 1 หัวข้อในคำตอบของ AI สามารถแก้หัวเรื่อง หรือคำสั่งภายในได้"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {items.map((seg) => {
              const value = segments[seg.key] ?? "";
              const isDefault =
                value === seg.content && !(stored.segments && seg.key in stored.segments);
              return (
                <div key={seg.key} className="space-y-2 rounded-lg border bg-card/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Label className="text-sm font-medium">{seg.label}</Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">{seg.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isDefault ? (
                        <Badge variant="outline" className="text-[10px]">ค่าเริ่มต้น</Badge>
                      ) : (
                        <Badge className="text-[10px]">แก้ไขแล้ว</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetOne(seg.key)}
                        className="h-7 px-2 text-xs"
                      >
                        <RotateCcw className="mr-1 size-3" /> คืนค่า
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={value}
                    onChange={(e) =>
                      setSegments((prev) => ({ ...prev, [seg.key]: e.target.value }))
                    }
                    rows={seg.category === "บทบาท & โทน" ? 3 : 5}
                    className="font-mono text-xs leading-relaxed"
                    placeholder={seg.content}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/* Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">ตัวอย่าง System Prompt สุดท้าย</CardTitle>
              <CardDescription>
                คือข้อความที่จะส่งเข้า AI จริง (ประกอบจากทุกช่องข้างบน)
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? (
                <><EyeOff className="mr-1.5 size-4" /> ซ่อน</>
              ) : (
                <><Eye className="mr-1.5 size-4" /> แสดง</>
              )}
            </Button>
          </div>
        </CardHeader>
        {showPreview && (
          <CardContent>
            <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
              {finalPrompt}
            </pre>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
