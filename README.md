# PPG Drawing e-Service — คู่มือระบบ

Static Single Page Web App สำหรับ workflow คำร้องงานเขียนแบบ Drawing ของ PRIME POWER GROUP  
ใช้ Microsoft 365 (MSAL), Microsoft Graph API และ SharePoint Lists เป็นแหล่งข้อมูลหลัก  
Deploy บน GitHub Pages / Vercel ได้โดยไม่ต้อง build step (ES modules native)

---

## Workflow สถานะคำร้อง

```
ผู้ร้องขอส่งคำร้อง
  → pending           รอ Lv.1 (ฝ่ายเขียนแบบ) รับงาน+มอบหมาย
  → inprogress_lv1    Lv.1 มอบหมายแล้ว รอ Lv.2 (ผู้จัดการ) อนุมัติเริ่มงาน
  → approved          ผู้จัดการอนุมัติแล้ว เริ่มงานได้
  → working           กำลังดำเนินการ (ผู้รับผิดชอบอัปเดตสถานะเอง)
  → mgr_review        ส่งงานแล้ว รอผู้จัดการตรวจสอบ+ส่งมอบ
  → delivered         ผู้จัดการส่งมอบแล้ว รอผู้ร้องขอตรวจรับ
  → done              เสร็จสมบูรณ์

ทางแยก:
  - rejected          ส่งกลับพร้อมเหตุผล (Lv.1 / Lv.2 / ผู้ร้องขอ)
  - mgr_rejected      ผู้จัดการส่งกลับให้แก้ไขก่อนส่งมอบใหม่
  - cancelled         ยกเลิกคำร้องพร้อมเหตุผล
  - Lv.2 ส่งกลับ Lv.1 → กลับเป็น pending ให้มอบหมายใหม่
```

---

## Role model

| Role | เงื่อนไข | สิทธิ์ |
|---|---|---|
| `manager` | อีเมลอยู่ใน `approverLv2Emails` (config) หรือ `IsAdmin=true` ใน SharePoint DrawingTeam | อนุมัติ Lv.2, ตรวจสอบ+ส่งมอบ, ดูรายงาน, ดึงงานจากทีม |
| `designer` | อีเมลอยู่ใน SharePoint List `DrawingTeam` | รับงาน Lv.1, ส่งงาน, ดึงงานจากเพื่อนร่วมทีม |
| `requester` | อีเมล `@primepower.co.th` ที่ไม่อยู่สองกลุ่มบน | ส่งคำร้อง, ติดตามงาน, ตรวจรับงาน |
| `viewer` | ยังไม่ login | ดูภาพรวมแบบ read-only |

Logic เต็มที่ `assets/js/services/role-service.js`

---

## ฟีเจอร์ทั้งหมด (เวอร์ชันปัจจุบัน)

### หน้าส่งคำร้อง (`submit.js`)
- เลือกประเภทงาน → ชื่อโครงการ → Drawing → รายละเอียด **แบบ step-by-step slide down** ทีละขั้น
- รองรับส่งหลาย Drawing พร้อมกันในครั้งเดียว
- ระบุวันกำหนดส่ง / ความเร่งด่วน / ลิงก์แนบ / อัปโหลดไฟล์แต่ละรายการ
- ตรวจสอบ Drawing No. ซ้ำ real-time ก่อนส่ง
- เพิ่ม/แก้ไขโครงการและ Drawing Number ได้จากหน้าเดียว

### หน้ารับงาน / อนุมัติ (`admin.js`)
**ทั้ง designer และ manager เห็นฟีเจอร์ตาม role:**

**📥 รับงาน (ตาราง "รอฝ่ายแบบรับงาน")**
- แสดง **วันที่/เวลาส่งคำขอ** ทุกแถว
- ปุ่ม **📁 โฟลเดอร์ SharePoint** และ **🔗 ลิงก์แนบ** ทุกรายการ
- Filter: ประเภทงาน / โครงการ / ผู้รับผิดชอบ / ช่วงวันที่ส่งคำขอ / ค้นหาข้อความ
- เลือกรับหลายงานพร้อมกัน (bulk pickup) หรือรับเองทีละรายการ

**✅ อนุมัติเริ่มงาน (manager)**
- แสดง **📁 โฟลเดอร์** และ **🔗 ลิงก์แนบ** ในการ์ดทุกใบ
- อนุมัติ + มอบหมายผู้รับผิดชอบ หรืออนุมัติคนเดิมที่รับไว้แล้ว
- ส่งกลับ Lv.1 หรือยกเลิกพร้อมระบุเหตุผล

