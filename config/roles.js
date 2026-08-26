export const roles = {
  requester: {
    label: "Requester",
    permissions: ["request:create", "request:read-own", "request:revise"],
  },
  approverLv1: {
    label: "Approver Lv.1",
    permissions: ["request:approve-lv1", "request:reject", "request:read-team"],
  },
  approverLv2: {
    label: "Approver Lv.2",
    permissions: ["request:approve-lv2", "request:reject", "request:read-team"],
  },
  manager: {
    label: "Manager",
    permissions: ["request:assign", "request:approve-start", "work:approve-delivery", "request:read-all", "report:read"],
  },
  drawingTeam: {
    label: "Drawing Team",
    permissions: ["work:send", "request:read-assigned"],
  },
  reviewAdmin: {
    label: "Review Admin",
    permissions: ["work:review", "request:close", "request:revision"],
  },
  admin: {
    label: "Admin",
    permissions: ["*"],
  },
};

export const roleMapping = {
  approver: ["approverLv1", "approverLv2"],
  manager: ["manager"],
  "review admin": ["reviewAdmin"],
};

export function hasPermission(userRoles = [], permission) {
  return userRoles.some((roleKey) => {
    const role = roles[roleKey];
    return role?.permissions.includes("*") || role?.permissions.includes(permission);
  });
}
