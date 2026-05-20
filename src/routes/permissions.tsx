import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shield, ShieldCheck } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui-bits";
import { listUsersWithRoles, setUserRole, claimFirstAdmin, getMyRoles } from "@/lib/admin.functions";
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

const ROLES = ["admin", "manager", "technician", "viewer"] as const;
type Role = typeof ROLES[number];

function PermissionsPage() {
  const myRolesFn = useServerFn(getMyRoles);
  const listFn = useServerFn(listUsersWithRoles);
  const claimFn = useServerFn(claimFirstAdmin);
  const setFn = useServerFn(setUserRole);
  const qc = useQueryClient();

  const myRolesQ = useQuery({ queryKey: ["my-roles"], queryFn: () => myRolesFn({}) });
  const isAdmin = myRolesQ.data?.roles.includes("admin") ?? false;

  const listQ = useQuery({
    queryKey: ["users-roles"],
    queryFn: () => listFn({}),
    enabled: isAdmin,
  });

  const claimMutation = useMutation({
    mutationFn: () => claimFn({}),
    onSuccess: () => { toast.success("คุณคือผู้ดูแลระบบคนแรกแล้ว"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setMutation = useMutation({
    mutationFn: (v: { user_id: string; role: Role; grant: boolean }) => setFn({ data: v }),
    onSuccess: () => { toast.success("บันทึกสิทธิ์แล้ว"); qc.invalidateQueries({ queryKey: ["users-roles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการสิทธิ์ผู้ใช้งาน"
        subtitle="กำหนดบทบาท Admin / Manager / Technician / Viewer ให้ผู้ใช้งาน"
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
        <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          {listQ.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">ผู้ใช้</th>
                  <th className="text-left px-4 py-3">บทบาทปัจจุบัน</th>
                  <th className="text-left px-4 py-3">กำหนดสิทธิ์</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(listQ.data?.users ?? []).map((u) => (
                  <tr key={u.user_id} className="hover:bg-accent/30">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold">
                          {(u.display_name ?? u.email ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{u.display_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {u.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">ยังไม่มีบทบาท</span>
                        ) : (
                          u.roles.map((r) => (
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
                          const has = u.roles.includes(r);
                          return (
                            <button
                              key={r}
                              onClick={() => setMutation.mutate({ user_id: u.user_id, role: r, grant: !has })}
                              disabled={setMutation.isPending}
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
