// ── SharePoint List names — ตรงกับ CONFIG เดิมใน index__5_.html ──
export const lists = {
  requests: "DrawingRequests",
  projects: "ProjectList",
  drawingNumbers: "DrawingNumberList",
  drawingNames: "DrawingNameList",
  kwp: "KwpList",
  team: "DrawingTeam",
  auditLog: "AuditLog",
  holidays: "HolidayList",
  teamPulse: "TeamPulsePosts",
};

// ── Field mapping: local key (ใช้ในโค้ด JS) → SharePoint internal field name จริง ──
// อ้างอิงจาก index__5_.html CONFIG / spCreateItem / spUpdateItem ทุกจุด
export const fields = {
  requests: {
    title: "Title",                       // เลขที่คำร้อง เช่น DWG-DES-2569-0001
    requestType: "ProjectName",            // ประเภทคำร้อง (📋 เขียนแบบ Proposal ฯลฯ) — ชื่อ field ใน SP ตั้งสับสนแต่เป็นแบบนี้จริง
    projectName: "ProjectName0",           // ชื่อโครงการจริง
    department: "Department",
    drawingNo: "DrawingNumber",
    drawingName: "DrawingName",
    drawingCategory: "DrawingCategory",
    kwp: "SolarKwp",
    location: "Location",
    requesterEmail: "SenderEmail",
    requesterName: "SenderName",
    dataLink: "DataLinkText",  // Multiple lines of text (แทน DataLink Hyperlink เดิม)
    reviseNumber: "ReviseNumber",
    currentRevise: "CurrentRevise",
    priority: "Urgency",
    dueDate: "DueDate",
    description: "Detail",
    revisionReason: "RevisionReason",
    refRequestId: "RefRequestId",
    isRevision: "IsRevision",
    status: "Status",
    submittedAt: "SubmittedAt",
    // ── Lv.1 / Lv.2 (2-level approval) ──
    assignedToName: "AssigneeName",
    assignedToEmail: "AssigneeEmail",
    reviewerLv1: "ReviewerLv1",
    reviewerLv2: "ReviewerLv2",
    assignNote: "AssignNote",
    approvedLv2At: "ApprovedAt",
    // ── reject / cancel ──
    rejectReason: "RejectReason",
    // ── ข้อมูลการยกเลิก (ใช้คำนวณ Cancellation KPI) ──
    // ⚠️ ถ้ายังไม่ได้สร้าง column เหล่านี้ใน SharePoint ระบบยังทำงานปกติ
    //    (patchItem จะตัด field ที่ไม่รู้จักออกอัตโนมัติ) แต่ KPI จะ fallback ไปเดาจาก ApprovedAt แทน
    cancelledByName: "CancelledByName",    // ชื่อผู้ที่กดยกเลิก
    cancelledByEmail: "CancelledByEmail",  // อีเมลผู้ที่กดยกเลิก
    cancelledStage: "CancelledStage",      // สถานะ ณ ตอนที่ถูกยกเลิก (pending/approved/working/...)
    cancelledSource: "CancelledSource",    // ต้นเหตุการยกเลิก: รหัส 2.1–2.5 (ดู CANCEL_SOURCES ท้ายไฟล์) — รองรับค่าเก่า requester/drawing อัตโนมัติ
    cancelledAt: "CancelledAt",            // วันเวลาที่ยกเลิก
    // วันเวลาที่ "ฝ่ายเขียนแบบ" กดเสร็จสิ้น/ส่งงาน (ใช้วัดว่าส่งช้ากว่ากำหนดหรือไม่)
    deptFinishedAt: "DeptFinishedAt",
    // ── sendwork → mgr_review → delivered ──
    dwgFileUrl: "DwgFileLink",
    pdfFileUrl: "PdfFileLink",
    noteFromDrawing: "NoteFromDrawing",
    deliveredAt: "DeliveredAt",
    mgrApprovedBy: "MgrApprovedBy",
    mgrApprovedAt: "MgrApprovedAt",
    mgrRejectReason: "MgrRejectReason",
    mgrRejectedBy: "MgrRejectedBy",
    mgrRejectedAt: "MgrRejectedAt",
    // ── ผู้ร้องขอตรวจรับ ──
    reviewResult: "ReviewResult",          // approved | revise | reject
    reviseComment: "ReviseComment",
    deliveryRejectReason: "DeliveryRejectReason",
    reviewedAt: "ReviewedAt",
    doneAt: "DoneAt",
    reviewDeadline: "ReviewDeadline",
    autoApproved: "AutoApproved",
    deliveryFormUrl: "DeliveryFormUrl",
    deliveryFormGeneratedAt: "DeliveryFormGeneratedAt",
    revisionSource: "RevisionSource",      // สาเหตุการแก้ไข: 1.1/1.2/1.3/1.4
    revisionCount: "RevisionCount",        // จำนวนครั้งที่แก้ไข
    revisionEvidence: "RevisionEvidence",  // URL หลักฐาน
  },
  projects: {
    title: "Title",
    isHidden: "IsHidden",
    defaultKwp: "DefaultKwp",
    solarKwp: "SolarKwp",
    defaultLocation: "DefaultLocation",
  },
  drawingNumbers: {
    title: "Title",
    projectName: "ProjectName",
    drawingCategory: "DrawingCategory",
    drawingName: "DrawingName",
    isHidden: "IsHidden",
  },
  drawingNames: {
    title: "Title",
    projectName: "ProjectName",
    drawingCategory: "DrawingCategory",
    isHidden: "IsHidden",
  },
  kwp: {
    title: "Title",
    isHidden: "IsHidden",
  },
  team: {
    title: "Title0",
    email: "Email",
    role: "Role",
    isActive: "IsActive",
    isAdmin: "IsAdmin",
    displayLabel: "DisplayLabel",
  },
  holidays: {
    title: "Title",
    holidayDate: "HolidayDate",
  },
  audit: {
    title: "Title",
    requestId: "RequestId",
    userEmail: "UserEmail",
    userName: "UserName",
    detail: "Detail",
    actionAt: "ActionAt",
  },

  // ══════════════════════════════════════════════════════════════
  // Team Pulse — เช็คอินความรู้สึก/แผนงานประจำวันของฝ่ายเขียนแบบ (หน้าภาพรวม)
  // ตั้งใจใช้ Single line / Multiple lines of text ทั้งหมด (ไม่ใช้ Choice/Number/Yes-No)
  // เพื่อเลี่ยงปัญหา Graph API 400 แบบที่เจอกับ ReviewResult/RevisionSource มาก่อน —
  // ค่าที่ควรเป็น boolean/choice จะเก็บเป็น string ธรรมดา ("Yes"/"No", "good"/"fire" ฯลฯ) แทน
  // ══════════════════════════════════════════════════════════════
  teamPulse: {
    title: "Title",                // เก็บข้อความโพสต์ (ตัดสั้น) ไว้ให้เห็นตอนเปิดดู List ตรงๆ
    authorEmail: "AuthorEmail",    // Single line of text
    authorName: "AuthorName",      // Single line of text
    mood: "Mood",                  // Single line of text — เก็บ key: good/ok/meh/tired/fire
    postText: "PostText",          // Multiple lines of text — ข้อความเต็ม ไม่จำกัดความยาว
    reactions: "Reactions",        // Multiple lines of text — JSON string {emojiKey:[email,...]}
    postedAt: "PostedAt",          // Date and Time
    editedAt: "EditedAt",          // Date and Time (ว่างได้ถ้ายังไม่เคยแก้ไข)
  },
};

