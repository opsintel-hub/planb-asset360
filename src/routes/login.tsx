import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth-context";
import { isAllowedEmail, ALLOWED_EMAIL_DOMAIN } from "@/lib/authDomain";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "เข้าสู่ระบบ — Asset History 360" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [resending, setResending] = useState(false);

  // เช็คโดเมนแบบ global อยู่ที่ auth-context แล้ว — ที่นี่แค่พาเข้าหน้าหลักเมื่อ login ผ่าน
  useEffect(() => {
    if (!loading && user) nav({ to: "/" });
  }, [user, loading, nav]);

  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { hd: ALLOWED_EMAIL_DOMAIN, prompt: "select_account" },
      });
      if (result.error) throw result.error;
      if (result.redirected) return; // browser กำลัง redirect ไป Google
      // session พร้อมแล้ว — domain check ใน auth-context จะจัดการต่อ
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
        // ชั้นกันที่ 1 (สมัคร): รับเฉพาะอีเมลโดเมนบริษัท
        if (!isAllowedEmail(email)) {
          toast.error(`สมัครได้เฉพาะอีเมลบริษัท @${ALLOWED_EMAIL_DOMAIN} เท่านั้น`);
          setBusy(false);
          return;
        }
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

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={googleBusy || busy}
          className="w-full h-11 rounded-lg border bg-background font-medium flex items-center justify-center gap-2.5 hover:bg-accent transition disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.98 11.98 0 0 0 12 24z"/>
            <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 11.98 11.98 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/>
          </svg>
          {googleBusy ? "กำลังไปที่ Google..." : "เข้าสู่ระบบด้วย Google (อีเมลบริษัท)"}
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">หรือใช้อีเมล/รหัสผ่าน</span>
          <div className="h-px flex-1 bg-border" />
        </div>

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
            placeholder={`อีเมลบริษัท (@${ALLOWED_EMAIL_DOMAIN})`}
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
