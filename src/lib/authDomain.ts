/** โดเมนอีเมลบริษัทที่อนุญาต — แก้ไขที่ไฟล์นี้ที่เดียว */
export const ALLOWED_EMAIL_DOMAIN = "planbmedia.co.th";

export const isAllowedEmail = (email?: string | null) =>
  !!email && email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
