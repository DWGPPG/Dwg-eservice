# PPG Drawing e-Service

Static Single Page Web App สำหรับ workflow คำร้อง Drawing ของ PRIME POWER GROUP
ใช้ Microsoft 365 (MSAL), Microsoft Graph API และ SharePoint Lists เป็นแหล่งข้อมูลหลัก
ออกแบบให้ deploy บน GitHub Pages ได้โดยไม่ต้อง build step (ES modules native)

> **หมายเหตุ:** UI/โครงสร้างไฟล์นี้ปรับปรุงมาจากดีไซน์ "DWG PRIME" แต่ business logic, field
> mapping, และ workflow ทั้งหมดเชื่อมกับ SharePoint List ชุดเดิมที่ใช้งานจริงอยู่แล้ว (List ชื่อ
> `DrawingRequests`, field เช่น `Status0`, `ProjectName0`, `AssigneeEmail` ฯลฯ) — ไม่ใช่ schema ใหม่

## Workflow จริงที่ระบบนี้ implement

```
ส่งคำร้อง (ผู้ร้องขอ)
  → pending                 รอ Lv.1 (ฝ่ายเขียนแบบ) ตรวจสอบ+มอบหมาย
  → inprogress_lv1          Lv.1 มอบหมายแล้ว รอ Lv.2 (ผู้จัดการ) อนุมัติ
  → approved                Lv.2 อนุมัติแล้ว เริ่มงานได้
  → working                 กำลังดำเนินการ (ผู้รับผิดชอบอัปเดตเอง)
  → mgr_review              ส่งงานแล้ว รอผู้จัดการตรวจ+ส่งมอบ
  → delivered                ผู้จัดการอนุมัติส่งมอบแล้ว รอผู้ร้องขอตรวจรับ
  → done                    ผู้ร้องขอตรวจรับแล้ว เสร็จสมบูรณ์

ทางแยกที่เป็นไปได้ทุกจุด:
  - rejected       Lv.1/Lv.2/ผู้ร้องขอ ส่งกลับพร้อมเหตุผล (แจ้ง Teams ผู้ร้องขอ)
  - mgr_rejected   ผู้จัดการส่งกลับให้ผู้รับผิดชอบแก้ไขก่อนส่งมอบใหม่
  - cancelled      ยกเลิกคำร้องพร้อมเหตุผล
  - Lv.2 ส่งกลับ Lv.1 → กลับเป็น pending (ล้างผู้รับผิดชอบเดิม ให้ Lv.1 มอบหมายใหม่)
```

ทุกจุดเปลี่ยนสถานะสำคัญจะส่ง **Teams 1:1 chat** ผ่าน Microsoft Graph API ไปหาผู้เกี่ยวข้องโดยตรง
(ไม่ใช่ webhook ข้อความธรรมดา) ดูรายละเอียดที่ `assets/js/graph.js` (`sendTeams1on1`) และ
`assets/js/services/request-service.js`

## Role model

ระบบไม่มี role "admin" แยกต่างหาก — คำนวณจากอีเมลผู้ login เทียบกับ SharePoint List `DrawingTeam`
และค่าคงที่ `approverLv2Emails` ใน `config/config.js`:

| Role ใน UI | เงื่อนไข | ทำอะไรได้ |
|---|---|---|
| `manager` | อีเมลอยู่ใน `appConfig.approverLv2Emails` | อนุมัติ Lv.2, ตรวจสอบ+ส่งมอบงาน (mgr_review), ดูรายงาน |
| `designer` | อีเมลอยู่ใน SharePoint List `DrawingTeam` (และ `IsActive` ไม่เป็น false) | อนุมัติ Lv.1+มอบหมาย, รับงาน, ส่งงาน (sendwork) |
| `requester` | อีเมล `@primepower.co.th` ที่ไม่อยู่ในสองกลุ่มบน | ส่งคำร้อง, ติดตามงาน, ตรวจรับงาน |
| `viewer` | ยังไม่ login | ดูภาพรวม/ติดตามงานแบบ read-only |

ดู logic เต็มที่ `assets/js/services/role-service.js`

## Deploy บน GitHub Pages

1. แก้ค่าใน `config/config.js` ให้ตรงกับ Azure AD App, SharePoint Site จริง (ค่าเริ่มต้นที่ใส่ไว้
   คัดลอกมาจากระบบ production ที่ใช้งานอยู่แล้ว — ตรวจสอบให้แน่ใจก่อน deploy จริง)
2. Commit โฟลเดอร์นี้ขึ้น GitHub repository
3. ไปที่ repository `Settings > Pages`
4. เลือก `Deploy from a branch`
5. เลือก branch เช่น `main` และ folder `/root`
6. เปิด URL ของ GitHub Pages ที่ได้

ถ้า repository ไม่ได้อยู่ที่ root domain ระบบใช้ relative path (`./assets/...`) อยู่แล้ว จึงรันบน
GitHub Pages subpath ได้ทันที

## Azure AD App Registration

ค่าที่ตั้งไว้ใน `config/config.js` (`clientId`, `tenantId`) อ้างอิงจาก Azure AD App ที่ใช้งานจริงอยู่แล้ว
ถ้าต้องเพิ่ม Redirect URI ใหม่:

