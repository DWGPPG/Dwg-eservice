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
    dataLink: "DataLink",
    reviseNumber: "ReviseNumber",
    currentRevise: "CurrentRevise",
    priority: "Urgency",
    dueDate: "DueDate",
    description: "Detail",
    revisionReason: "RevisionReason",
    refRequestId: "RefRequestId",
    isRevision: "IsRevision",
    status: "Status0",
    submittedAt: "SubmittedAt",
    // ── Lv.1 / Lv.2 (2-level approval) ──
    assignedToName: "AssigneeName",
    assignedToEmail: "AssigneeEmail",
    reviewerLv1: "ReviewerLv1",
    reviewerLv2: "ReviewerLv2",
    assignNote: "AssignNote",
    approvedLv2At: "ApprovedLv2At",
    // ── reject / cancel ──
    rejectReason: "RejectReason",
    // ── sendwork → mgr_review → delivered ──
    dwgFileUrl: "DwgFileUrl",
    pdfFileUrl: "PdfFileUrl",
    noteFromDrawing: "NoteFromDrawing",
    deliveredAt: "eliveredAt",            // หมายเหตุ: internal name ของ SharePoint ขาดตัว D จริง (legacy typo คงไว้ตามของเดิม)
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
