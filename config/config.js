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
    redirectUri: "https://dwgppg.github.io/Dwg-eservice/",
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
    // Drawing Dept. group chat — ใช้ส่งแจ้งเตือนคำร้องใหม่ + sendwork
    drawingTeamChatId: "19:e668fd9c854447918fdb8218e2f023bb@thread.v2",
  },
  // ── อีเมลผู้อนุมัติ Lv.2 (ผู้จัดการทั้ง 3 คน) ──
  approverLv2Email: "narakorn.pa@primepower.co.th", // primary — ใช้เช็ค isMgr()
  approverLv2Emails: [
    "jeerapat.up@primepower.co.th",
    "narakorn.pa@primepower.co.th",
    "archan.sa@primepower.co.th",
  ],
  reviewAdmins: ["narakorn.pa@primepower.co.th", "sarit.sr@primepower.co.th"],
  features: {
    mockWhenOffline: true,
    enableDarkMode: true,
  },
};
