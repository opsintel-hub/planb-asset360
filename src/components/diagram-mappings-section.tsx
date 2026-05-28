import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, FileDown, FileUp, Save, Tag } from "lucide-react";
import { toast } from "sonner";
import { listDiagramMappings } from "@/lib/data.functions";
import {
  upsertDiagramMapping, deleteDiagramMapping, replaceDiagramMappings,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui-bits";

type MappingRow = {
  id: string; category: string; label: string; icon: string | null;
  keywords: string[]; sort_order: number; enabled: boolean;
};

const ICON_OPTIONS = ["Monitor", "Zap", "Building", "Cpu", "Wrench", "Activity", "AlertTriangle", "Clock", "Tag"];

function toCsv(rows: MappingRow[]): string {
  const head = ["category", "label", "icon", "keywords", "sort_order", "enabled"];
  const esc = (s: unknown) => {
    const v = s == null ? "" : String(s);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      esc(r.category), esc(r.label), esc(r.icon ?? ""),
      esc((r.keywords ?? []).join("|")),
      esc(r.sort_order ?? 0), esc(r.enabled ? "true" : "false"),
    ].join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

function parseCsv(text: string): Partial<MappingRow>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  // simple CSV parser supporting quoted fields
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === ",") { out.push(cur); cur = ""; }
        else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const lines = clean.split("\n").filter((l) => l.trim());
  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: Partial<MappingRow>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = (cols[j] ?? "").trim(); });
    if (!obj.category) continue;
    rows.push({
      category: obj.category,
      label: obj.label || obj.category,
      icon: obj.icon || null,
      keywords: (obj.keywords || "").split(/[|;,]/).map((s) => s.trim()).filter(Boolean),
      sort_order: Number(obj.sort_order) || i,
      enabled: /^(true|1|yes|y)$/i.test(obj.enabled || "true"),
    });
  }
  return rows;
}

