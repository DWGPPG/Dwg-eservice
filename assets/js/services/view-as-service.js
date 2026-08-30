// ══════════════════════════════════════════════════════════════
// VIEW-AS SERVICE — ให้ผู้จัดการสลับดูระบบในมุมมองของบทบาทอื่นได้
//
// หลักการสำคัญด้านความปลอดภัย:
//   • state.user.role      = "มุมมองที่กำลังใช้อยู่" — UI ทั้งระบบอ่านค่านี้
//   • state.user.actualRole = "สิทธิ์จริง" จาก SharePoint — ห้ามแก้จาก UI เด็ดขาด
//   • สลับได้เฉพาะผู้ที่มี actualRole = manager เท่านั้น
//   • สลับได้เฉพาะมุมมองที่ "สิทธิ์เท่ากันหรือต่ำกว่า" ตัวเอง — ยกระดับสิทธิ์ไม่ได้
//     (เจ้าหน้าที่จะสลับเป็นผู้จัดการเพื่อเข้าถึงเมนูรายงานไม่ได้)
// ══════════════════════════════════════════════════════════════

import { roleLabel } from "./role-service.js";
import { setState, state } from "../state.js";

/** มุมมองที่เลือกได้ เรียงจากสิทธิ์สูงไปต่ำ */
export const VIEW_AS_OPTIONS = [
  { role: "manager",   icon: "🧑‍💼", label: "ผู้จัดการ",     desc: "เห็นทุกเมนู รวมรายงานและอนุมัติงาน" },
  { role: "designer",  icon: "👷",   label: "ฝ่ายเขียนแบบ", desc: "เห็นเมนูรับงาน/อนุมัติ แต่ไม่เห็นรายงาน" },
  { role: "requester", icon: "👤",   label: "ผู้ส่งคำร้อง",  desc: "เห็นเฉพาะเมนูส่งคำร้องและติดตามงาน" },
];

/** เฉพาะผู้จัดการตัวจริงเท่านั้นที่สลับมุมมองได้ */
export function canSwitchView(user = state.user) {
  return user?.actualRole === "manager";
}

/** กำลังดูมุมมองอื่นที่ไม่ใช่ของตัวเองอยู่หรือไม่ */
export function isViewingAsOther(user = state.user) {
  if (!user) return false;
  return Boolean(user.viewAs) && user.viewAs !== user.actualRole;
}

/** มุมมองที่กำลังใช้อยู่ */
export function currentViewRole(user = state.user) {
  return user?.role || user?.actualRole || "viewer";
}

/**
 * สลับมุมมอง — คืน true ถ้าสลับสำเร็จ
 * ปฏิเสธถ้าไม่มีสิทธิ์ หรือขอมุมมองที่ไม่มีอยู่จริง
 */
export function switchViewTo(targetRole) {
  if (!canSwitchView()) {
    console.warn("switchViewTo: ผู้ใช้นี้ไม่มีสิทธิ์สลับมุมมอง");
    return false;
  }
  if (!VIEW_AS_OPTIONS.some((o) => o.role === targetRole)) {
    console.warn("switchViewTo: ไม่รู้จักมุมมอง", targetRole);
    return false;
  }

  const isBackToSelf = targetRole === state.user.actualRole;
  setState({
    user: {
      ...state.user,
      role: targetRole,
      viewAs: isBackToSelf ? null : targetRole,
      roleLabel: roleLabel(targetRole, state.user.email),
    },
  });
  return true;
}

/** กลับสู่มุมมองจริงของตัวเอง */
export function resetView() {
  if (!canSwitchView()) return false;
  return switchViewTo(state.user.actualRole);
}
