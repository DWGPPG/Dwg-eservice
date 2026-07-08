// ── ค่าตั้งต้นทั้งหมด คัดลอกตรงจาก CONFIG object ใน index__5_.html ──
export const appConfig = {
  app: {
    name: "PPG Drawing e-Service",
    version: "2.0.0",
    defaultRoute: "/dashboard",
  },
  azure: {
    clientId: "8afc41c2-6018-4f5e-9175-fe9613d0e5ec",
    tenantId: "2ca2640f-6b35-45d1-930b-9b4ee11fb711",
    authority: "https://login.microsoftonline.com/2ca2640f-6b35-45d1-930b-9b4ee11fb711",
    // ตรวจจับ origin ปัจจุบันอัตโนมัติ — ใช้ได้ทั้ง GitHub Pages และ Vercel โดยไม่ต้องแก้ไฟล์นี้
    // ⚠️ ต้องลงทะเบียนทุก URL ที่ใช้จริงไว้ใน Azure AD App Registration > Authentication ด้วยเสมอ
    redirectUri: `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}`,
    allowedDomain: "primepower.co.th",
    scopes: [
      "User.Read",
      "Sites.ReadWrite.All",
      "Files.ReadWrite.All",
      "Chat.ReadWrite",
    ],
  },
  sharePoint: {
    hostname: "primepowertl.sharepoint.com",
    sitePath: "/sites/DrawingDepartment",
    siteName: "DrawingDepartment",
    driveName: "Documents",
    uploadFolder: "DrawingRequests",
  },
  teams: {
    // Drawing Dept. group chat
    drawingTeamChatId: "19:e668fd9c854447918fdb8218e2f023bb@thread.v2",

    // ── Power Automate Flow (fallback เท่านั้น) ──
    // วิธีหลักตอนนี้คือยิงตรงผ่าน Graph ด้วย token ผู้ใช้ (ผู้ใช้เป็นสมาชิกกลุ่ม Nexus อยู่แล้ว)
    // Flow นี้ใช้เป็นแผนสำรองกรณี Graph direct ไม่ผ่านเท่านั้น — ถ้ายังไม่ได้ปรับ Flow ก็ไม่เป็นไร
    // (ถ้าจะให้ fallback ทำงานด้วย ต้องปรับ Flow ให้รับ { groupChatId, title, message } แล้วโพสต์ตาม groupChatId)
    drawingTeamWebhookUrl: "https://default2ca2640f6b3545d1930b9b4ee11fb7.11.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/5d6bc13578b84f3793a1bfb7fcad069b/triggers/manual/paths/invoke?api-version=1",

    // ── กลุ่ม "The Nexus - Project Sales X DWG" (Group Chat) ──
    // งาน "📋 เขียนแบบ Proposal" จะยิงตรงเข้ากลุ่มนี้ผ่าน Graph (ผู้ใช้เป็นสมาชิกกลุ่ม)
    nexusChatId: "19:2bffa8c03c5d4c3e898a1ae3bc0b73d3@thread.v2",
  },
  // ── อีเมลผู้อนุมัติ Lv.2 (ผู้จัดการ/แอดมินทั้งหมด) ──
  approverLv2Email: "narakorn.pa@primepower.co.th", // primary — ใช้เช็ค isMgr()
  approverLv2Emails: [
    "jeerapat.up@primepower.co.th",
    "narakorn.pa@primepower.co.th",
    "archan.sa@primepower.co.th",
    "sarit.sr@primepower.co.th",
  ],
  // ── ป้ายแสดงผลพิเศษรายบุคคล (ไม่กระทบสิทธิ์การใช้งานจริง — แค่เปลี่ยนข้อความที่แสดง) ──
  customRoleLabels: {
    "sarit.sr@primepower.co.th": "Admin ผู้ดูแลระบบ · วิศวกรไฟฟ้าเขียนแบบอาวุโส",
  },
  features: {
    mockWhenOffline: true,
    enableDarkMode: true,
  },
};
