// content.js — コンテンツスクリプト
// ユーザーのDOM操作を捕捉し、background.js へ送信する

(function () {
  // 二重注入防止
  if (window.__manualRecorderInjected) return;
  window.__manualRecorderInjected = true;

  let isRecording = false;
  let inputDebounceTimers = new WeakMap();
  let lastScrollY = window.scrollY;
  let scrollThrottleTimer = null;

  // ────────────────────────────────────────────────
  // 記録状態の確認（ポーリング不要、メッセージで同期）
  // ────────────────────────────────────────────────
  function checkRecordingState() {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
      if (chrome.runtime.lastError) return;
      isRecording = res && res.isRecording;
    });
  }

  checkRecordingState();

  // バックグラウンドから記録状態変更を受信
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RECORDING_STATE_CHANGED") {
      isRecording = message.isRecording;
    }
  });

  // ────────────────────────────────────────────────
  // 要素のラベルを解決（優先順位順）
  // ────────────────────────────────────────────────
  function resolveLabel(el) {
    if (!el) return "要素";

    // 1. aria-label
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();

    // 2. aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl && labelEl.textContent.trim()) return labelEl.textContent.trim();
    }

    // 3. 関連 <label> 要素（for属性）
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl && labelEl.textContent.trim()) return labelEl.textContent.trim();
    }

    // 4. 親 <label> 要素（ラップ型）
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const text = parentLabel.textContent.trim();
      if (text) return text.slice(0, 40);
    }

    // 5. placeholder
    if (el.placeholder) return el.placeholder.trim();

    // 6. title
    if (el.title) return el.title.trim();

    // 7. innerText（ボタン・リンク等）
    const text = el.textContent ? el.textContent.trim() : "";
    if (text && text.length <= 40) return text;

    // 8. value（inputのvalue、例：送信ボタン）
    if (el.value && el.type !== "text" && el.type !== "password") return el.value.trim();

    // 9. name 属性
    if (el.name) return el.name.trim();

    // 10. タグ名フォールバック
    const tagMap = {
      BUTTON: "ボタン",
      A: "リンク",
      INPUT: "入力欄",
      TEXTAREA: "テキストエリア",
      SELECT: "セレクトボックス",
      IMG: el.alt || "画像",
    };
    return tagMap[el.tagName.toUpperCase()] || el.tagName.toLowerCase();
  }

  // ────────────────────────────────────────────────
  // アクションを送信
  // ────────────────────────────────────────────────
  function sendAction(payload) {
    if (!isRecording) return;
    chrome.runtime.sendMessage({ type: "RECORD_ACTION", payload }, () => {
      if (chrome.runtime.lastError) {
        // 拡張がリロードされた場合など、エラーを無視
      }
    });
  }

  // ────────────────────────────────────────────────
  // クリックイベント
  // ────────────────────────────────────────────────
  document.addEventListener(
    "click",
    (e) => {
      if (!isRecording) return;
      const el = e.target;
      if (!el || el.tagName === "HTML" || el.tagName === "BODY") return;

      // 拡張機能の要素は無視
      if (el.closest("[data-manual-recorder]")) return;

      const label = resolveLabel(el);
      const tag = el.tagName.toUpperCase();
      const href = tag === "A" ? (el.href || el.getAttribute("href") || null) : null;

      sendAction({
        type: "click",
        timestamp: Date.now(),
        url: location.href,
        pageTitle: document.title,
        meta: {
          tagName: tag,
          label,
          href,
          inputType: el.type || null,
          checked: el.checked,
          value: el.value || null,
        },
      });
    },
    true // capture フェーズ
  );

  // ────────────────────────────────────────────────
  // input イベント（デバウンス 500ms）
  // ────────────────────────────────────────────────
  document.addEventListener(
    "input",
    (e) => {
      if (!isRecording) return;
      const el = e.target;
      if (!el || !["INPUT", "TEXTAREA"].includes(el.tagName.toUpperCase())) return;
      if (el.type === "submit" || el.type === "button" || el.type === "reset") return;

      // 既存タイマーをクリア
      if (inputDebounceTimers.has(el)) {
        clearTimeout(inputDebounceTimers.get(el));
      }

      const timer = setTimeout(() => {
        const label = resolveLabel(el);
        const isPassword = el.type === "password";
        const value = isPassword ? "（パスワード）" : el.value;

        sendAction({
          type: "input",
          timestamp: Date.now(),
          url: location.href,
          pageTitle: document.title,
          meta: {
            tagName: el.tagName.toUpperCase(),
            label,
            value,
            inputType: el.type || "text",
          },
        });
        inputDebounceTimers.delete(el);
      }, 500);

      inputDebounceTimers.set(el, timer);
    },
    true
  );

  // ────────────────────────────────────────────────
  // change イベント（セレクトボックス・チェックボックス等）
  // ────────────────────────────────────────────────
  document.addEventListener(
    "change",
    (e) => {
      if (!isRecording) return;
      const el = e.target;
      if (!el) return;
      // input イベントで既にキャプチャするテキスト系は除外
      if (el.type === "text" || el.type === "email" || el.type === "number" || el.tagName === "TEXTAREA") return;

      const label = resolveLabel(el);
      const tag = el.tagName.toUpperCase();

      let value;
      if (tag === "SELECT") {
        value = el.options[el.selectedIndex]?.text || el.value;
      } else if (el.type === "checkbox" || el.type === "radio") {
        value = el.checked ? "オン" : "オフ";
      } else {
        value = el.value;
      }

      sendAction({
        type: "change",
        timestamp: Date.now(),
        url: location.href,
        pageTitle: document.title,
        meta: {
          tagName: tag,
          label,
          value,
          inputType: el.type || null,
          checked: el.checked,
        },
      });
    },
    true
  );

  // ────────────────────────────────────────────────
  // フォーム送信
  // ────────────────────────────────────────────────
  document.addEventListener(
    "submit",
    (e) => {
      if (!isRecording) return;
      const form = e.target;
      const label = form.getAttribute("aria-label") || form.id || form.name || "フォーム";
      sendAction({
        type: "submit",
        timestamp: Date.now(),
        url: location.href,
        pageTitle: document.title,
        meta: { tagName: "FORM", label },
      });
    },
    true
  );

  // ────────────────────────────────────────────────
  // スクロール（200px以上移動時のみ、スロットル）
  // ────────────────────────────────────────────────
  window.addEventListener("scroll", () => {
    if (!isRecording) return;
    if (scrollThrottleTimer) return;

    scrollThrottleTimer = setTimeout(() => {
      scrollThrottleTimer = null;
      const delta = Math.abs(window.scrollY - lastScrollY);
      if (delta >= 200) {
        lastScrollY = window.scrollY;
        sendAction({
          type: "scroll",
          timestamp: Date.now(),
          url: location.href,
          pageTitle: document.title,
          meta: { scrollY: window.scrollY },
        });
      }
    }, 500);
  });

  // ────────────────────────────────────────────────
  // SPA ナビゲーション検出
  // ────────────────────────────────────────────────
  let currentUrl = location.href;

  function onUrlChange(newUrl) {
    if (newUrl === currentUrl) return;
    const prevUrl = currentUrl;
    currentUrl = newUrl;

    if (!isRecording) return;
    sendAction({
      type: "navigate",
      timestamp: Date.now(),
      url: newUrl,
      pageTitle: document.title,
      meta: { from: prevUrl, to: newUrl },
    });
  }

  // history.pushState / replaceState をラップ
  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPushState(...args);
    onUrlChange(location.href);
  };

  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    origReplaceState(...args);
    onUrlChange(location.href);
  };

  window.addEventListener("popstate", () => {
    onUrlChange(location.href);
  });

  // <title> の変化を監視（SPA でタイトルが遅れて変わる場合）
  const titleObserver = new MutationObserver(() => {
    if (!isRecording) return;
    // URL 変化なしでタイトルだけ変わった場合は無視（既に navigate で記録済み）
  });
  const titleEl = document.querySelector("title");
  if (titleEl) {
    titleObserver.observe(titleEl, { childList: true });
  }
})();
