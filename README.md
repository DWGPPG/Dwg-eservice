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
  → done              เสร็จสมบูรณ์ → ออกใบส่งมอบ FM-SEN-009 ได้

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
| `requester` | อีเมล `@primepower.co.th` ที่ไม่อยู่สองกลุ่มบน | ส่งคำร้อง, ติดตามงาน, ตรวจรับงาน, ออกใบส่งมอบ |
| `viewer` | ยังไม่ login | ดูภาพรวมแบบ read-only |

Logic เต็มที่ `assets/js/services/role-service.js`

---

## ฟีเจอร์ทั้งหมด (เวอร์ชันปัจจุบัน)

### หน้าส่งคำร้อง (`submit.js`)
- เลือกประเภทงาน → ชื่อโครงการ → Drawing → รายละเอียด **แบบ step-by-step slide down** ทีละขั้น
- รองรับส่งหลาย Drawing พร้อมกันในครั้งเดียว
- ระบุวันกำหนดส่ง / ความเร่งด่วน / ลิงก์แนบ
- **อัปโหลดไฟล์ทุกประเภท** (DWG, PDF, รูปภาพ, ZIP และอื่นๆ) **รองรับไฟล์ขนาดใหญ่ถึง 1 GB**
  - ไฟล์ < 4 MB: PUT ตรง (เร็ว)
  - ไฟล์ ≥ 4 MB: Upload Session แบบ chunked (10 MB/chunk)
- **Progress bar** แสดงระหว่างอัปโหลด พร้อม % real-time และชื่อไฟล์ที่กำลังโหลด
- **Atomic submit** — ถ้าขั้นตอนใดพังให้ rollback ทั้งหมด ไม่มีข้อมูลค้างในระบบ
- ตรวจสอบ Drawing No. ซ้ำ real-time ก่อนส่ง

### หน้ารับงาน / อนุมัติ (`admin.js`)

**📥 รับงาน (ตาราง "รอฝ่ายแบบรับงาน")**
- แสดง **วันที่/เวลาส่งคำขอ** ทุกแถว
- ปุ่ม **📁 โฟลเดอร์ SharePoint** และ **🔗 ลิงก์แนบ** ทุกรายการ
- Filter: ประเภทงาน / โครงการ / ผู้รับผิดชอบ / ช่วงวันที่ / ค้นหาข้อความ (แถวเดียว ไม่ตกบรรทัด)
- เลือกรับหลายงานพร้อมกัน (bulk pickup) หรือรับเองทีละรายการ

**✅ อนุมัติเริ่มงาน (manager)**
- แสดง **📁 โฟลเดอร์** และ **🔗 ลิงก์แนบ** ในการ์ดทุกใบ
- อนุมัติ + มอบหมายผู้รับผิดชอบ หรืออนุมัติคนเดิม
- ส่งกลับ Lv.1 หรือยกเลิกพร้อมระบุเหตุผล

**🔍 ตรวจสอบและส่งมอบงาน (manager)**
- เปิด DWG / PDF / ไฟล์แนบ / โฟลเดอร์ได้ในหน้าเดียว
- ส่งมอบหรือส่งกลับแก้ไขพร้อมเหตุผล

**🔄 ดึงงานจากเพื่อนร่วมทีม**
- ดูงานทั้งหมดในฝ่ายที่ assigned ให้คนอื่น
- กด "ดึงงานนี้" → เลือกเหตุผล (ขาด/ลา/สาย/เร่งด่วน/อื่นๆ)
- แจ้งเตือน **3 ช่องทางพร้อมกัน** อัตโนมัติ:
  1. Teams 1:1 → เจ้าของงานเดิม
  2. Teams 1:1 → ผู้จัดการทุกคน
  3. Browser Notification (ถ้าเปิดแอปค้างไว้)
- บันทึก Audit Log ทุกครั้ง

### หน้าติดตามงาน (`track.js`)

**designer / manager (`renderWorkbookTrack`):**
- Filter: ค้นหา / โครงการ / ผู้รับผิดชอบ / ช่วงวันที่
- แท็บ: งานของฉัน / งานในฝ่าย × งานปัจจุบัน / เสร็จสิ้น / ยกเลิก / ทั้งหมด
- คอลัมน์ **📁 โฟลเดอร์ / 📄 ไฟล์ / 🔗 ลิงก์**
- อัปเดตสถานะงานได้ตรงตาราง
- **ไอคอน 📄 หลัง badge "เสร็จสิ้น"** → เปิดใบส่งมอบงาน FM-SEN-009

