import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { isAllowedEmail, ALLOWED_EMAIL_DOMAIN } from "@/lib/authDomain";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    // ชั้นกัน global: session ใดที่อีเมลไม่ใช่โดเมนบริษัท ให้ sign out ทันที
    // (ครอบคลุมทั้ง Google และอีเมล/รหัสผ่าน ไม่ว่าจะ login จากจุดไหน)
    const enforceDomain = (s: Session | null): Session | null => {
      if (s?.user && !isAllowedEmail(s.user.email)) {
        toast.error(`อนุญาตเฉพาะอีเมลบริษัท @${ALLOWED_EMAIL_DOMAIN} เท่านั้น`);
        void supabase.auth.signOut();
        return null;
      }
      return s;
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(enforceDomain(s));
      qc.invalidateQueries();
      router.invalidate();
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(enforceDomain(data.session));
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [qc, router]);

  return (
    <AuthCtx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