// ── Status flow ที่ใช้จริงทั้งระบบ (ตรงกับ index__5_.html) ──
export const STATUS = {
  PENDING: "pending",                  // รอตรวจสอบ Lv.1
  INPROGRESS_LV1: "inprogress_lv1",    // Lv.1 มอบหมายแล้ว รอ Lv.2 อนุมัติ
  APPROVED: "approved",                // Lv.2 อนุมัติแล้ว เริ่มงานได้
  WORKING: "working",                  // กำลังดำเนินการ (ผู้เขียนแบบอัปเดตเอง)
  MGR_REVIEW: "mgr_review",            // ผู้เขียนแบบส่งงานแล้ว รอผู้จัดการ QC ตรวจ+ส่งมอบ
  MGR_REJECTED: "mgr_rejected",        // ผู้จัดการส่งกลับแก้ไข (กลับไปทำงานใหม่)
  DELIVERED: "delivered",              // ผู้จัดการอนุมัติส่งมอบแล้ว รอผู้ร้องขอตรวจรับ
  DONE: "done",                        // ผู้ร้องขอตรวจรับแล้ว เสร็จสมบูรณ์
  CANCELLED: "cancelled",              // ยกเลิกคำร้อง
  REJECTED: "rejected",                // Lv.1/Lv.2 ส่งกลับผู้ร้องขอ
};