**requester (`renderRequesterTrack`):**
- แท็บ: รอตรวจรับ / กำลังดำเนินการ / ทั้งหมด
- ตรวจรับ / ขอแก้ไข / Reject งานที่ส่งมอบแล้ว

**Popup รายละเอียดคำร้อง:**
- ปุ่ม 📁 โฟลเดอร์ / 📐 DWG / 📄 PDF / 🔗 ลิงก์แนบ
- Timeline ประวัติคำร้องดึงจาก AuditLog

### ใบส่งมอบงาน FM-SEN-009 (ใหม่)
เข้าถึงได้จากไอคอน 📄 หลัง badge "เสร็จสิ้น" ในตารางติดตามงาน

**ข้อมูลที่โผล่อัตโนมัติ (ดึงจากระบบ):**
- Issued by — ผู้เขียนแบบ: `assignedToName` + `approvedLv2At`
- Checker by — ผู้จัดการฝ่ายแบบ: `mgrApprovedBy` + `mgrApprovedAt`
- Reviewed by — ผู้ร้องขอ: `requesterName` + `reviewedAt` + **วาดลายเซ็นเอง**
- Approved by — ผู้จัดการผู้ร้องขอ: **กรอกชื่อเอง** + **วาดลายเซ็นเอง**

**Flow:**
1. กดไอคอน 📄 → Popup ขึ้นมา
2. ข้อมูล Issued by / Checker by โผล่อัตโนมัติ
3. Reviewed by: วาดลายเซ็นด้วยนิ้ว/เมาส์
4. Approved by: กรอกชื่อ + วาดลายเซ็น
5. กด **Preview PDF** → ดู layout FM-SEN-009 ก่อน
6. กด **Export & บันทึก** → เปิด Print Dialog → Save as PDF

Logo ที่ใช้: `PPC NEW-2024 - R1.png` (ไฟล์ root ของโปรเจกต์)

### การแจ้งเตือน
| เหตุการณ์ | ช่องทาง | ผู้รับ |
|---|---|---|
| คำร้องใหม่เข้ามา | **Power Automate → Teams Group Chat** "Drawing Dept. นะจ๊ะ" | ทีมเขียนแบบทั้งหมด |
| รับงาน / มอบหมาย | Teams 1:1 | ผู้รับผิดชอบ |
| อนุมัติเริ่มงาน | Teams 1:1 | ผู้รับผิดชอบ + ผู้ร้องขอ |
| ส่งงาน (sendwork) | Teams 1:1 | ผู้จัดการ |
| ส่งมอบงาน | Teams 1:1 + Email | ผู้ร้องขอ |
| ส่งกลับ / ยกเลิก | Teams 1:1 | ผู้รับผิดชอบ / ผู้ร้องขอ |
| ดึงงานจากเพื่อน | Teams 1:1 + Browser Notification | เจ้าของงานเดิม + ผู้จัดการ |

---

## การตั้งค่า `config/config.js`

```js
teams: {
  drawingTeamChatId: "19:xxx@thread.v2",
  // Power Automate Flow URL — ส่งแจ้งเตือนเข้ากลุ่ม "Drawing Dept. นะจ๊ะ"
  // วิธีสร้าง: Power Automate → สร้าง Flow รับ HTTP Request → Post to Group Chat
  drawingTeamWebhookUrl: "https://default2ca2640f6b3545d1930b9b4ee11fb7...",
}
```

> **หมายเหตุ:** ระบบใช้ **Power Automate Flow** แทน Teams Incoming Webhook  
> เพราะกลุ่มเป้าหมายเป็น Group Chat (ไม่ใช่ Channel) ซึ่ง Incoming Webhook ไม่รองรับ

---

## SharePoint Lists ที่ต้องมี

