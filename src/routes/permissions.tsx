import { createFileRoute } from "@tanstack/react-router";
import { Shield, UserPlus } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";

export const Route = createFileRoute("/permissions")({
  head: () => ({
    meta: [
      { title: "จัดการสิทธิ์ — Asset History 360" },
      { name: "description", content: "จัดการสิทธิ์การเข้าถึงเมนูของผู้ใช้งานแต่ละบทบาท" },
    ],
  }),
  component: PermissionsPage,
});

const menus = ["Dashboard", "ค้นหาประวัติ", "PM", "Claim", "Monitoring", "Asset Health", "Settings", "Permissions"];
const users = [
  { name: "Admin User", email: "admin@planb.co.th", role: "Admin", access: menus },
  { name: "สมชาย ใจดี", email: "somchai@planb.co.th", role: "หัวหน้าช่าง", access: ["Dashboard", "ค้นหาประวัติ", "PM", "Claim", "Monitoring"] },
  { name: "วิภาดา ผู้จัดการ", email: "wipada@planb.co.th", role: "Manager", access: ["Dashboard", "ค้นหาประวัติ", "Asset Health"] },
  { name: "ปรีชา ตรวจสอบ", email: "preecha@planb.co.th", role: "Audit", access: ["Dashboard", "ค้นหาประวัติ", "PM", "Claim", "Monitoring"] },
];

function PermissionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการสิทธิ์ผู้ใช้งาน"
        subtitle="กำหนดเมนูที่ผู้ใช้แต่ละคนเข้าถึงได้ — เฉพาะ Admin เข้าถึงได้ทุกเมนู"
        actions={
          <button className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90 transition">
            <UserPlus className="size-4" /> เพิ่มผู้ใช้
          </button>
        }
      />

      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">ผู้ใช้</th>
              <th className="text-left px-4 py-3">บทบาท</th>
              <th className="text-left px-4 py-3">เมนูที่เข้าถึงได้</th>
              <th className="text-right px-4 py-3">การจัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.email} className="hover:bg-accent/30">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold">
                      {u.name[0]}
                    </div>
                    <div>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={u.role === "Admin" ? "info" : "default"}>
                    <Shield className="inline size-3 mr-1" /> {u.role}
                  </Badge>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-1.5 max-w-md">
                    {u.access.length === menus.length ? (
                      <Badge tone="success">All menus</Badge>
                    ) : (
                      u.access.map((m) => (
                        <span key={m} className="rounded-md bg-muted px-2 py-0.5 text-xs">{m}</span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-4 py-3.5 text-right">
                  <button className="text-xs text-primary hover:underline">แก้ไขสิทธิ์</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
