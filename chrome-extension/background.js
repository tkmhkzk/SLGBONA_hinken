// background.js — Service Worker
// 状態はすべて chrome.storage.session で管理（SW終了対策）

// ────────────────────────────────────────────────
// メッセージハンドラ
// ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "RECORD_ACTION":
      handleRecordAction(message.payload, sender).then(sendResponse);
      return true; // async response

    case "START_RECORDING":
      handleStartRecording(message.payload).then(sendResponse);
      return true;

    case "STOP_RECORDING":
      handleStopRecording().then(sendResponse);
      return true;

    case "GET_STATE":
      chrome.storage.session.get(["isRecording", "manualTitle", "steps"], (data) => {
        sendResponse({
          isRecording: data.isRecording || false,
          manualTitle: data.manualTitle || "",
          stepCount: (data.steps || []).length,
          lastStep: (data.steps || []).slice(-1)[0] || null,
        });
      });
      return true;

    case "GET_STEPS":
      chrome.storage.session.get(["steps", "manualTitle", "startedAt"], (data) => {
        sendResponse({
          steps: data.steps || [],
          manualTitle: data.manualTitle || "",
          startedAt: data.startedAt || null,
        });
      });
      return true;

    case "CLEAR_STEPS":
      chrome.storage.session.set({ steps: [], manualTitle: "", startedAt: null, isRecording: false }, () => {
        sendResponse({ ok: true });
      });
      return true;

    case "OPEN_PREVIEW":
      chrome.tabs.create({ url: chrome.runtime.getURL("preview/preview.html") });
      sendResponse({ ok: true });
      return false;
  }
});

// ────────────────────────────────────────────────
// 記録開始
// ────────────────────────────────────────────────
async function handleStartRecording({ title }) {
  await chrome.storage.session.set({
    isRecording: true,
    manualTitle: title || "操作マニュアル",
    steps: [],
    startedAt: Date.now(),
  });

  // 既存のアクティブタブにコンテンツスクリプトを注入（既存タブ対応）
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://")) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      }).catch(() => {}); // 既に注入済みの場合はエラーを無視
    }
  } catch (_) {}

  // バッジを更新
  chrome.action.setBadgeText({ text: "●" });
  chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });

  return { ok: true };
}

// ────────────────────────────────────────────────
// 記録停止
// ────────────────────────────────────────────────
async function handleStopRecording() {
  await chrome.storage.session.set({ isRecording: false });
  chrome.action.setBadgeText({ text: "" });
  return { ok: true };
}

// ────────────────────────────────────────────────
// アクション記録
// ────────────────────────────────────────────────
async function handleRecordAction(payload, sender) {
  const data = await chrome.storage.session.get(["isRecording", "steps"]);
  if (!data.isRecording) return { ok: false };

  // スクリーンショットを即座に取得（DOM変化前）
  let screenshot = null;
  try {
    const tab = sender.tab;
    if (tab && tab.windowId) {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 75 });
      screenshot = await resizeScreenshot(dataUrl, 1200);
    }
  } catch (e) {
    // スクリーンショット取得失敗は無視して続行
  }

  const steps = data.steps || [];
  const step = {
    id: steps.length + 1,
    timestamp: payload.timestamp || Date.now(),
    type: payload.type,
    url: payload.url,
    pageTitle: payload.pageTitle,
    description: generateDescription(payload),
    screenshot,
    meta: payload.meta || {},
  };

  steps.push(step);
  await chrome.storage.session.set({ steps });

  // バッジのステップ数を更新
  chrome.action.setBadgeText({ text: String(steps.length) });

  return { ok: true, stepId: step.id };
}

// ────────────────────────────────────────────────
// 日本語説明文生成（ルールベース）
// ────────────────────────────────────────────────
function generateDescription({ type, meta = {}, pageTitle, url }) {
  const label = meta.label || "要素";
  const value = truncate(meta.value || "", 30);

  switch (type) {
    case "navigate":
      return `「${pageTitle || url}」ページに移動します。`;

    case "click": {
      const tag = (meta.tagName || "").toUpperCase();
      if (tag === "A" && meta.href) {
        return `「${label}」リンクをクリックします。`;
      }
      if (tag === "BUTTON" || meta.inputType === "submit" || meta.inputType === "button") {
        return `「${label}」ボタンをクリックします。`;
      }
      if (meta.inputType === "checkbox") {
        return `「${label}」チェックボックスを${meta.checked ? "オン" : "オフ"}にします。`;
      }
      if (meta.inputType === "radio") {
        return `「${label}」を選択します。`;
      }
      return `「${label}」をクリックします。`;
    }

    case "input": {
      if (meta.inputType === "password") {
        return `「${label}」にパスワードを入力します。`;
      }
      if (meta.inputType === "search") {
        return `「${label}」に「${value}」と検索キーワードを入力します。`;
      }
      if ((meta.tagName || "").toUpperCase() === "TEXTAREA") {
        return `「${label}」に内容を入力します。`;
      }
      if (value) {
        return `「${label}」に「${value}」と入力します。`;
      }
      return `「${label}」を入力します。`;
    }

    case "change": {
      const tag = (meta.tagName || "").toUpperCase();
      if (tag === "SELECT") {
        return `「${label}」で「${value}」を選択します。`;
      }
      if (meta.inputType === "checkbox") {
        return `「${label}」チェックボックスを${meta.checked ? "オン" : "オフ"}にします。`;
      }
      return `「${label}」の値を「${value}」に変更します。`;
    }

    case "submit":
      return `フォームを送信します。`;

    case "scroll":
      return `ページをスクロールします。`;

    default:
      return `操作を実行します。`;
  }
}

function truncate(str, maxLen) {
  if (!str) return "";
  str = String(str);
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

// ────────────────────────────────────────────────
// スクリーンショットのリサイズ（OffscreenCanvas）
// ────────────────────────────────────────────────
async function resizeScreenshot(dataUrl, maxWidth) {
  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);

    const scale = Math.min(1, maxWidth / bitmap.width);
    const w = Math.floor(bitmap.width * scale);
    const h = Math.floor(bitmap.height * scale);

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const outputBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(outputBlob);
    });
  } catch (_) {
    return dataUrl; // リサイズ失敗時はそのまま返す
  }
}