| List | Field สำคัญ |
|---|---|
| `DrawingRequests` | `Title`, `Status0`, `ProjectName0`, `DrawingNumber`, `AssigneeName`/`AssigneeEmail`, `DwgFileUrl`/`PdfFileUrl`, `NoteFromDrawing`, `SubmittedAt`, `DeliveryFormUrl`, `DeliveryFormGeneratedAt` |
| `ProjectList` | `Title`, `IsHidden`, `DefaultKwp`, `DefaultLocation` |
| `DrawingNumberList` | `Title`, `ProjectName`, `DrawingCategory`, `DrawingName`, `IsHidden` |
| `DrawingTeam` | `Title0` (ชื่อ), `Email`, `Role`, `IsActive`, `IsAdmin`, `DisplayLabel` |
| `AuditLog` | `Title`, `RequestId`, `UserEmail`, `UserName`, `Detail`, `ActionAt` |
| `HolidayList` | `Title`, `HolidayDate` |

> **Column ที่เพิ่มล่าสุดใน DrawingRequests:**
> - `DeliveryFormUrl` (Single line of text) — URL ของ PDF ใบส่งมอบ
> - `DeliveryFormGeneratedAt` (Date and Time) — วันที่ generate ใบส่งมอบ

Field mapping เต็มที่ `config/schema.js`

---

## Azure AD App Registration

| Scope | ใช้สำหรับ |
|---|---|
| `User.Read` | อ่านข้อมูล profile ผู้ login |
| `Sites.ReadWrite.All` | อ่าน/เขียน SharePoint Lists |
| `Files.ReadWrite.All` | อัปโหลดไฟล์เข้า SharePoint (รองรับ chunked upload ถึง 1 GB) |
| `Chat.ReadWrite` | ส่ง Teams 1:1 chat แจ้งเตือน |

---

## Deploy

### GitHub Pages
1. แก้ค่าใน `config/config.js`
2. ใส่ `drawingTeamWebhookUrl` (Power Automate URL)
3. Commit + Push → `Settings > Pages` → Deploy from branch `main`

### Vercel
```bash
vercel --prod
```

### Local
```bash
python -m http.server 8080
```

---

## โครงสร้างไฟล์

```
PPC NEW-2024 - R1.png   ← Logo บนหัวกระดาษ FM-SEN-009
config/
  config.js             ← Azure / SharePoint / Teams / Power Automate config
  schema.js             ← STATUS enum + field mapping
  roles.js              ← permission model

assets/
  css/                  ← variables, base, layout, components, dark-mode, responsive
  js/
    main.js             ← bootstrap + MSAL login
    auth.js             ← token management
    state.js            ← global app state
    router.js           ← hash-based routing
    graph.js            ← Microsoft Graph API (Teams 1:1, chunked upload, Email)
    sharepoint.js       ← List ID caching + master data + deleteItem (rollback)
    utils.js            ← helpers (formatDate, escapeHtml, formatFileSize, ...)

    components/         ← modal, toast, badge, table, timeline
    pages/
      dashboard.js
      submit.js         ← ส่งคำร้อง (step-by-step, chunked upload, atomic submit)
      track.js          ← ติดตามงาน + ใบส่งมอบ FM-SEN-009
      admin.js          ← รับงาน / อนุมัติ / ดึงงานจากทีม
      report.js
      guide.js
    services/
      request-service.js   ← state transitions + notifications + atomic rollback
      drawing-service.js   ← SharePoint file upload (chunked)
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

## การอัปเดตที่สำคัญ (changelog)

| รายการ | รายละเอียด |
|---|---|
| Atomic submit | ถ้าอัปโหลดไฟล์พัง → ไม่บันทึกคำขอ, ถ้าบันทึกแล้วพัง → rollback ลบ Item ออก |
| Chunked upload | รองรับไฟล์ใหญ่ถึง 1 GB ด้วย Graph API Upload Session |
| Progress bar overlay | แสดงระหว่างอัปโหลด ชื่อไฟล์ + % + จำนวนไฟล์ |
| Power Automate | แจ้งเตือนเข้า Group Chat "Drawing Dept. นะจ๊ะ" แทน Incoming Webhook |
| Filter bar | ทุก filter ในแถวเดียว ไม่ตกบรรทัด |
| FM-SEN-009 | ใบส่งมอบงาน — ไอคอน 📄 หลัง badge เสร็จสิ้น → Popup → Preview → Print PDF |
| Step-by-step submit | ช่องโครงการ/Drawing/Queue สไลด์ลงทีละขั้น |
| ดึงงานจากทีม | แจ้งเตือน 3 ช่องทาง (Teams 1:1 × 2 + Browser Notification) |