export const STATUS_LABELS = {
  [STATUS.PENDING]: "รอตรวจสอบ Lv.1",
  [STATUS.INPROGRESS_LV1]: "รอ LV.2 ผู้จัดการอนุมัติ",
  [STATUS.APPROVED]: "ตรวจสอบแล้ว กำลังดำเนินการ",
  [STATUS.WORKING]: "กำลังดำเนินการ",
  [STATUS.MGR_REVIEW]: "รอผู้จัดการตรวจ+ส่งมอบ",
  [STATUS.MGR_REJECTED]: "ผู้จัดการส่งกลับแก้ไข",
  [STATUS.DELIVERED]: "ส่งมอบแล้ว รอตรวจรับ",
  [STATUS.DONE]: "เสร็จสิ้น",
  [STATUS.CANCELLED]: "ยกเลิก",
  [STATUS.REJECTED]: "ส่งกลับแก้ไข",
};

export const ACTIVE_STATUSES = [
  STATUS.PENDING,
  STATUS.INPROGRESS_LV1,
  STATUS.APPROVED,
  STATUS.WORKING,
  STATUS.MGR_REVIEW,
  STATUS.MGR_REJECTED,
  STATUS.DELIVERED,
];

export const CLOSED_STATUSES = [STATUS.DONE, STATUS.CANCELLED, STATUS.REJECTED];

