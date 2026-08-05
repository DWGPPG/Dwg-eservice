export function renderFileUpload(name = "attachments") {
  return `
    <label class="file-drop">
      <input type="file" name="${name}" multiple />
      <span class="file-drop-icon">⇪</span>
      <strong>Upload files</strong>
      <small>PDF, DWG, image, or supporting document</small>
    </label>
  `;
}

export function bindFilePreview(scope = document) {
  const input = scope.querySelector(".file-drop input");
  if (!input) return;
  input.addEventListener("change", () => {
    const names = Array.from(input.files).map((file) => file.name).join(", ");
    input.closest(".file-drop").querySelector("small").textContent = names || "PDF, DWG, image, or supporting document";
  });
}
