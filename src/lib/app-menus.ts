// Single source of truth for the app's navigable menus.
// The sidebar (src/components/app-shell.tsx), the permission matrix
// (src/routes/permissions.tsx) and the server-side access check
// (src/lib/admin.functions.ts) all read this list, so a new menu added here
// automatically shows up in the permission screen — no second edit needed.

export type AppMenu = {
  /** route path, also the permission key stored in app_settings */
  to: string;
  /** label shown in the sidebar AND in the permission matrix */
  label: string;
  /** admin-only menus are never grantable to other roles */
  adminOnly?: boolean;
  /** short hint shown in the permission matrix */
  hint?: string;
};

export const APP_MENUS: AppMenu[] = [
  { to: "/search", label: "Asset history", hint: "ค้นหา/ประวัติป้าย" },
  { to: "/claims", label: "Claim Aging", hint: "งานค้างซ่อม" },
  { to: "/pm-insights", label: "PM Insights", hint: "วิเคราะห์งาน PM" },
  { to: "/monitoring", label: "Monitoring", hint: "สถานะออนไลน์" },
  { to: "/risk-score", label: "คะแนนความเสี่ยง", hint: "Risk Score รายป้าย" },
  { to: "/rca", label: "Root Cause Analysis", hint: "วิเคราะห์สาเหตุ" },
  { to: "/map", label: "Asset Map", hint: "แผนที่ป้าย/POI" },
  { to: "/route-monitoring", label: "Route Monitoring", hint: "วางแผนเส้นทางตรวจ" },
  { to: "/settings", label: "ตั้งค่าระบบ", hint: "ตั้งค่า/ซิงก์ข้อมูล" },
  { to: "/permissions", label: "จัดการสิทธิ์", adminOnly: true, hint: "admin เท่านั้น" },
];

/** All permission keys, including admin-only ones. */
export const ALL_MENU_PATHS = APP_MENUS.map((m) => m.to);

/** Menus that can be granted to non-admin roles. */
export const GRANTABLE_MENUS = APP_MENUS.filter((m) => !m.adminOnly);

export const ADMIN_ONLY_MENUS = APP_MENUS.filter((m) => m.adminOnly).map((m) => m.to);

export const MENU_LABEL: Record<string, string> = Object.fromEntries(
  APP_MENUS.map((m) => [m.to, m.label]),
);
