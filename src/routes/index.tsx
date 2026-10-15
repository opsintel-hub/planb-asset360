import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Asset History 360 — Operation Intelligence" },
    { name: "description", content: "ศูนย์ข้อมูลประวัติป้ายและงาน Operation ของ Plan B Media" },
    { property: "og:title", content: "Asset History 360 — Operation Intelligence" },
    { property: "og:description", content: "ประวัติป้าย งานซ่อมบำรุง และคะแนนความเสี่ยงของ Plan B Media" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: () => {
    throw redirect({ to: "/search" });
  },
});
