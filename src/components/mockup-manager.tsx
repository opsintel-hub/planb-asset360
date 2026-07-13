import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, Trash2, Check, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listBillboardMockups,
  createBillboardMockup,
  deleteBillboardMockup,
  type BillboardMockup,
} from "@/lib/billboard-mockups.functions";

type Props = {
  oldCode: string;
  selectedId: string | null;
  onSelect: (mockup: BillboardMockup | null) => void;
};

export default function MockupManager({ oldCode, selectedId, onSelect }: Props) {
  const listFn = useServerFn(listBillboardMockups);
  const createFn = useServerFn(createBillboardMockup);
  const deleteFn = useServerFn(deleteBillboardMockup);
  const [mockups, setMockups] = useState<BillboardMockup[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const items = await listFn({ data: { oldCode } });
      setMockups(items);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldCode]);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("รองรับเฉพาะไฟล์รูปภาพ");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 5MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${oldCode}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("billboard-mockups")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const created = await createFn({
        data: { oldCode, storagePath: path, title: file.name },
      });
      toast.success("อัปโหลดสำเร็จ");
      await refresh();
      onSelect(created);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("ลบ Mockup นี้?")) return;
    try {
      await deleteFn({ data: { id } });
      if (selectedId === id) onSelect(null);
      await refresh();
      toast.success("ลบแล้ว");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void handleFile(f);
        }}
        className="border-2 border-dashed rounded-md p-4 text-center hover:bg-accent/30 transition-colors"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? "กำลังอัปโหลด..." : "เลือก / ลากภาพ Mockup โฆษณา"}
        </button>
        <div className="text-[11px] text-muted-foreground mt-1">
          รองรับ .png .jpg .webp — ไม่เกิน 5MB
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin mr-2" /> กำลังโหลด...
        </div>
      ) : mockups.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-2 flex items-center justify-center gap-1">
          <ImageIcon className="size-3" /> ยังไม่มี Mockup สำหรับป้ายนี้
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {mockups.map((m) => (
            <div
              key={m.id}
              className={`relative rounded-md border overflow-hidden group cursor-pointer transition-all ${
                selectedId === m.id ? "ring-2 ring-primary border-primary" : "hover:border-primary/50"
              }`}
              onClick={() => onSelect(m)}
            >
              <img src={m.image_url} alt={m.title ?? ""} className="w-full h-20 object-cover" />
              {selectedId === m.id && (
                <div className="absolute top-1 left-1 bg-primary text-primary-foreground rounded-full p-0.5">
                  <Check className="size-3" />
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(m.id);
                }}
                className="absolute top-1 right-1 bg-destructive/90 text-destructive-foreground rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="ลบ"
              >
                <Trash2 className="size-3" />
              </button>
              {m.title && (
                <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
                  {m.title}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