**🔍 ตรวจสอบและส่งมอบงาน (manager)**
- เปิด DWG / PDF / ไฟล์แนบ / ลิงก์ข้อมูล / โฟลเดอร์ทั้งหมดได้ในหน้าเดียว
- ส่งมอบหรือส่งกลับแก้ไขพร้อมเหตุผล

**🔄 ดึงงานจากเพื่อนร่วมทีม**
- ดูงานทั้งหมดในฝ่ายที่ assigned ให้คนอื่นอยู่
- กด "ดึงงานนี้" → เลือกเหตุผล (ขาด/ลา/สาย/เร่งด่วน/อื่นๆ)
- ระบบแจ้งเตือน **3 ช่องทางพร้อมกัน** อัตโนมัติ:
  1. **Teams 1:1 → เจ้าของงานเดิม** (บอกว่างานถูกดึงไปแล้ว + ชื่อผู้รับใหม่ + เหตุผล)
  2. **Teams 1:1 → ผู้จัดการทุกคน** (สรุปการโอนงาน)
  3. **Browser Notification** (ถ้าเจ้าของงานเดิมเปิดแอปค้างไว้ จะเห็น popup ทันที)
- บันทึก Audit Log ทุกครั้ง

### หน้าติดตามงาน (`track.js`)
**designer / manager (`renderWorkbookTrack`):**
- Filter: ค้นหา / โครงการ / ผู้รับผิดชอบ / ช่วงวันที่ส่งคำขอ
- แท็บ: งานของฉัน / งานในฝ่าย × งานปัจจุบัน / เสร็จสิ้น / ยกเลิก / ทั้งหมด
- คอลัมน์ **📁 โฟลเดอร์ / 📄 ไฟล์ / 🔗 ลิงก์** แทนลิงก์เดี่ยวเดิม
- อัปเดตสถานะงานได้ตรงตาราง (approved → working → เสร็จสิ้น)

**requester (`renderRequesterTrack`):**
- แท็บ: รอตรวจรับ / กำลังดำเนินการ / ทั้งหมด
- ตรวจรับ / ขอแก้ไข / Reject งานที่ส่งมอบแล้ว

**Popup รายละเอียดคำร้อง:**
- แสดง **📁 โฟลเดอร์ SharePoint / 📐 DWG / 📄 PDF / 🔗 ลิงก์แนบ** ครบทุกปุ่ม
- Timeline ประวัติคำร้องทั้งหมดดึงจาก AuditLog

### การแจ้งเตือน (Notifications)
| เหตุการณ์ | ช่องทาง | ผู้รับ |
|---|---|---|
| คำร้องใหม่เข้ามา | Teams Incoming Webhook → group chat | ทีมเขียนแบบทั้งหมด |
| รับงาน / มอบหมาย | Teams 1:1 | ผู้รับผิดชอบ |
| อนุมัติเริ่มงาน | Teams 1:1 | ผู้รับผิดชอบ + ผู้ร้องขอ |
| ส่งงาน (sendwork) | Teams 1:1 | ผู้จัดการ |
| ส่งมอบงาน | Teams 1:1 + Email | ผู้ร้องขอ |
| ส่งกลับ / ยกเลิก | Teams 1:1 | ผู้รับผิดชอบ / ผู้ร้องขอ |
| **ดึงงานจากเพื่อน** | Teams 1:1 + Browser Notification | เจ้าของงานเดิม + ผู้จัดการ |

---

## การตั้งค่า `config/config.js`

```js
teams: {
  drawingTeamChatId: "19:xxx@thread.v2",   // Group chat ID (เดิม — ใช้กับ sendTeamsGroup)
  drawingTeamWebhookUrl: "https://...",     // ⚠️ Incoming Webhook URL สำหรับแจ้งคำร้องใหม่
                                            // วิธีสร้าง: Teams → กลุ่ม Drawing Dept.
                                            //   → ... → Connectors → Incoming Webhook → Add
}
```

> **สำคัญ:** `drawingTeamWebhookUrl` ต้องตั้งค่าก่อน deploy จริง  
> ถ้าว่างเปล่า ระบบจะ fallback ส่ง Teams 1:1 ถึงผู้จัดการแทนชั่วคราว

