// Current user's roles (read from public.user_roles — RLS allows self-select).
// Used purely for UI gating; server-side access control stays in RLS/policies.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type AppRole =
  | "admin"
  | "manager"
  | "technician"
  | "viewer"
  | "sale"
  | "crm"
  | "production";

/** Roles that should not see maintenance-oriented signals (repair / risk). */
const COMMERCIAL_ONLY: AppRole[] = ["sale", "crm"];

export function useMyRoles() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["my-roles", user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });

  const roles = data ?? [];
  const hasRole = (r: AppRole) => roles.includes(r);
  const isCommercialOnly =
    roles.length > 0 && roles.every((r) => COMMERCIAL_ONLY.includes(r));

  return {
    roles,
    hasRole,
    isLoading,
    /** Sale/CRM-only accounts hide repair status & risk colouring. */
    canSeeMaintenance: !isCommercialOnly,
  };
}
