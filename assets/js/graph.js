import { acquireToken } from "./auth.js";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

export async function graphFetch(path, options = {}) {
  const token = await acquireToken();
  if (!token) throw new Error("Missing Microsoft Graph access token");

  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Graph API error ${response.status}: ${detail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export function getMe() {
  return graphFetch("/me");
}

export function getSiteByPath(hostname, sitePath) {
  return graphFetch(`/sites/${hostname}:${sitePath}`);
}

// ── List items: ดึงทุกหน้า (pagination) ไม่จำกัดจำนวน ──
export async function listItems(siteId, listId, query = "?expand=fields&$top=500") {
  let url = `/sites/${siteId}/lists/${listId}/items${query}`;
  let all = [];
  while (url) {
    const response = await graphFetch(url);
    all = all.concat(response.value || []);
    const next = response["@odata.nextLink"];
    url = next ? next.replace(GRAPH_ROOT, "") : null;
  }
  return { value: all };
}

export function getListByName(siteId, listName) {
  return graphFetch(`/sites/${siteId}/lists?$filter=displayName eq '${encodeURIComponent(listName)}'`);
}

export function createListItem(siteId, listId, fields) {
  return graphFetch(`/sites/${siteId}/lists/${listId}/items`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export function updateListItem(siteId, listId, itemId, fields) {
  return graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

// ขนาด chunk 10MB — ต้องเป็นทวีคูณของ 320KB ตาม Graph API spec
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const SMALL_FILE_LIMIT = 4 * 1024 * 1024; // 4 MB — ขีดจำกัดของ simple PUT

/**
 * อัปโหลดไฟล์เข้า SharePoint Drive
 * - ไฟล์ < 4MB: PUT ตรง (เร็ว)
 * - ไฟล์ >= 4MB: Upload Session แบบ chunked (รองรับไฟล์ใหญ่ถึง 1GB+)
 * @param {string} siteId
 * @param {string} folder
 * @param {File} file
 * @param {function} onProgress  callback(percent: number, loaded: number, total: number)
 */
export async function uploadDriveFile(siteId, folder, file, onProgress = null) {
  const token = await acquireToken();
  if (!token) throw new Error("Missing Microsoft Graph access token");

  const encodedFolder = folder.split("/").map(encodeURIComponent).join("/");
  const encodedFile   = encodeURIComponent(file.name);

  if (file.size <= SMALL_FILE_LIMIT) {
    // ── Simple PUT สำหรับไฟล์เล็ก ──
    const path = `${GRAPH_ROOT}/sites/${siteId}/drive/root:/${encodedFolder}/${encodedFile}:/content`;
    const response = await fetch(path, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Graph upload error ${response.status}: ${detail}`);
    }
    if (onProgress) onProgress(100, file.size, file.size);
    return response.json();
  }

  // ── Upload Session สำหรับไฟล์ใหญ่ (chunked) ──
  const sessionPath = `${GRAPH_ROOT}/sites/${siteId}/drive/root:/${encodedFolder}/${encodedFile}:/createUploadSession`;
  const sessionResp = await fetch(sessionPath, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      item: {
        "@microsoft.graph.conflictBehavior": "replace",
        name: file.name,
      },
    }),
  });
  if (!sessionResp.ok) {
    const detail = await sessionResp.text();
    throw new Error(`Upload session error ${sessionResp.status}: ${detail}`);
  }
  const { uploadUrl } = await sessionResp.json();

  let offset = 0;
  let result  = null;

  while (offset < file.size) {
    const end   = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);

    const chunkResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - offset),
        "Content-Range":  `bytes ${offset}-${end - 1}/${file.size}`,
        "Content-Type":   file.type || "application/octet-stream",
      },
      body: chunk,
    });

    if (!chunkResp.ok && chunkResp.status !== 202) {
      const detail = await chunkResp.text();
      throw new Error(`Chunk upload error ${chunkResp.status}: ${detail}`);
    }

    offset = end;
    if (onProgress) onProgress(Math.round((offset / file.size) * 100), offset, file.size);

    // สถานะ 201/200 = อัปโหลดเสร็จสมบูรณ์
    if (chunkResp.status === 201 || chunkResp.status === 200) {
      result = await chunkResp.json();
    }
  }

  return result || { name: file.name };
}

export async function ensureDriveFolder(siteId, folderPath) {
  const token = await acquireToken();
  if (!token) throw new Error("Missing Microsoft Graph access token");
  const segments = String(folderPath || "").split("/").filter(Boolean);
  let parentPath = "";
  let latest = null;

  for (const segment of segments) {
    const encodedParent = parentPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const parentEndpoint = encodedParent
      ? `${GRAPH_ROOT}/sites/${siteId}/drive/root:/${encodedParent}:/children`
      : `${GRAPH_ROOT}/sites/${siteId}/drive/root/children`;
    const response = await fetch(parentEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: segment,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });

    if (response.ok) latest = await response.json();
    else if (response.status !== 409) {
      const detail = await response.text();
      throw new Error(`Graph folder error ${response.status}: ${detail}`);
    }
    parentPath = [...parentPath.split("/").filter(Boolean), segment].join("/");
  }
  return latest;
}

// ══════════════════════════════════════════════════════════════
// TEAMS 1:1 CHAT — ของใหม่ที่ index__5_.html มีแต่ DWG PRIME ไม่มี
// ใช้ส่งแจ้งเตือนแบบ 1:1 ระหว่าง Lv.1/Lv.2/ผู้เขียนแบบ/ผู้ร้องขอ
// ══════════════════════════════════════════════════════════════

/**
 * สร้างหรือหา 1:1 chat ระหว่างผู้ใช้ปัจจุบันกับ targetEmail แล้วส่งข้อความ HTML
 * คืนค่า true ถ้าส่งสำเร็จ, false ถ้าส่งไม่สำเร็จ (ไม่ throw เพื่อไม่ให้ flow หลักสะดุด)
 */
export async function sendTeams1on1(targetEmail, htmlContent) {
  if (!targetEmail) return false;
  try {
    const token = await acquireToken();
    if (!token) return false;

    const me = await getMe();
    const myEmail = (me?.mail || me?.userPrincipalName || "").toLowerCase();
    const myId = me?.id;
    if (!myId || targetEmail.toLowerCase() === myEmail) return false;

    let chatId = await createOrFindChat(myId, targetEmail, token);
    if (!chatId) return false;

    const resp = await fetch(`${GRAPH_ROOT}/chats/${chatId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: {
          contentType: "html",
          // ห่อ div เพื่อให้ Graph API รับ HTML ได้ถูกต้อง (plain string โดยไม่มี root element บางครั้ง 400)
          content: `<div>${htmlContent}</div>`,
        },
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.warn("sendTeams1on1 message failed:", resp.status, detail);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("sendTeams1on1 failed (non-critical):", error.message);
    return false;
  }
}

async function createOrFindChat(myId, targetEmail, token) {
  // ก่อนสร้าง chat ใหม่ ให้ค้นหาก่อนเพื่อหลีกเลี่ยง 409 ที่ไม่ return chatId
  try {
    const listResp = await fetch(
      `${GRAPH_ROOT}/me/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (listResp.ok) {
      const listData = await listResp.json();
      const found = (listData?.value || []).find((c) =>
        (c.members || []).some(
          (m) => (m.email || m.userId || "").toLowerCase() === targetEmail.toLowerCase()
        )
      );
      if (found?.id) return found.id;
    }
  } catch (_) { /* ถ้าค้นหาไม่สำเร็จ ให้ลองสร้างใหม่ */ }

  const chatResp = await fetch(`${GRAPH_ROOT}/chats`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatType: "oneOnOne",
      members: [
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `${GRAPH_ROOT}/users('${targetEmail}')`,
        },
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `${GRAPH_ROOT}/users('${myId}')`,
        },
      ],
    }),
  });

  if (chatResp.ok) {
    const data = await chatResp.json();
    return data.id || null;
  }

  if (chatResp.status === 409) {
    // 409 = chat มีอยู่แล้ว — Graph API บางครั้งคืน chatId ไว้ใน innerError
    try {
      const errBody = await chatResp.json();
      const chatId = errBody?.error?.innerError?.id || null;
      if (chatId) return chatId;
    } catch (_) {}
    // ค้นหาอีกรอบหลังจาก 409
    try {
      const listResp2 = await fetch(
        `${GRAPH_ROOT}/me/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (listResp2.ok) {
        const listData2 = await listResp2.json();
        const found2 = (listData2?.value || []).find((c) =>
          (c.members || []).some(
            (m) => (m.email || m.userId || "").toLowerCase() === targetEmail.toLowerCase()
          )
        );
        return found2?.id || null;
      }
    } catch (_) {}
  }

  console.warn("createOrFindChat failed with status:", chatResp.status);
  return null;
}

/** ส่งข้อความเข้ากลุ่ม Teams (ใช้สำหรับแจ้งคำร้องใหม่เข้ากลุ่ม Drawing Dept.) */
export async function sendTeamsGroup(chatId, htmlContent) {
  if (!chatId) return false;
  try {
    const token = await acquireToken();
    if (!token) return false;
    const resp = await fetch(`${GRAPH_ROOT}/chats/${chatId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: {
          contentType: "html",
          content: `<div>${htmlContent}</div>`,
        },
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.warn("sendTeamsGroup failed:", resp.status, detail);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("sendTeamsGroup failed (non-critical):", error.message);
    return false;
  }
}

/** ส่งอีเมลผ่าน Graph API (/me/sendMail) */
export async function sendMail(toEmail, subject, htmlBody) {
  if (!toEmail) return false;
  try {
    const token = await acquireToken();
    if (!token) return false;
    const resp = await fetch(`${GRAPH_ROOT}/me/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: htmlBody },
          toRecipients: [{ emailAddress: { address: toEmail } }],
        },
        saveToSentItems: "false",
      }),
    });
    if (!resp.ok && resp.status !== 202) {
      const detail = await resp.text();
      console.warn("sendMail failed:", resp.status, detail);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("sendMail failed (non-critical):", error.message);
    return false;
  }
}

/**
 * ส่งข้อความ "คำร้องใหม่" เข้า Teams Group Chat ผ่าน Power Automate webhook
 * ไม่ต้องใช้ user token — ใครส่งคำร้องก็แจ้งเตือนกลุ่มได้เสมอ เพราะ Flow รันด้วย
 * identity ของเจ้าของ Flow ไม่ใช่ของผู้ส่งคำร้อง (แก้ปัญหา Requester ไม่ได้เป็นสมาชิก Group Chat)
 * Field ต้องตรงกับ "Request Body JSON Schema" ที่ตั้งไว้ใน Flow trigger เป๊ะๆ
 * @param {string} webhookUrl
 * @param {Object} fields — { requestNo, requestType, projectName, drawingNo, drawingName, requesterName, submittedAt, isRevision }
 */
export async function sendNewRequestWebhook(webhookUrl, fields) {
  if (!webhookUrl) return false;
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.warn("sendNewRequestWebhook (Power Automate) failed:", resp.status, detail);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("sendNewRequestWebhook failed (non-critical):", error.message);
    return false;
  }
}

/**
 * ส่งข้อความเข้า Teams group ผ่าน Incoming Webhook
 * ไม่ต้องใช้ user token — ใครส่งคำขอก็แจ้งเตือนกลุ่มได้เสมอ
 * @param {string} webhookUrl  — URL จาก Teams Connector > Incoming Webhook
 * @param {string} title       — หัวข้อข้อความ (bold)
 * @param {Object[]} facts     — รายการข้อมูล [{ name, value }, ...]
 * @param {string} [actionUrl] — ลิงก์ปุ่ม "เข้าระบบตรวจสอบ" (optional)
 */
export async function sendTeamsWebhook(webhookUrl, title, facts = [], actionUrl = "") {
  if (!webhookUrl) return false;
  try {
    // ส่ง JSON ตรงไปยัง Power Automate Flow
    // Flow จะรับ field เหล่านี้แล้วโพสต์เข้ากลุ่ม Teams "Drawing Dept. นะจ๊ะ"
    const payload = { title };
    facts.forEach((f) => {
      // แปลง name เป็น camelCase key เพื่อให้ตรงกับ Flow schema
      const key = f.name
        .replace(/[^a-zA-Zก-๙0-9\s]/g, "")
        .trim()
        .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toLowerCase());
      payload[key] = f.value;
    });
    if (actionUrl) payload.actionUrl = actionUrl;

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.warn("sendTeamsWebhook (Power Automate) failed:", resp.status, detail);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("sendTeamsWebhook failed (non-critical):", error.message);
    return false;
  }
}