---

## SharePoint Lists ที่ต้องมี

| List | Field สำคัญ |
|---|---|
| `DrawingRequests` | `Title` (เลขคำร้อง), `Status0`, `ProjectName0`, `DrawingNumber`, `AssigneeName`/`AssigneeEmail`, `DwgFileUrl`/`PdfFileUrl`, `NoteFromDrawing`, `SubmittedAt` ฯลฯ |
| `ProjectList` | `Title`, `IsHidden`, `DefaultKwp`, `DefaultLocation` |
| `DrawingNumberList` | `Title`, `ProjectName`, `DrawingCategory`, `DrawingName`, `IsHidden` |
| `DrawingTeam` | `Title0` (ชื่อ), `Email`, `Role`, `IsActive`, `IsAdmin`, `DisplayLabel` |
| `AuditLog` | `Title`, `RequestId`, `UserEmail`, `UserName`, `Detail`, `ActionAt` |
| `HolidayList` | `Title`, `HolidayDate` |

Field mapping เต็มที่ `config/schema.js` (single source of truth)

---

## Azure AD App Registration

Scope ที่ต้องได้รับ consent:

| Scope | ใช้สำหรับ |
|---|---|
| `User.Read` | อ่านข้อมูล profile ผู้ login |
| `Sites.ReadWrite.All` | อ่าน/เขียน SharePoint Lists |
| `Files.ReadWrite.All` | อัปโหลดไฟล์เข้า SharePoint |
| `Chat.ReadWrite` | ส่ง Teams 1:1 chat แจ้งเตือน |

> หากเพิ่ม Redirect URI ใหม่ ต้องลงทะเบียนใน Azure Portal →  
> `App registrations → Authentication → Single-page application`

---

## Deploy

### GitHub Pages
1. แก้ค่าใน `config/config.js` ให้ตรงกับ Azure AD App และ SharePoint Site จริง
2. ใส่ `drawingTeamWebhookUrl` ให้ครบ
3. Commit ขึ้น GitHub → `Settings > Pages` → Deploy from branch `main`

### Vercel
- `vercel.json` ตั้งค่า rewrite ไว้แล้ว รัน `vercel --prod` ได้เลย

### Local
```bash
python -m http.server 8080
# เปิด http://localhost:8080/
```
> ต้อง login ด้วยบัญชี Microsoft 365 จริงเสมอ — ไม่มี offline mock mode

---

## โครงสร้างไฟล์

```
config/
  config.js       ← Azure / SharePoint / Teams config ทั้งหมด
  schema.js       ← STATUS enum + field mapping (single source of truth)
  roles.js        ← permission model

assets/
  css/            ← variables, base, layout, components, dark-mode, responsive
  js/
    main.js       ← bootstrap + MSAL login flow
    auth.js       ← token management
    state.js      ← global app state
    router.js     ← hash-based routing
    graph.js      ← Microsoft Graph API (Teams 1:1, Webhook, Email, SharePoint)
    sharepoint.js ← List ID caching + master data loader
    utils.js      ← helpers (formatDate, escapeHtml, ...)

    components/   ← modal, toast, badge, table, timeline
    pages/
      dashboard.js
      submit.js   ← ส่งคำร้อง (step-by-step UX)
      track.js    ← ติดตามงาน (4 มุมมองตาม role)
      admin.js    ← รับงาน / อนุมัติ / ดึงงานจากทีม
      report.js
      guide.js
    services/
      request-service.js   ← state transitions + Teams notifications (หัวใจระบบ)
      drawing-service.js   ← SharePoint file upload
      team-service.js      ← DrawingTeam member management
      role-service.js      ← คำนวณ role จากอีเมล
      audit-service.js     ← AuditLog read/write
      notification-service.js ← browser notification + badge counts
      report-service.js
      project-service.js

  vendor/
    msal-browser.min.js   ← Microsoft Authentication Library
```

---

## หมายเหตุ

- `_reference_original_mockup_DO_NOT_USE.html` — ไฟล์ demo เดิมก่อนเชื่อม SharePoint จริง เก็บไว้เป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช่ส่วนหนึ่งของแอปจริง
- ระบบรองรับ **Dark Mode** (toggle ได้ที่ settings)
- รองรับ **PWA** (manifest.json + sw.js) — ติดตั้งบน mobile ได้
