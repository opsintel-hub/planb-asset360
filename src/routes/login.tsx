import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

/** โดเมนอีเมลบริษัทที่อนุญาตให้เข้าสู่ระบบด้วย Google (เช่น "planbmedia.co.th") */
const ALLOWED_EMAIL_DOMAIN = "planbmedia.co.th";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "เข้าสู่ระบบ — Asset History 360" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { user, loading, signOut } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [resending, setResending] = useState(false);

  // จำกัดเฉพาะอีเมลโดเมนบริษัท — ถ้า login ด้วย Google ส่วนตัวให้เด้งออกทันที
  useEffect(() => {
    if (loading || !user) return;
    const userEmail = user.email?.toLowerCase() ?? "";
    if (!userEmail.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      toast.error(`อนุญาตเฉพาะอีเมลบริษัท @${ALLOWED_EMAIL_DOMAIN} เท่านั้น`);
      signOut();
      return;
    }
    nav({ to: "/" });
  }, [user, loading, nav, signOut]);

  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { hd: ALLOWED_EMAIL_DOMAIN, prompt: "select_account" },
      });
      if (result.error) throw result.error;
      if (result.redirected) return; // browser กำลัง redirect ไป Google
      // session พร้อมแล้ว — domain check ใน useEffect จะจัดการต่อ
    } catch (err) {
      toast.error((err as Error).message || "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
    } finally {
      setGoogleBusy(false);
    }
  };

  const resendConfirm = async () => {
    if (!email) {
      toast.error("กรอกอีเมลก่อนกดส่งลิงก์ยืนยัน");
      return;
    }
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      toast.success("ส่งลิงก์ยืนยันใหม่แล้ว กรุณาตรวจอีเมล (ลิงก์ใช้ได้ครั้งเดียว และมีอายุจำกัด)");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setResending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setNeedConfirm(false);
        toast.success("เข้าสู่ระบบสำเร็จ");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        setNeedConfirm(true);
        toast.success("สมัครสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ");
      }
    } catch (err) {
      const msg = (err as Error).message || "";
      const unconfirmed = /not confirmed|confirm(ed)?\s*email|email.*confirm/i.test(msg);
      if (unconfirmed) {
        setNeedConfirm(true);
        toast.error("อีเมลนี้ยังไม่ได้ยืนยัน — กดปุ่ม “ส่งลิงก์ยืนยันใหม่” ด้านล่างได้เลย");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen grid place-items-center px-4"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-md rounded-2xl bg-card shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div
            className="size-11 rounded-xl grid place-items-center font-bold text-primary-foreground"
            style={{ background: "var(--gradient-primary)" }}
          >
            PB
          </div>
          <div>
            <div className="font-bold">PlanB Media</div>
            <div className="text-xs text-muted-foreground">Asset History 360</div>
          </div>
        </div>
        <h1 className="text-xl font-semibold mb-1">
          {mode === "signin" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {mode === "signin" ? "ใช้บัญชีพนักงานของคุณ" : "สร้างบัญชีใหม่"}
        </p>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ชื่อ-นามสกุล"
              className="w-full h-11 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="อีเมล"
            className="w-full h-11 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            required
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="รหัสผ่าน"
            className="w-full h-11 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            disabled={busy}
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? "กำลังดำเนินการ..." : mode === "signin" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </button>
        </form>

        {needConfirm && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="font-medium mb-1">ต้องยืนยันอีเมลก่อนเข้าสู่ระบบ</div>
            <p className="mb-2 leading-relaxed">
              ลิงก์ยืนยันใช้ได้เพียงครั้งเดียวและมีอายุจำกัด หากกดซ้ำหรือเปิดช้าเกินไป ลิงก์จะใช้ไม่ได้ —
              กดปุ่มด้านล่างเพื่อขอลิงก์ใหม่
            </p>
            <button
              type="button"
              onClick={resendConfirm}
              disabled={resending}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50"
            >
              {resending ? "กำลังส่ง..." : "ส่งลิงก์ยืนยันใหม่"}
            </button>
          </div>
        )}

        {mode === "signin" && !needConfirm && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setNeedConfirm(true)}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              ไม่ได้รับอีเมลยืนยัน / ลิงก์หมดอายุ?
            </button>
          </div>
        )}



        <div className="mt-4 text-center text-sm">
          {mode === "signin" ? (
            <button onClick={() => setMode("signup")} className="text-primary hover:underline">
              ยังไม่มีบัญชี? สมัครสมาชิก
            </button>
          ) : (
            <button onClick={() => setMode("signin")} className="text-primary hover:underline">
              มีบัญชีแล้ว? เข้าสู่ระบบ
            </button>
          )}
        </div>
        <div className="mt-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}