export function DiagramMappingsSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDiagramMappings);
  const upsertFn = useServerFn(upsertDiagramMapping);
  const deleteFn = useServerFn(deleteDiagramMapping);
  const replaceFn = useServerFn(replaceDiagramMappings);

  const { data, isLoading } = useQuery({
    queryKey: ["diagram-mappings"],
    queryFn: () => listFn({}),
  });
  const rows = (data?.mappings ?? []) as MappingRow[];

  type MappingInput = {
    id?: string; category: string; label: string; icon?: string | null;
    keywords: string[]; sort_order?: number; enabled?: boolean;
  };

  const upsertMut = useMutation({
    mutationFn: (input: MappingInput) => upsertFn({ data: input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diagram-mappings"] }); toast.success("บันทึกแล้ว"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diagram-mappings"] }); toast.success("ลบแล้ว"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const replaceMut = useMutation({
    mutationFn: (rows: MappingInput[]) => replaceFn({ data: { rows } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["diagram-mappings"] }); toast.success(`Import สำเร็จ ${r.count} รายการ`); },
    onError: (e: Error) => toast.error(e.message),
  });

  // local form
  const [editing, setEditing] = useState<Partial<MappingRow> | null>(null);
  const [kwInput, setKwInput] = useState("");

  function startEdit(r?: MappingRow) {
    setEditing(r ? { ...r } : { category: "", label: "", icon: "Tag", keywords: [], sort_order: (rows.at(-1)?.sort_order ?? 0) + 1, enabled: true });
    setKwInput("");
  }
  function addKeyword() {
    const k = kwInput.trim();
    if (!k || !editing) return;
    const next = new Set([...(editing.keywords ?? []), k]);
    setEditing({ ...editing, keywords: Array.from(next) });
    setKwInput("");
  }
  function removeKeyword(k: string) {
    if (!editing) return;
    setEditing({ ...editing, keywords: (editing.keywords ?? []).filter((x) => x !== k) });
  }
  function saveForm() {
    if (!editing) return;
    if (!editing.category || !/^[a-z0-9_-]+$/.test(editing.category)) {
      toast.error("category ใช้ได้เฉพาะ a-z 0-9 _ -");
      return;
    }
    if (!editing.label) { toast.error("กรุณาใส่ label"); return; }
    upsertMut.mutate({
      id: editing.id,
      category: editing.category,
      label: editing.label,
      icon: editing.icon ?? null,
      keywords: editing.keywords ?? [],
      sort_order: editing.sort_order ?? 0,
      enabled: editing.enabled ?? true,
    });
    setEditing(null);
  }

  function handleExport() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `diagram-mappings-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      if (!parsed.length) { toast.error("ไม่พบข้อมูลใน CSV"); return; }
      if (!confirm(`Import จะลบข้อมูลเดิมทั้งหมดและแทนที่ด้วย ${parsed.length} รายการ — ยืนยันหรือไม่?`)) return;
      replaceMut.mutate({ rows: parsed as Parameters<typeof replaceFn>[0]["data"]["rows"] });
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold">Diagram Mappings</h3>
          <p className="text-xs text-muted-foreground">เกณฑ์จำแนกหมวดปัญหาใน Breakdown Tab — แก้ keywords ที่นี่จะปรับการจัดกลุ่มใน Interactive Asset Diagram ทันที</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!rows.length}>
            <FileDown className="size-4 mr-1" /> Export CSV
          </Button>
          <label className="inline-flex">
            <Button size="sm" variant="outline" asChild>
              <span className="cursor-pointer"><FileUp className="size-4 mr-1" /> Import CSV</span>
            </Button>
            <input
              type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }}
            />
          </label>
          <Button size="sm" onClick={() => startEdit()}>
            <Plus className="size-4 mr-1" /> เพิ่มหมวด
          </Button>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล — กด "เพิ่มหมวด" หรือ Import CSV</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left p-2">ลำดับ</th>
                <th className="text-left p-2">Category</th>
                <th className="text-left p-2">Label</th>
                <th className="text-left p-2">Keywords</th>
                <th className="text-left p-2">สถานะ</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-accent/30">
                  <td className="p-2 tabular-nums w-12">{r.sort_order}</td>
                  <td className="p-2 font-mono text-xs">{r.category}</td>
                  <td className="p-2">{r.label}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1 max-w-[420px]">
                      {r.keywords.slice(0, 8).map((k) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          <Tag className="size-3" />{k}
                        </span>
                      ))}
                      {r.keywords.length > 8 && (
                        <span className="text-[11px] text-muted-foreground">+{r.keywords.length - 8}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    <Badge tone={r.enabled ? "success" : "default"}>{r.enabled ? "เปิด" : "ปิด"}</Badge>
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>แก้ไข</Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`ลบหมวด "${r.category}" ?`)) deleteMut.mutate(r.id); }}>
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold">{editing.id ? "แก้ไขหมวด" : "เพิ่มหมวดใหม่"}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Category (key) <span className="text-destructive">*</span></label>
              <Input
                value={editing.category ?? ""}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, category: e.target.value.toLowerCase() })}
                placeholder="display"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Label (ชื่อแสดง) <span className="text-destructive">*</span></label>
              <Input
                value={editing.label ?? ""}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="Display / Screen"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Icon</label>
              <select
                value={editing.icon ?? ""}
                onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm"
              >
                {ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ลำดับการแสดง</label>
              <Input
                type="number"
                value={editing.sort_order ?? 0}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Keywords (กด Enter เพื่อเพิ่ม)</label>
            <div className="flex gap-2 mt-1">
              <Input
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                placeholder="display, จอ, led..."
              />
              <Button type="button" variant="outline" onClick={addKeyword}>เพิ่ม</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(editing.keywords ?? []).map((k) => (
                <button
                  key={k}
                  onClick={() => removeKeyword(k)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-destructive/20"
                  title="คลิกเพื่อลบ"
                >
                  {k} <Trash2 className="size-3" />
                </button>
              ))}
              {!(editing.keywords ?? []).length && (
                <span className="text-xs text-muted-foreground">ยังไม่มี keyword — เพิ่มอย่างน้อย 1 คำ</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="map-enabled" type="checkbox"
              checked={editing.enabled ?? true}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
            />
            <label htmlFor="map-enabled" className="text-sm">เปิดใช้งาน</label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>ยกเลิก</Button>
            <Button onClick={saveForm} disabled={upsertMut.isPending}>
              <Save className="size-4 mr-1" /> บันทึก
            </Button>
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        รูปแบบ CSV: <code className="font-mono">category,label,icon,keywords,sort_order,enabled</code> — keywords คั่นด้วย <code>|</code> (เช่น <code>display|จอ|led</code>)
      </div>
    </div>
  );
}
