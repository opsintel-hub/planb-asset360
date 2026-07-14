import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sliders, RotateCcw, Save, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAppSettings } from "@/lib/data.functions";
import { updateAppSetting } from "@/lib/admin.functions";
import {
  BUCKET_KEYS,
  BUCKET_LABELS,
  DEFAULT_ANALYTICS_WEIGHTS,
  DEMOGRAPHIC_LABELS,
  ROAD_LABELS,
  mergeAnalyticsWeights,
  type AnalyticsWeights,
  type BucketKey,
  type DemographicKey,
  type RoadClass,
} from "@/lib/analytics-weights-defaults";

const DEM_KEYS = Object.keys(DEMOGRAPHIC_LABELS) as DemographicKey[];
const ROAD_KEYS = Object.keys(ROAD_LABELS) as RoadClass[];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function AnalyticsWeightsSettings() {
  const settingsFn = useServerFn(getAppSettings);
  const updateFn = useServerFn(updateAppSetting);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsFn({}),
  });

  const stored = useMemo<AnalyticsWeights>(
    () => mergeAnalyticsWeights(data?.settings?.analytics_weights),
    [data],
  );

  const [weights, setWeights] = useState<AnalyticsWeights>(clone(DEFAULT_ANALYTICS_WEIGHTS));

  useEffect(() => {
    setWeights(clone(stored));
  }, [stored]);

  const isDirty = useMemo(
    () => JSON.stringify(weights) !== JSON.stringify(stored),
    [weights, stored],
  );

  const saveMutation = useMutation({
    mutationFn: () => updateFn({ data: { key: "analytics_weights", value: weights } }),
    onSuccess: () => {
      toast.success("บันทึกน้ำหนัก Analytics แล้ว");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDem = (bucket: BucketKey, dem: DemographicKey, value: number) => {
    setWeights((w) => {
      const next = clone(w);
      const row = { ...(next.demographics[bucket] ?? {}) };
      if (value === 0) delete row[dem];
      else row[dem] = value;
      next.demographics[bucket] = row;
      return next;
    });
  };

  const setRoad = (cls: RoadClass, value: number) => {
    setWeights((w) => ({ ...w, road: { ...w.road, [cls]: value } }));
  };

  const setImpressions = (which: "min" | "max", value: number) => {
    setWeights((w) => ({ ...w, impressions: { ...w.impressions, [which]: value } }));
  };

  const setPeak = (dem: DemographicKey, idx: 0 | 1, value: string) => {
    setWeights((w) => {
      const next = clone(w);
      const cur = next.peaks[dem];
      cur[idx] = value;
      next.peaks[dem] = cur;
      return next;
    });
  };

  const resetAll = () => {
    setWeights(clone(DEFAULT_ANALYTICS_WEIGHTS));
    toast.info("คืนค่าเริ่มต้นทั้งหมด — กด \"บันทึก\" เพื่อยืนยัน");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Sliders className="size-5" />
              </div>
              <div>
                <CardTitle>Analytics Weights</CardTitle>
                <CardDescription>
                  ปรับน้ำหนักการวิเคราะห์ป้ายโฆษณา — Traffic Score, กลุ่มเป้าหมาย (Demographics), ช่วงพีค และประมาณการยอดเห็นต่อวัน
                  ไม่ใช้ AI แต่คำนวณจากข้อมูล OpenStreetMap โดยตรง
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={resetAll} disabled={isLoading}>
                <RotateCcw className="mr-1.5 size-4" /> คืนค่าเริ่มต้น
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
        <CardContent>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            {isDirty ? (
              <Badge variant="destructive">ยังไม่บันทึก</Badge>
            ) : (
              <Badge variant="secondary">ตรงกับที่บันทึกไว้</Badge>
            )}
            <span className="text-muted-foreground flex items-center gap-1">
              <Info className="size-3" /> ค่าที่แก้จะมีผลกับการวิเคราะห์ทุกป้ายภายใน 1 นาที (มี cache)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Demographics matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">น้ำหนักกลุ่มเป้าหมาย (Demographics)</CardTitle>
          <CardDescription>
            แต่ละหมวด POI ให้คะแนนกลุ่มเป้าหมายกี่คะแนน (0–10) — สูตร: หมวดที่พบ × น้ำหนัก → normalize เป็น %
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-3 font-medium">หมวด POI</th>
                {DEM_KEYS.map((k) => (
                  <th key={k} className="text-center py-2 px-1 font-medium">
                    {DEMOGRAPHIC_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BUCKET_KEYS.map((b) => (
                <tr key={b} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{BUCKET_LABELS[b]}</td>
                  {DEM_KEYS.map((k) => {
                    const v = weights.demographics[b]?.[k] ?? 0;
                    return (
                      <td key={k} className="py-1 px-1 text-center">
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          step={1}
                          value={v}
                          onChange={(e) => setDem(b, k, Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                          className="h-8 w-16 text-center text-xs mx-auto"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Road weights + Impressions */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">น้ำหนักถนน → Traffic Score</CardTitle>
            <CardDescription>สูตร: Σ (น้ำหนัก × min(จำนวนถนนคลาสนั้น, 3)) + โบนัส POI × 0.5</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ROAD_KEYS.map((cls) => (
              <div key={cls} className="grid grid-cols-[1fr_100px] items-center gap-2">
                <Label className="text-sm">{ROAD_LABELS[cls]}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={weights.road[cls]}
                  onChange={(e) => setRoad(cls, Math.max(0, Number(e.target.value) || 0))}
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Impressions/day (ตัวคูณ)</CardTitle>
            <CardDescription>Impressions = Traffic Score × ตัวคูณ (min, max)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[1fr_120px] items-center gap-2">
              <Label>ตัวคูณต่ำสุด (min)</Label>
              <Input
                type="number"
                min={0}
                value={weights.impressions.min}
                onChange={(e) => setImpressions("min", Math.max(0, Number(e.target.value) || 0))}
                className="h-8 text-xs"
              />
            </div>
            <div className="grid grid-cols-[1fr_120px] items-center gap-2">
              <Label>ตัวคูณสูงสุด (max)</Label>
              <Input
                type="number"
                min={0}
                value={weights.impressions.max}
                onChange={(e) => setImpressions("max", Math.max(0, Number(e.target.value) || 0))}
                className="h-8 text-xs"
              />
            </div>
            <div className="text-xs text-muted-foreground pt-1 border-t">
              ตัวอย่าง: Traffic 80 × {weights.impressions.min}–{weights.impressions.max} ={" "}
              <b>{(80 * weights.impressions.min).toLocaleString()}</b>–
              <b>{(80 * weights.impressions.max).toLocaleString()}</b> ครั้ง/วัน
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Peak hours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ช่วงเวลาที่คนหนาแน่น (Peak Hours)</CardTitle>
          <CardDescription>เลือกตามกลุ่มเป้าหมายที่มีสัดส่วนสูงสุด (dominant demographic)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {DEM_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-[1fr_140px_140px] items-center gap-2">
              <Label className="text-sm">{DEMOGRAPHIC_LABELS[k]}</Label>
              <Input
                value={weights.peaks[k][0]}
                onChange={(e) => setPeak(k, 0, e.target.value)}
                placeholder="เช่น 07:30–09:30"
                className="h-8 text-xs"
              />
              <Input
                value={weights.peaks[k][1]}
                onChange={(e) => setPeak(k, 1, e.target.value)}
                placeholder="เช่น 17:00–19:00"
                className="h-8 text-xs"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