// ══════════════════════════════════════════════════════════════
// CANCELLATION TAXONOMY — ต้นเหตุการยกเลิก (รหัส 2.1–2.5)
// ──────────────────────────────────────────────────────────────
// แยก 2 ตัวชี้วัดที่ต่างกันออกจากกัน:
//   • countsAsDeptFault = ฝ่ายเขียนแบบผิดเอง → นับเข้า "Dept-Fault Cancellation Rate"
//                         (ตัววัดคุณภาพงานของฝ่าย อยู่กลุ่มเดียวกับสาเหตุ 1.1)
//   • countsAsWasted    = ชั่วโมงที่ลงแรงไปแล้วสูญเปล่า → นับเข้า "Wasted Cost"
//                         (ตัววัดความสูญเสีย ไม่ว่าใครผิด — ฝ่ายเป็นผู้รับผลกระทบ)
// หมายเหตุ: ทั้งสองตัวนับเฉพาะกรณีที่ "ฝ่ายลงมือทำไปแล้ว" เท่านั้น
// ══════════════════════════════════════════════════════════════
export const CANCEL_SOURCES = [
  {
    code: "2.1", short: "ฝ่ายเขียนแบบผิดเอง",
    label: "2.1 ฝ่ายเขียนแบบเขียนผิด / ผิดสเปก ต้องทิ้งงาน",
    hint: "นับเข้า KPI คุณภาพฝ่าย + Wasted Cost",
    desc: "ฝ่ายเขียนแบบเขียนผิด ผิดสเปก หรือทำงานผิดจนต้องทิ้งงานที่ทำไปแล้ว เริ่มใหม่",
    legendBg: "#FEE2E2", legendAccent: "#EF4444", legendTitle: "#991B1B", legendText: "#7F1D1D",
    emoji: "🔴", badge: "background:#FEE2E2;color:#991B1B", bar: "#EF4444",
    countsAsDeptFault: true, countsAsWasted: true,
  },
  {
    code: "2.2", short: "ผู้ส่งคำร้อง",
    label: "2.2 ผู้ส่งคำร้องเปลี่ยนแผน / ให้ข้อมูลผิด",
    hint: "นับเข้า Wasted Cost (ฝ่ายเสียแรงเปล่า)",
    desc: "ผู้ส่งคำร้องเปลี่ยนแผน ยกเลิกงาน หรือให้ข้อมูลผิดตั้งแต่ต้น หลังฝ่ายลงมือแล้ว",
    legendBg: "#FEF9C3", legendAccent: "#EAB308", legendTitle: "#854D0E", legendText: "#713F12",
    emoji: "🟡", badge: "background:#FEF9C3;color:#854D0E", bar: "#EAB308",
    countsAsDeptFault: false, countsAsWasted: true,
  },
  {
    code: "2.3", short: "งานติดตั้ง/หน้างาน",
    label: "2.3 งานติดตั้ง / หน้างานเปลี่ยน",
    hint: "นับเข้า Wasted Cost (ฝ่ายเสียแรงเปล่า)",
    desc: "หน้างานเปลี่ยนแปลง งานติดตั้งปรับแผน ทำให้แบบที่เขียนไว้ใช้ไม่ได้",
    legendBg: "#FFEDD5", legendAccent: "#F97316", legendTitle: "#9A3412", legendText: "#7C2D12",
    emoji: "🟠", badge: "background:#FFEDD5;color:#9A3412", bar: "#F97316",
    countsAsDeptFault: false, countsAsWasted: true,
  },
  {
    code: "2.4", short: "ลูกค้า",
    label: "2.4 ลูกค้ายกเลิกโครงการ",
    hint: "นับเข้า Wasted Cost (ฝ่ายเสียแรงเปล่า)",
    desc: "ลูกค้ายกเลิกโครงการ หรือระงับงานกลางทาง เป็นความเสี่ยงทางธุรกิจ",
    legendBg: "#DBEAFE", legendAccent: "#3B82F6", legendTitle: "#1E3A8A", legendText: "#1E40AF",
    emoji: "🔵", badge: "background:#DBEAFE;color:#1E40AF", bar: "#3B82F6",
    countsAsDeptFault: false, countsAsWasted: true,
  },
  {
    code: "2.5", short: "ธุรการ",
    label: "2.5 ธุรการ — คำร้องซ้ำ / คีย์ผิด / ทดสอบระบบ",
    hint: "ไม่นับ KPI ใดๆ (ไม่ได้ลงมือเขียนจริง)",
    desc: "คำร้องซ้ำ คีย์ข้อมูลผิด หรือรายการทดสอบระบบ — ไม่ได้ลงมือเขียนแบบจริง",
    legendBg: "#F1F5F9", legendAccent: "#94A3B8", legendTitle: "#475569", legendText: "#64748B",
    emoji: "⚪", badge: "background:#F1F5F9;color:#475569", bar: "#94A3B8",
    countsAsDeptFault: false, countsAsWasted: false,
  },
];

/** ชั่วโมงงานที่สูญเปล่า ถ่วงตามจังหวะที่ถูกยกเลิก (ประเมินโดยฝ่ายเขียนแบบ) */
export const WASTED_HOURS_BY_STAGE = {
  [STATUS.APPROVED]:     0.5,  // รับงานแล้วแต่ยังไม่ลงมือเขียน
  [STATUS.WORKING]:      5,    // กำลังเขียนแบบอยู่
  [STATUS.MGR_REJECTED]: 5,    // เขียนแล้วถูกส่งกลับ กำลังแก้
  [STATUS.MGR_REVIEW]:   6,    // เขียนเสร็จ ส่งให้ผู้จัดการตรวจแล้ว
  [STATUS.DELIVERED]:    8,    // ส่งมอบให้ผู้ร้องขอแล้ว
};

/** ค้นหา metadata ของรหัสต้นเหตุ รองรับค่าเก่า requester/drawing */
export function getCancelSource(code) {
  const legacy = { requester: "2.2", drawing: "2.5" };
  const key = legacy[String(code || "").toLowerCase()] || String(code || "");
  return CANCEL_SOURCES.find((s) => s.code === key) || null;
}