1. ไปที่ Azure Portal → `App registrations` → เลือกแอป `DrawingReqApp` (หรือชื่อที่ตั้งไว้)
2. เปิด `Authentication` → เพิ่ม Platform `Single-page application`
3. เพิ่ม Redirect URI ของ environment ใหม่ เช่น `http://localhost:8080/`
4. ตรวจสอบว่า scope ที่ขอ (`User.Read`, `Sites.ReadWrite.All`, `Files.ReadWrite.All`, `Chat.ReadWrite`)
   ได้รับ consent แล้ว — `Chat.ReadWrite` จำเป็นสำหรับฟีเจอร์ Teams 1:1 chat แจ้งเตือน

## SharePoint Lists ที่ต้องมีอยู่แล้ว

ระบบนี้เชื่อมกับ List ชุดเดิมที่ใช้งานจริง ไม่ต้องสร้างใหม่ ดู field mapping เต็มที่
`config/schema.js`:

- **`DrawingRequests`** — คำร้องทั้งหมด field สำคัญ: `Title` (เลขคำร้อง), `Status0`,
  `ProjectName` (ประเภทคำร้อง), `ProjectName0` (ชื่อโครงการจริง), `DrawingNumber`,
  `AssigneeName`/`AssigneeEmail`, `ReviewerLv1`/`ReviewerLv2`, `DwgFileUrl`/`PdfFileUrl`,
  `NoteFromDrawing`, `MgrApprovedBy`/`MgrRejectReason`, `ReviewResult` ฯลฯ
- **`ProjectList`** — `Title`, `IsHidden`, `DefaultKwp`, `DefaultLocation`
- **`DrawingNumberList`** / **`DrawingNameList`** — `Title`, `ProjectName`, `DrawingCategory`, `IsHidden`
- **`KwpList`** — `Title`, `IsHidden`
- **`DrawingTeam`** — `Title0` (ชื่อ-นามสกุล), `Email`, `Role`, `IsActive`
- **`HolidayList`** — `Title`, `HolidayDate`
- **`AuditLog`** — `Title`, `RequestId`, `UserEmail`, `UserName`, `Detail`, `ActionAt`

## Notifications

ตั้งค่าใน `config/config.js` → `teams.drawingTeamChatId` (Teams group chat สำหรับแจ้งคำร้องใหม่)
และ `approverLv2Emails` (รายชื่อผู้จัดการที่ได้รับแจ้ง mgr_review)

การแจ้งเตือนทั้งหมดส่งผ่าน Microsoft Graph API โดยตรง (1:1 chat + group chat + email) ไม่ได้พึ่ง
Power Automate หรือ Teams Incoming Webhook — ดู `assets/js/graph.js`

## Local Run

```bash
python -m http.server 8080
```

แล้วเปิด `http://localhost:8080/` — ต้อง login ด้วยบัญชี Microsoft 365 จริงเสมอ (ไม่มี mock mode
แล้ว) เพราะข้อมูลทั้งหมดดึงจาก SharePoint จริง

## File Structure

- `config/` — `config.js` (Azure/SharePoint/Teams config จริง), `schema.js` (field mapping + STATUS
  enum — **single source of truth** สำหรับชื่อ field และสถานะทั้งระบบ), `roles.js` (permission model
  เสริม ไม่ได้ใช้งานจริงในปัจจุบัน)
- `assets/css/` — design tokens, layout, components (รวม class ใหม่สำหรับ admin/track cards),
  responsive, dark mode
- `assets/js/` — `main.js` (bootstrap + MSAL login), `state.js`, `router.js`, `auth.js`, `graph.js`
  (Graph API + Teams 1:1 chat), `sharepoint.js` (List ID caching + master data loader),
  `utils.js`
- `assets/js/components/` — UI reusable components (modal, toast, table, badge, timeline)
- `assets/js/pages/` — `dashboard.js`, `submit.js`, `track.js` (ใหญ่สุด — รวม 4 มุมมองตาม role),
  `admin.js` (Lv.1/Lv.2 approval), `report.js`, `guide.js`
- `assets/js/services/` — `request-service.js` (หัวใจของระบบ — ทุก state transition + Teams notify),
  `drawing-service.js`, `team-service.js`, `project-service.js`, `role-service.js`
  (คำนวณ role จากอีเมล), `audit-service.js`, `report-service.js`
- `assets/vendor/` — `msal-browser.min.js` (โหลดตรงจาก `<script>` tag ใน `index.html`,
  มี fallback CDN ใน `auth.js` ถ้าไฟล์ local ใช้ไม่ได้)

## ไฟล์ที่ไม่ใช้แล้ว

`_reference_original_mockup_DO_NOT_USE.html` คือไฟล์ demo ตัวเดิมก่อนเชื่อม SharePoint จริง
(ใช้ mock data ในเครื่องล้วน) เก็บไว้เป็นข้อมูลอ้างอิงเท่านั้น **ไม่ใช่ส่วนหนึ่งของแอปที่ deploy จริง**
