// popup.js

const viewIdle = document.getElementById("view-idle");
const viewRecording = document.getElementById("view-recording");
const manualTitleInput = document.getElementById("manual-title");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnPreviewPrev = document.getElementById("btn-preview-prev");
const btnClear = document.getElementById("btn-clear");
const previousSession = document.getElementById("previous-session");
const prevTitle = document.getElementById("prev-title");
const prevCount = document.getElementById("prev-count");
const recordingTitleEl = document.getElementById("recording-title");
const stepCountEl = document.getElementById("step-count");
const lastStepEl = document.getElementById("last-step");

let pollTimer = null;

// ────────────────────────────────────────────────
// 初期化：現在の状態を取得してビューを更新
// ────────────────────────────────────────────────
function init() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
    if (chrome.runtime.lastError || !res) return;

    if (res.isRecording) {
      showRecordingView(res);
      startPolling();
    } else {
      showIdleView(res);
    }
  });
}

// ────────────────────────────────────────────────
// アイドルビュー
// ────────────────────────────────────────────────
function showIdleView(state) {
  viewIdle.style.display = "block";
  viewRecording.style.display = "none";

  if (state && state.stepCount > 0) {
    previousSession.style.display = "block";
    prevTitle.textContent = state.manualTitle || "（タイトルなし）";
    prevCount.textContent = `${state.stepCount} ステップ`;
  } else {
    previousSession.style.display = "none";
  }
}

// ────────────────────────────────────────────────
// 記録中ビュー
// ────────────────────────────────────────────────
function showRecordingView(state) {
  viewIdle.style.display = "none";
  viewRecording.style.display = "block";

  if (state) {
    recordingTitleEl.textContent = `「${state.manualTitle || "操作マニュアル"}」`;
    stepCountEl.textContent = state.stepCount || 0;
    if (state.lastStep) {
      lastStepEl.textContent = state.lastStep.description;
    }
  }
}

// ────────────────────────────────────────────────
// ポーリング（記録中のみ）
// ────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (!res.isRecording) {
        stopPolling();
        showIdleView(res);
        return;
      }
      stepCountEl.textContent = res.stepCount || 0;
      if (res.lastStep) {
        lastStepEl.textContent = res.lastStep.description;
      }
    });
  }, 1000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ────────────────────────────────────────────────
// イベントハンドラ
// ────────────────────────────────────────────────

// 記録開始
btnStart.addEventListener("click", () => {
  const title = manualTitleInput.value.trim() || "操作マニュアル";
  chrome.runtime.sendMessage({ type: "START_RECORDING", payload: { title } }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    showRecordingView({ manualTitle: title, stepCount: 0, lastStep: null });
    startPolling();
  });
});

// 記録停止
btnStop.addEventListener("click", () => {
  stopPolling();
  chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, () => {
    // プレビューページを開く
    chrome.tabs.create({ url: chrome.runtime.getURL("preview/preview.html") });
    window.close();
  });
});

// プレビュー
btnPreviewPrev.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("preview/preview.html") });
  window.close();
});

// クリア
btnClear.addEventListener("click", () => {
  if (!confirm("記録をクリアしますか？")) return;
  chrome.runtime.sendMessage({ type: "CLEAR_STEPS" }, () => {
    previousSession.style.display = "none";
  });
});

// ────────────────────────────────────────────────
// 起動
// ────────────────────────────────────────────────
init();
