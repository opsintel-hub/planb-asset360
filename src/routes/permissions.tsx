import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Shield, ShieldCheck, Key } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import {
  listUsersWithRoles,
  setUserRole,
  claimFirstAdmin,
  getMyRoles,
  getRoleMenuPermissions,
  setRoleMenuPermissions,
  adminResetUserPassword,
} from "@/lib/admin.functions";
import { MENU_LABEL, APP_MENUS } from "@/lib/app-menus";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/permissions")({
  head: () => ({
    meta: [
      { title: "จัดการสิทธิ์ — Asset History 360" },
      { name: "description", content: "จัดการสิทธิ์การเข้าถึงของผู้ใช้งานแต่ละบทบาท" },
    ],
  }),
  component: PermissionsPage,
});

const ROLES = ["admin", "manager", "technician", "sale", "crm", "production"] as const;
type Role = (typeof ROLES)[number];


function PermissionsPage() {
  const myRolesFn = useServerFn(getMyRoles);
  const listFn = useServerFn(listUsersWithRoles);
  const claimFn = useServerFn(claimFirstAdmin);
  const setFn = useServerFn(setUserRole);
  const permsFn = useServerFn(getRoleMenuPermissions);
  const setPermsFn = useServerFn(setRoleMenuPermissions);
  const resetPwFn = useServerFn(adminResetUserPassword);
  const qc = useQueryClient();

  const myRolesQ = useQuery({ queryKey: ["my-roles"], queryFn: () => myRolesFn({}) });
  const isAdmin = myRolesQ.data?.roles.includes("admin") ?? false;

  const listQ = useQuery({
    queryKey: ["users-roles"],
    queryFn: () => listFn({}),
    enabled: isAdmin,
  });

  const permsQ = useQuery({
    queryKey: ["role-menu-perms"],
    queryFn: () => permsFn({}),
    enabled: isAdmin,
  });

  const claimMutation = useMutation({
    mutationFn: () => claimFn({}),
    onSuccess: () => {
      toast.success("คุณคือผู้ดูแลระบบคนแรกแล้ว");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setMutation = useMutation({
    mutationFn: (v: { user_id: string; role: Role; grant: boolean }) => setFn({ data: v }),
    onSuccess: () => {
      toast.success("บันทึกสิทธิ์แล้ว");
      qc.invalidateQueries({ queryKey: ["users-roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setPermsMutation = useMutation({
    mutationFn: (perms: Record<string, string[]>) => setPermsFn({ data: { permissions: perms } }),
    onSuccess: () => {
      toast.success("บันทึกสิทธิ์เมนูเรียบร้อย");
      qc.invalidateQueries({ queryKey: ["my-menu-access"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["role-menu-perms"] });
    },
  });

  const resetPwMutation = useMutation({
    mutationFn: (v: { user_id: string; new_password: string }) => resetPwFn({ data: v }),
    onSuccess: () => toast.success("รีเซ็ตรหัสผ่านเรียบร้อย"),
    onError: (e: Error) => toast.error(e.message),
  });

  // Menus come from the server (single source of truth) so future menus appear
  // here automatically; admin-only menus are not grantable.
  const adminOnly = new Set(APP_MENUS.filter((m) => m.adminOnly).map((m) => m.to));
  const menus = (permsQ.data?.menus ?? []).filter((m) => !adminOnly.has(m));
  const perms = permsQ.data?.permissions ?? {};

  const togglePerm = (role: string, menu: string) => {
    // Read latest from cache (avoids stale closure when toggling rapidly).
    const latest =
      qc.getQueryData<{ permissions: Record<string, string[]>; menus: string[] }>(["role-menu-perms"])?.permissions ?? perms;
    const cur = new Set(latest[role] ?? []);
    if (cur.has(menu)) cur.delete(menu);
    else cur.add(menu);
    const next = { ...latest, [role]: Array.from(cur) };
    // Optimistic: update cache so the checkbox reflects intent immediately.
    qc.setQueryData(["role-menu-perms"], (prev: { permissions: Record<string, string[]>; menus: string[] } | undefined) =>
      prev ? { ...prev, permissions: next } : prev,
    );
    setPermsMutation.mutate(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการสิทธิ์ผู้ใช้งาน"
        subtitle="กำหนดบทบาท Admin / Manager / Technician / Sale และสิทธิ์การเข้าเมนู"
        actions={
          !isAdmin && !myRolesQ.isLoading ? (
            <button
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              <ShieldCheck className="size-4" /> ขอเป็น Admin คนแรก
            </button>
          ) : null
        }
      />

      {!isAdmin ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          คุณยังไม่มีสิทธิ์ผู้ดูแลระบบ — หากเป็นผู้ใช้งานคนแรกของระบบ คลิก "ขอเป็น Admin คนแรก" ด้านบน
        </div>
      ) : (
        <>
          {/* Menu permissions per role */}
          <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold">สิทธิ์เข้าเมนูของแต่ละบทบาท</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                แถว = เมนู · คอลัมน์ = บทบาท · ติ๊ก = บทบาทนั้นเห็นเมนูนี้ · Admin เห็นทุกเมนูเสมอ
              </p>
            </div>
            {permsQ.isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-3 sticky left-0 bg-muted/50 z-10">เมนู</th>
                      <th className="text-center px-3 py-3">
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Shield className="size-3" /> admin
                        </span>
                      </th>
                      {(["manager", "technician", "sale", "crm", "production"] as const).map((role) => (
                        <th key={role} className="text-center px-3 py-3 capitalize">{role}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {menus.map((menu) => (
                      <tr key={menu} className="hover:bg-accent/30">
                        <td className="px-4 py-3 font-medium sticky left-0 bg-card z-10">
                          {MENU_LABEL[menu] ?? menu}
                          <div className="text-[11px] text-muted-foreground font-normal mt-0.5">{menu}</div>
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-muted-foreground">✓</td>
                        {(["manager", "technician", "sale", "crm", "production"] as const).map((role) => {
                          const has = (perms[role] ?? []).includes(menu);
                          return (
                            <td key={role} className="px-3 py-3 text-center">
                              <label className="inline-flex items-center justify-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={has}
                                  disabled={setPermsMutation.isPending}
                                  onChange={() => togglePerm(role, menu)}
                                  className="size-4"
                                  aria-label={`${role} เห็น ${MENU_LABEL[menu] ?? menu}`}
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Users list */}
          <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
            {listQ.isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">ผู้ใช้</th>
                    <th className="text-left px-4 py-3">บทบาทปัจจุบัน</th>
                    <th className="text-left px-4 py-3">กำหนดสิทธิ์</th>
                    <th className="text-left px-4 py-3">รหัสผ่าน</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(listQ.data?.users ?? []).map((u) => (
                    <UserRow
                      key={u.user_id}
                      user={u}
                      onToggleRole={(role, grant) =>
                        setMutation.mutate({ user_id: u.user_id, role, grant })
                      }
                      onResetPassword={(pw) =>
                        resetPwMutation.mutate({ user_id: u.user_id, new_password: pw })
                      }
                      isPending={setMutation.isPending || resetPwMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function UserRow({
  user,
  onToggleRole,
  onResetPassword,
  isPending,
}: {
  user: { user_id: string; email: string | null; display_name: string | null; roles: string[] };
  onToggleRole: (role: Role, grant: boolean) => void;
  onResetPassword: (pw: string) => void;
  isPending: boolean;
}) {
  const [showReset, setShowReset] = useState(false);
  const [pw, setPw] = useState("");

  return (
    <tr className="hover:bg-accent/30 align-top">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold">
            {(user.display_name ?? user.email ?? "?")[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-medium">{user.display_name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex flex-wrap gap-1.5">
          {user.roles.length === 0 ? (
            <span className="text-xs text-muted-foreground">ยังไม่มีบทบาท</span>
          ) : (
            user.roles.map((r) => (
              <Badge key={r} tone={r === "admin" ? "info" : "default"}>
                <Shield className="inline size-3 mr-1" /> {r}
              </Badge>
            ))
          )}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => {
            const has = user.roles.includes(r);
            return (
              <button
                key={r}
                onClick={() => onToggleRole(r, !has)}
                disabled={isPending}
                className={
                  has
                    ? "rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                    : "rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                }
              >
                {has ? `− ${r}` : `+ ${r}`}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-4 py-3.5">
        {!showReset ? (
          <button
            onClick={() => setShowReset(true)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            <Key className="size-3" /> รีเซ็ตรหัสผ่าน
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="รหัสใหม่ (≥8 ตัว)"
              className="h-7 w-36 rounded border bg-background px-2 text-xs"
            />
            <button
              onClick={() => {
                if (pw.length < 8) {
                  toast.error("รหัสต้องมีอย่างน้อย 8 ตัว");
                  return;
                }
                onResetPassword(pw);
                setShowReset(false);
                setPw("");
              }}
              disabled={isPending}
              className="rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs hover:opacity-90 disabled:opacity-50"
            >
              บันทึก
            </button>
            <button
              onClick={() => {
                setShowReset(false);
                setPw("");
              }}
              className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
            >
              ยกเลิก
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
