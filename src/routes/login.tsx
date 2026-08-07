import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
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
  const [needConfirm, setNeedConfirm] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!loading && user) nav({ to: "/" });
  }, [user, loading, nav]);

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
