// Records lightweight usage events (login once per browser session + page views)
// so the admin "Usage Analytics" screen has data to summarise.
import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { trackActivity } from "@/lib/usage-analytics.functions";
import { useAuth } from "@/lib/auth-context";

const SESSION_KEY = "app:usage-session";

function ensureSessionId(): string {
  let id = window.sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id =
      (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) +
      "";
    window.sessionStorage.setItem(SESSION_KEY, id);
    window.sessionStorage.setItem(`${SESSION_KEY}:new`, "1");
  }
  return id;
}

function detectEnv() {
  const ua = navigator.userAgent;
  const isTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = /iPhone|Android.*Mobile|Windows Phone/i.test(ua);
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Other";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Mac OS X/i.test(ua)
      ? "macOS"
      : /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/i.test(ua)
          ? "iOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Other";
  return {
    deviceType,
    browser,
    os,
    platform: deviceType === "desktop" ? "web" : "mobile",
  };
}

export function useActivityTracker() {
  const { pathname } = useLocation();
  const { user, loading } = useAuth();
  const track = useServerFn(trackActivity);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;

    const sessionId = ensureSessionId();
    const env = detectEnv();
    const isNew = window.sessionStorage.getItem(`${SESSION_KEY}:new`) === "1";
    if (isNew) window.sessionStorage.removeItem(`${SESSION_KEY}:new`);

    const send = (eventType: "login" | "page_view") =>
      track({
        data: {
          sessionId,
          eventType,
          path: pathname,
          feature: pathname.split("/")[1] || "home",
          ...env,
        },
      }).catch(() => {
        /* tracking must never break the app */
      });

    if (isNew) void send("login");
    void send("page_view");
  }, [pathname, user?.id, loading, track]);
}
