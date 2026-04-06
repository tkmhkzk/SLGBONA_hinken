// preview.js

const contentEl = document.getElementById("content");
const btnExportHtml = document.getElementById("btn-export-html");
const btnCopyMd = document.getElementById("btn-copy-md");
const toastEl = document.getElementById("toast");

let currentSteps = [];
let currentTitle = "";

// ────────────────────────────────────────────────
// データ読み込み
// ────────────────────────────────────────────────
function loadData() {
  chrome.storage.session.get(["steps", "manualTitle", "startedAt"], (data) => {
    const steps = data.steps || [];
    const title = data.manualTitle || "操作マニュアル";
    const startedAt = data.startedAt;

    currentSteps = steps;
    currentTitle = title;

    render(steps, title, startedAt);
  });
}

// ────────────────────────────────────────────────
// レンダリング
// ────────────────────────────────────────────────
function render(steps, title, startedAt) {
  if (steps.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <h2>記録がありません</h2>
        <p>拡張機能アイコンをクリックして<br>操作の記録を開始してください。</p>
      </div>
    `;
    btnExportHtml.disabled = true;
    btnCopyMd.disabled = true;
    return;
  }

  btnExportHtml.disabled = false;
  btnCopyMd.disabled = false;

  const generatedAt = formatDateTime(startedAt || Date.now());

  let html = `
    <div class="manual-header">
      <h1>【操作マニュアル】${escapeHtml(title)}</h1>
      <div class="manual-meta">作成日時: ${generatedAt} ／ 全 ${steps.length} ステップ</div>
    </div>
  `;

  for (const step of steps) {
    const time = formatDateTime(step.timestamp);
    const screenshotHtml = step.screenshot
      ? `<div class="step-screenshot"><img src="${step.screenshot}" alt="ステップ${step.id}のスクリーンショット" loading="lazy"></div>`
      : "";

    html += `
      <div class="step" id="step-${step.id}">
        <div class="step-header">
          <div class="step-number">${step.id}</div>
          <div class="step-description">${escapeHtml(step.description)}</div>
        </div>
        ${screenshotHtml}
        <div class="step-footer">
          <span class="step-url" title="${escapeHtml(step.url)}">${escapeHtml(step.url)}</span>
          <span class="step-time">${time}</span>
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = html;
}

// ────────────────────────────────────────────────
// HTML エクスポート（自己完結型）
// ────────────────────────────────────────────────
function exportHtml() {
  if (currentSteps.length === 0) return;

  const generatedAt = formatDateTime(Date.now());
  let stepsHtml = "";

  for (const step of currentSteps) {
    const time = formatDateTime(step.timestamp);
    const screenshotHtml = step.screenshot
      ? `<img src="${step.screenshot}" alt="ステップ${step.id}のスクリーンショット" style="width:100%;height:auto;display:block;">`
      : "";

    stepsHtml += `
      <div style="background:#fff;border-radius:10px;border:1px solid #e8eaf0;box-shadow:0 2px 8px rgba(0,0,0,0.04);margin-bottom:24px;overflow:hidden;">
        <div style="display:flex;align-items:flex-start;gap:14px;padding:16px 20px;border-bottom:1px solid #f0f2f5;">
          <div style="width:30px;height:30px;border-radius:50%;background:#1a56db;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${step.id}</div>
          <div style="font-size:14px;font-weight:600;color:#222;line-height:1.5;padding-top:4px;">${escapeHtml(step.description)}</div>
        </div>
        ${screenshotHtml}
        <div style="padding:8px 20px;display:flex;justify-content:space-between;font-size:11px;color:#999;background:#fafbfc;">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:75%;">${escapeHtml(step.url)}</span>
          <span>${time}</span>
        </div>
      </div>
    `;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>【操作マニュアル】${escapeHtml(currentTitle)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif;
      background: #f0f2f5;
      color: #333;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div style="background:#fff;border-radius:10px;padding:24px 28px;margin-bottom:24px;border:1px solid #e8eaf0;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <h1 style="font-size:20px;font-weight:700;color:#1a56db;margin-bottom:6px;">【操作マニュアル】${escapeHtml(currentTitle)}</h1>
      <div style="font-size:12px;color:#777;">作成日時: ${generatedAt} ／ 全 ${currentSteps.length} ステップ</div>
    </div>
    ${stepsHtml}
    <div style="text-align:center;margin-top:32px;font-size:11px;color:#aaa;">
      このマニュアルは「操作マニュアル自動生成」Chrome拡張機能で作成されました。
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `manual_${sanitizeFilename(currentTitle)}_${formatDateForFilename(Date.now())}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("HTMLファイルをダウンロードしました", "success");
}

// ────────────────────────────────────────────────
// Markdown コピー（スクリーンショットなし）
// ────────────────────────────────────────────────
function copyMarkdown() {
  if (currentSteps.length === 0) return;

  const generatedAt = formatDateTime(Date.now());
  let md = `# 【操作マニュアル】${currentTitle}\n\n`;
  md += `作成日時: ${generatedAt} ／ 全${currentSteps.length}ステップ\n\n---\n\n`;

  for (const step of currentSteps) {
    md += `## ステップ ${step.id}\n`;
    md += `${step.description}\n`;
    md += `URL: ${step.url}\n\n`;
  }

  navigator.clipboard.writeText(md).then(() => {
    showToast("Markdownをクリップボードにコピーしました", "success");
  }).catch(() => {
    showToast("コピーに失敗しました", "");
  });
}

// ────────────────────────────────────────────────
// トースト通知
// ────────────────────────────────────────────────
function showToast(message, type) {
  toastEl.textContent = message;
  toastEl.className = "toast" + (type === "success" ? " success" : "");
  toastEl.classList.add("show");
  setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3000);
}

// ────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDateForFilename(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitizeFilename(name) {
  return (name || "manual").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}

// ────────────────────────────────────────────────
// イベントバインド & 起動
// ────────────────────────────────────────────────
btnExportHtml.addEventListener("click", exportHtml);
btnCopyMd.addEventListener("click", copyMarkdown);

loadData();
