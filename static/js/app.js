// ==================== 全域狀態與宣告 ====================
let ws = null;
let currentTab = "live-panel";
let fpsLastTime = performance.now();
let fpsFrames = 0;
let isRecordingState = false; // 用於紀錄錄影狀態切換觸發 UI Toast

// 智慧電子圍欄狀態變數
let isFenceEnabled = false;
let fencePoints = [];         // 已儲存的比例座標頂點 [[x, y], ...]
let tempFencePoints = [];     // 繪製中的比例座標頂點
let isDrawingMode = false;
let mouseX = 0, mouseY = 0;   // 滑鼠在 Canvas 中的實時座標


// DOM 元素選取
const liveCanvas = document.getElementById("liveCanvas");
const ctx = liveCanvas.getContext("2d");
const streamError = document.getElementById("stream-error");
const liveRecBadge = document.getElementById("live-rec-badge");
const statObjects = document.getElementById("stat-objects");
const statFps = document.getElementById("stat-fps");
const liveAlertConsole = document.getElementById("live-alert-console");
const toastContainer = document.getElementById("toast-container");
const clockEl = document.getElementById("clock");
const modeBadge = document.getElementById("current-mode-badge");

// Modal 元素選取
const videoModal = document.getElementById("video-modal");
const playbackVideo = document.getElementById("playback-video");
const videoModalTitle = document.getElementById("video-modal-title");
const closeModalBtn = document.getElementById("close-modal");

// ==================== 1. 基礎 UI 控制與時鐘 ====================

// 高科技時鐘
function updateClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
setInterval(updateClock, 1000);
updateClock();

// 分頁切換控制
document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");
        
        // 變更側邊按鈕選取狀態
        document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
        button.classList.add("active");
        
        // 變更分頁面板顯示狀態
        document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
        document.getElementById(targetTab).classList.add("active");
        
        // 變更頁面標題
        document.getElementById("panel-title").textContent = button.innerText.trim();
        
        currentTab = targetTab;
        
        // 切換至特定分頁時觸發資料加載
        if (targetTab === "logs-panel") {
            loadEventLogs();
        } else if (targetTab === "playback-panel") {
            loadPlaybackVideos();
        }
    });
});

// ==================== 2. 安全 TOAST 通知系統 (防禦 XSS) ====================

function showToast(title, text, isWarning = false) {
    const toast = document.createElement("div");
    toast.className = "toast";
    if (isWarning) {
        toast.style.background = "rgba(255, 23, 68, 0.08)";
        toast.style.borderColor = "rgba(255, 23, 68, 0.4)";
    } else {
        toast.style.background = "rgba(0, 210, 255, 0.08)";
        toast.style.borderColor = "rgba(0, 210, 255, 0.4)";
        toast.style.color = "var(--text-primary)";
    }
    
    // 圖標與標題建立
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = isWarning ? "🚨" : "🛡️";
    
    const body = document.createElement("div");
    body.className = "toast-body";
    
    const titleEl = document.createElement("span");
    titleEl.className = "toast-title";
    if (isWarning) titleEl.style.color = "var(--accent-red)";
    else titleEl.style.color = "var(--accent-blue)";
    titleEl.textContent = title;
    
    const textEl = document.createElement("span");
    textEl.className = "toast-text";
    textEl.textContent = text;
    
    body.appendChild(titleEl);
    body.appendChild(textEl);
    toast.appendChild(icon);
    toast.appendChild(body);
    
    toastContainer.appendChild(toast);
    
    // 4 秒後自動淡出移除
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        setTimeout(() => {
            toast.remove();
        }, 350);
    }, 4000);
}

// ==================== 3. WEBSOCKET 監控串流接收 ====================

function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/stream`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        streamError.style.opacity = "0";
        streamError.style.visibility = "hidden";
        showToast("串流連線成功", "即時影像串流已成功建立。");
        document.getElementById("system-status-text").textContent = "監控正常運行中";
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // 1. 繪製影格至 Canvas 畫布
            if (data.image) {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, liveCanvas.width, liveCanvas.height);
                    // 影像繪製完畢後，動態疊加前端繪製中的電子圍欄多邊形
                    drawFenceOverlay();
                };
                img.src = data.image;
            }
            
            // 2. 更新動態錄影呼吸燈狀態
            if (data.is_recording) {
                liveRecBadge.classList.add("active");
                if (!isRecordingState) {
                    isRecordingState = true;
                    showToast("警告: 偵測到入侵者", "NVR 已啟動動態錄影存檔並發送警報推播！", true);
                    addLiveConsoleAlert("偵測到入侵：動態錄影啟動中");
                }
            } else {
                liveRecBadge.classList.remove("active");
                isRecordingState = false;
            }
            
            // 3. 更新監控數據
            statObjects.textContent = data.active_objects;
            
            // 4. 計算並更新 FPS
            fpsFrames++;
            const now = performance.now();
            if (now - fpsLastTime >= 1000) {
                statFps.textContent = fpsFrames;
                fpsFrames = 0;
                fpsLastTime = now;
            }
            
        } catch (err) {
            console.error("解析串流封包錯誤: ", err);
        }
    };
    
    ws.onclose = () => {
        streamError.style.opacity = "1";
        streamError.style.visibility = "visible";
        document.getElementById("system-status-text").textContent = "引擎已斷線";
        statFps.textContent = "0";
        statObjects.textContent = "0";
        // 3 秒後嘗試重連
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (err) => {
        console.error("WebSocket 錯誤: ", err);
    };
}

function addLiveConsoleAlert(message) {
    // 清除預設占位符
    const placeholder = liveAlertConsole.querySelector(".console-placeholder");
    if (placeholder) {
        liveAlertConsole.replaceChildren();
    }
    
    const row = document.createElement("div");
    row.className = "console-row";
    
    const msgSpan = document.createElement("span");
    msgSpan.className = "console-msg";
    msgSpan.textContent = message;
    
    const timeSpan = document.createElement("span");
    timeSpan.className = "console-time";
    const now = new Date();
    timeSpan.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    row.appendChild(msgSpan);
    row.appendChild(timeSpan);
    
    // 新增至首位
    liveAlertConsole.insertBefore(row, liveAlertConsole.firstChild);
    
    // 限制顯示最大 10 筆
    if (liveAlertConsole.children.length > 10) {
        liveAlertConsole.removeChild(liveAlertConsole.lastChild);
    }
}

// ==================== 4. 事件日誌處理 (XSS 防禦原則) ====================

async function loadEventLogs() {
    const tableBody = document.getElementById("logs-table-body");
    tableBody.replaceChildren(); // 安全地清除資料表內容
    
    const loadingRow = document.createElement("tr");
    const loadingCell = document.createElement("td");
    loadingCell.setAttribute("colspan", "7");
    loadingCell.className = "loading-text";
    loadingCell.textContent = "歷史日誌載入中...";
    loadingRow.appendChild(loadingCell);
    tableBody.appendChild(loadingRow);
    
    try {
        const response = await fetch("/api/events?limit=50");
        const data = await response.json();
        
        tableBody.replaceChildren(); // 清除載入文字
        
        if (data.length === 0) {
            const emptyRow = document.createElement("tr");
            const emptyCell = document.createElement("td");
            emptyCell.setAttribute("colspan", "7");
            emptyCell.className = "no-data";
            emptyCell.textContent = "尚無任何安全事件紀錄";
            emptyRow.appendChild(emptyCell);
            tableBody.appendChild(emptyRow);
            return;
        }
        
        data.forEach(event => {
            const tr = document.createElement("tr");
            
            // ID
            const tdId = document.createElement("td");
            tdId.className = "tbl-id";
            tdId.textContent = `#${event.id}`;
            
            // 時間
            const tdTime = document.createElement("td");
            tdTime.className = "tbl-time";
            tdTime.textContent = event.timestamp;
            
            // 類型 (Badge)
            const tdType = document.createElement("td");
            const badge = document.createElement("span");
            badge.className = "tbl-badge intruder";
            badge.textContent = event.event_type;
            tdType.appendChild(badge);
            
            // 置信度
            const tdConf = document.createElement("td");
            tdConf.className = "tbl-conf";
            tdConf.textContent = `${(event.confidence * 100).toFixed(1)}%`;
            
            // 警報狀態
            const tdNotified = document.createElement("td");
            tdNotified.className = `tbl-notified ${event.is_notified ? 'yes' : 'no'}`;
            tdNotified.textContent = event.is_notified ? "已推播完成" : "未啟用推播/冷卻中";
            
            // 縮圖
            const tdThumb = document.createElement("td");
            if (event.snapshot_filename) {
                const img = document.createElement("img");
                img.className = "table-thumbnail";
                img.src = `/api/image/${event.snapshot_filename}`;
                img.alt = "現場截圖";
                
                // 點擊縮圖彈出大圖或直接看影片
                img.addEventListener("click", () => {
                    openVideoModal(event.video_filename, event.timestamp);
                });
                tdThumb.appendChild(img);
            } else {
                tdThumb.textContent = "無截圖";
            }
            
            // 重播按鈕
            const tdAction = document.createElement("td");
            if (event.video_filename) {
                const btn = document.createElement("button");
                btn.className = "btn btn-secondary";
                btn.style.padding = "6px 12px";
                btn.style.fontSize = "0.8rem";
                btn.textContent = "▶ 播放錄影";
                btn.addEventListener("click", () => {
                    openVideoModal(event.video_filename, event.timestamp);
                });
                tdAction.appendChild(btn);
            } else {
                tdAction.textContent = "無影片";
            }
            
            tr.appendChild(tdId);
            tr.appendChild(tdTime);
            tr.appendChild(tdType);
            tr.appendChild(tdConf);
            tr.appendChild(tdNotified);
            tr.appendChild(tdThumb);
            tr.appendChild(tdAction);
            
            tableBody.appendChild(tr);
        });
        
    } catch (err) {
        console.error("載入歷史日誌失敗: ", err);
        tableBody.replaceChildren();
        const errRow = document.createElement("tr");
        const errCell = document.createElement("td");
        errCell.setAttribute("colspan", "7");
        errCell.className = "no-data";
        errCell.style.color = "var(--accent-red)";
        errCell.textContent = "無法自伺服器載入資料，請確認 API 連線正常。";
        errRow.appendChild(errCell);
        tableBody.appendChild(errRow);
    }
}

// 綁定手動重新整理按鈕
document.getElementById("btn-refresh-logs").addEventListener("click", loadEventLogs);

// ==================== 5. 歷史錄影重播 (XSS 防禦原則) ====================

async function loadPlaybackVideos() {
    const grid = document.getElementById("playback-cards-container");
    grid.replaceChildren(); // 安全清除
    
    const loadingText = document.createElement("div");
    loadingText.className = "loading-text";
    loadingText.textContent = "歷史影片讀取中...";
    grid.appendChild(loadingText);
    
    try {
        const response = await fetch("/api/events?limit=50");
        const data = await response.json();
        
        grid.replaceChildren(); // 清除載入文字
        
        // 過濾出有錄影的事件
        const videoEvents = data.filter(e => e.video_filename);
        
        if (videoEvents.length === 0) {
            const emptyText = document.createElement("div");
            emptyText.className = "no-data";
            emptyText.style.gridColumn = "1/-1";
            emptyText.textContent = "目前工作區 storage/recordings 下尚無任何錄影影片 (.mp4)";
            grid.appendChild(emptyText);
            return;
        }
        
        videoEvents.forEach(event => {
            const card = document.createElement("div");
            card.className = "playback-card";
            
            // 縮圖與懸浮播放按鈕容器
            const thumbContainer = document.createElement("div");
            thumbContainer.className = "playback-thumb-container";
            
            const img = document.createElement("img");
            img.className = "playback-thumb";
            img.src = `/api/image/${event.snapshot_filename || ''}`;
            img.alt = "影片縮圖";
            
            const hoverBtn = document.createElement("button");
            hoverBtn.className = "play-hover-btn";
            hoverBtn.textContent = "▶";
            
            // 點擊事件
            const playAction = () => openVideoModal(event.video_filename, event.timestamp);
            hoverBtn.addEventListener("click", playAction);
            thumbContainer.addEventListener("click", playAction);
            
            thumbContainer.appendChild(img);
            thumbContainer.appendChild(hoverBtn);
            
            // 影片資訊
            const infoDiv = document.createElement("div");
            infoDiv.className = "playback-info";
            
            const timeDiv = document.createElement("div");
            timeDiv.className = "playback-time";
            timeDiv.textContent = event.timestamp;
            
            const metaRow = document.createElement("div");
            metaRow.className = "playback-meta-row";
            
            const typeLabel = document.createElement("span");
            typeLabel.style.color = "var(--accent-red)";
            typeLabel.style.fontWeight = "700";
            typeLabel.textContent = event.event_type;
            
            const confVal = document.createElement("span");
            confVal.style.color = "var(--text-secondary)";
            confVal.style.fontFamily = "var(--font-mono)";
            confVal.textContent = `Confidence: ${(event.confidence * 100).toFixed(0)}%`;
            
            metaRow.appendChild(typeLabel);
            metaRow.appendChild(confVal);
            
            infoDiv.appendChild(timeDiv);
            infoDiv.appendChild(metaRow);
            
            card.appendChild(thumbContainer);
            card.appendChild(infoDiv);
            
            grid.appendChild(card);
        });
        
    } catch (err) {
        console.error("載入歷史影片失敗: ", err);
        grid.replaceChildren();
        const errText = document.createElement("div");
        errText.className = "no-data";
        errText.style.color = "var(--accent-red)";
        errText.textContent = "無法取得錄影列表，請確認主機運作。";
        grid.appendChild(errText);
    }
}

document.getElementById("btn-refresh-playbacks").addEventListener("click", loadPlaybackVideos);

// ==================== 6. MODAL 播放器控制 ====================

function openVideoModal(filename, timestamp) {
    if (!filename) return;
    
    // 設定 modal 標題
    videoModalTitle.textContent = `重播安全監視畫面 - ${timestamp}`;
    
    // 【安全設計】：安全檔案讀取端點
    playbackVideo.src = `/api/video/${filename}`;
    playbackVideo.load();
    
    // 顯示 Modal
    videoModal.classList.add("active");
    
    // 異步安全播放，避免瀏覽器政策或載入速度過慢引起異常
    const playPromise = playbackVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.log("自動播放被攔截或載入中，可點擊影片控制列進行播放：", error);
        });
    }
}

// 監聽影片播放錯誤，協助診斷相容性問題
playbackVideo.addEventListener("error", (e) => {
    const err = playbackVideo.error;
    let errMsg = "未知錯誤";
    if (err) {
        switch (err.code) {
            case err.MEDIA_ERR_ABORTED:
                errMsg = "播放被中止 (Aborted)";
                break;
            case err.MEDIA_ERR_NETWORK:
                errMsg = "網路傳輸錯誤 (Network Error)";
                break;
            case err.MEDIA_ERR_DECODE:
                errMsg = "影片解碼錯誤 (Codec / 解碼失敗)";
                break;
            case err.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errMsg = "影片格式或編碼不被此瀏覽器支援 (Format Not Supported)";
                break;
        }
        console.error("影片播放錯誤: ", err.message, "代碼: ", err.code);
    }
    showToast("影片重播失敗", `偵測到瀏覽器錯誤：${errMsg} (代碼: ${err ? err.code : '無'})`, true);
});

function closeVideoModal() {
    videoModal.classList.remove("active");
    // 【安全與頻寬控制】：關閉時必須清空視訊源，防範背景持續加載檔案佔用效能
    playbackVideo.pause();
    playbackVideo.removeAttribute("src");
    playbackVideo.load();
}

closeModalBtn.addEventListener("click", closeVideoModal);
videoModal.addEventListener("click", (e) => {
    // 點擊背景可直接關閉視窗
    if (e.target === videoModal) {
        closeVideoModal();
    }
});

// ==================== 7. 系統設定載入與更新 ====================

// 載入系統設定
async function loadSystemSettings() {
    try {
        const response = await fetch("/api/settings");
        const settings = await response.json();
        
        // 更新相機源指示標記
        const camSource = settings.camera_source;
        if (camSource === "simulator") {
            modeBadge.textContent = "影像模擬測試中";
            modeBadge.style.color = "var(--accent-blue)";
        } else if (typeof camSource === "number" || !isNaN(Number(camSource))) {
            modeBadge.textContent = `本機鏡頭 CAM ${camSource}`;
            modeBadge.style.color = "var(--accent-green)";
        } else {
            modeBadge.textContent = "RTSP 外部監控";
            modeBadge.style.color = "var(--accent-green)";
        }
        
        // 填充 Form 表單
        document.getElementById("set-camera-source").value = settings.camera_source;
        document.getElementById("set-detection-threshold").value = settings.detection_threshold;
        document.getElementById("val-detection-threshold").textContent = settings.detection_threshold;
        document.getElementById("set-recording-duration").value = settings.recording_duration;
        document.getElementById("set-max-recording-duration").value = settings.max_recording_duration;
        document.getElementById("set-detection-cooldown").value = settings.detection_cooldown;
        
        // 填充警報開關
        document.getElementById("set-enable-line").checked = settings.enable_line;
        document.getElementById("set-enable-discord").checked = settings.enable_discord;
        document.getElementById("set-enable-email").checked = settings.enable_email;
        
        // 填充警報金鑰
        document.getElementById("set-line-token").value = settings.line_token;
        document.getElementById("set-discord-webhook").value = settings.discord_webhook;
        document.getElementById("set-email-smtp-server").value = settings.email_smtp_server;
        document.getElementById("set-email-smtp-port").value = settings.email_smtp_port;
        document.getElementById("set-email-sender").value = settings.email_sender;
        document.getElementById("set-email-password").value = settings.email_password;
        document.getElementById("set-email-receiver").value = settings.email_receiver;
        
        // 更新 UI 展示面板折疊狀態
        toggleAlertInputs("line", settings.enable_line);
        toggleAlertInputs("discord", settings.enable_discord);
        toggleAlertInputs("email", settings.enable_email);
        
        // 更新即時監控分頁的置信度門檻指示
        document.getElementById("conf-threshold-fill").style.width = `${settings.detection_threshold * 100}%`;
        document.getElementById("conf-threshold-text").textContent = `${Math.round(settings.detection_threshold * 100)}%`;
        
        // 載入電子圍欄設定
        isFenceEnabled = settings.enable_fence || false;
        fencePoints = settings.fence_polygon || [];
        document.getElementById("fence-toggle-switch").checked = isFenceEnabled;
        updateFenceStatusUI();
        
    } catch (err) {
        console.error("自伺服器讀取設定檔失敗: ", err);
        showToast("讀取設定失敗", "無法自背景加載設定檔，改用網頁預設值。", true);
    }
}

// 處理開關摺疊效果
function toggleAlertInputs(type, isEnabled) {
    const section = document.getElementById(`set-enable-${type}`).closest(".alert-section");
    if (isEnabled) {
        section.classList.add("expanded");
    } else {
        section.classList.remove("expanded");
    }
}

["line", "discord", "email"].forEach(type => {
    document.getElementById(`set-enable-${type}`).addEventListener("change", (e) => {
        toggleAlertInputs(type, e.target.checked);
    });
});

// 滑桿拖動即時數值顯示
document.getElementById("set-detection-threshold").addEventListener("input", (e) => {
    document.getElementById("val-detection-threshold").textContent = e.target.value;
});

// 儲存系統設定
document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const payload = {
        camera_source: document.getElementById("set-camera-source").value,
        detection_threshold: parseFloat(document.getElementById("set-detection-threshold").value),
        recording_duration: parseInt(document.getElementById("set-recording-duration").value),
        max_recording_duration: parseInt(document.getElementById("set-max-recording-duration").value),
        detection_cooldown: parseInt(document.getElementById("set-detection-cooldown").value),
        
        enable_line: document.getElementById("set-enable-line").checked,
        enable_discord: document.getElementById("set-enable-discord").checked,
        enable_email: document.getElementById("set-enable-email").checked,
        
        line_token: document.getElementById("set-line-token").value,
        discord_webhook: document.getElementById("set-discord-webhook").value,
        email_smtp_server: document.getElementById("set-email-smtp-server").value,
        email_smtp_port: parseInt(document.getElementById("set-email-smtp-port").value) || 587,
        email_sender: document.getElementById("set-email-sender").value,
        email_password: document.getElementById("set-email-password").value,
        email_receiver: document.getElementById("set-email-receiver").value,
        
        // 智慧電子圍欄
        enable_fence: document.getElementById("fence-toggle-switch").checked,
        fence_polygon: fencePoints
    };
    
    try {
        const response = await fetch("/api/settings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showToast("設定儲存成功", "系統參數與通知金鑰已成功持久化存檔。");
            loadSystemSettings(); // 重新讀取整理 UI
        } else {
            showToast("儲存設定失敗", "背景回傳寫入失敗，請確認格式是否正確。", true);
        }
    } catch (err) {
        console.error("儲存設定錯誤: ", err);
        showToast("儲存設定錯誤", "與伺服器通訊異常，無法完成設定變更。", true);
    }
});

// 手動觸發測試警報
document.getElementById("btn-trigger-test-alert").addEventListener("click", async () => {
    const btn = document.getElementById("btn-trigger-test-alert");
    btn.disabled = true;
    btn.textContent = "發送中...";
    
    showToast("發送測試中", "系統正組裝測試圖層並推送至所有啟用的管道，請稍候...");
    
    try {
        const response = await fetch("/api/test-alert", {
            method: "POST"
        });
        const data = await response.json();
        
        if (response.ok) {
            showToast("測試警報完成", data.message);
        } else {
            showToast("測試發送失敗", data.message || "發生未知異常。", true);
        }
    } catch (err) {
        console.error("測試警報錯誤: ", err);
        showToast("通訊錯誤", "與後端伺服器通訊超時或連線中斷。", true);
    } finally {
        btn.disabled = false;
        btn.textContent = "⚡ 發送測試警報";
    }
});

// ==================== 8. 智慧電子圍欄互動模組 (Geofence Controller) ====================

// 更新電子圍欄 UI 狀態與標籤
function updateFenceStatusUI() {
    const statusLabel = document.getElementById("fence-status-label");
    const drawBtn = document.getElementById("btn-draw-fence");
    const saveBtn = document.getElementById("btn-save-fence");
    const toggleSwitch = document.getElementById("fence-toggle-switch");
    
    if (!statusLabel || !drawBtn || !saveBtn || !toggleSwitch) return;
    
    if (isDrawingMode) {
        statusLabel.textContent = "繪製中...";
        statusLabel.className = "fence-lbl-drawing";
        drawBtn.textContent = "🚫 取消";
        drawBtn.classList.add("active");
        saveBtn.disabled = tempFencePoints.length < 3;
    } else {
        drawBtn.textContent = "➕ 繪製";
        drawBtn.classList.remove("active");
        
        if (isFenceEnabled) {
            statusLabel.textContent = "已啟用";
            statusLabel.className = "fence-lbl-enabled";
            toggleSwitch.checked = true;
        } else {
            statusLabel.textContent = "已停用";
            statusLabel.className = "fence-lbl-disabled";
            toggleSwitch.checked = false;
        }
        
        saveBtn.disabled = true;
    }
}

// 進入或退出繪圖模式
function toggleDrawingMode() {
    if (isDrawingMode) {
        endDrawingMode(false); // 取消繪製
    } else {
        isDrawingMode = true;
        tempFencePoints = [];
        document.getElementById("monitor-screen-body").classList.add("drawing-mode");
        showToast("進入圍欄繪製模式", "在監視畫面上點擊定點，最後點擊『首點』或點擊『儲存』以閉合多邊形。");
        updateFenceStatusUI();
    }
}

// 結束繪圖模式
function endDrawingMode(shouldSavePoints = false) {
    isDrawingMode = false;
    const screenBody = document.getElementById("monitor-screen-body");
    if (screenBody) screenBody.classList.remove("drawing-mode");
    
    if (shouldSavePoints && tempFencePoints.length >= 3) {
        fencePoints = [...tempFencePoints];
    }
    
    tempFencePoints = [];
    updateFenceStatusUI();
}

// 繪製 Canvas 電子圍欄疊加層
function drawFenceOverlay() {
    if (!isDrawingMode || tempFencePoints.length === 0) return;
    
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 210, 255, 0.85)"; // 發光科技藍
    ctx.lineWidth = 2;
    
    // 移動到第一個頂點
    const firstX = tempFencePoints[0][0] * liveCanvas.width;
    const firstY = tempFencePoints[0][1] * liveCanvas.height;
    ctx.moveTo(firstX, firstY);
    
    // 繪製各個頂點間的線段
    for (let i = 1; i < tempFencePoints.length; i++) {
        ctx.lineTo(tempFencePoints[i][0] * liveCanvas.width, tempFencePoints[i][1] * liveCanvas.height);
    }
    
    // 檢查是否已閉合（即最後一個點的座標與第一個點完全相同）
    let isClosed = false;
    if (tempFencePoints.length >= 4) {
        const lastIdx = tempFencePoints.length - 1;
        if (tempFencePoints[lastIdx][0] === tempFencePoints[0][0] && tempFencePoints[lastIdx][1] === tempFencePoints[0][1]) {
            isClosed = true;
        }
    }
    
    // 若尚未閉合，則繪製連向滑鼠位置的輔助虛線，已閉合則直接閉合線條
    if (!isClosed) {
        ctx.lineTo(mouseX, mouseY);
        ctx.setLineDash([5, 5]); // 設定為虛線
        ctx.stroke();
        ctx.setLineDash([]);    // 還原為實線
    } else {
        ctx.stroke();
    }
    
    // 繪製頂點圓圈 (若是閉合圖形，最後一個重合點不重複繪製)
    tempFencePoints.forEach((pt, idx) => {
        if (isClosed && idx === tempFencePoints.length - 1) return;
        
        const ptX = pt[0] * liveCanvas.width;
        const ptY = pt[1] * liveCanvas.height;
        
        ctx.beginPath();
        ctx.arc(ptX, ptY, 6, 0, 2 * Math.PI);
        if (idx === 0) {
            // 首點用霓虹紅標記，方便閉合
            ctx.fillStyle = "#ff1744";
            ctx.shadowColor = "rgba(255, 23, 68, 0.5)";
            ctx.shadowBlur = 10;
        } else {
            ctx.fillStyle = "#00d2ff";
            ctx.shadowColor = "rgba(0, 210, 255, 0.5)";
            ctx.shadowBlur = 10;
        }
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0; // 還原 shadow
    });
}

// 綁定電子圍欄互動事件會於下方 DOMContentLoaded 中以安全防禦模式進行初始化綁定

// Canvas 繪圖點擊監聽
liveCanvas.addEventListener("click", (e) => {
    if (!isDrawingMode) return;
    
    const rect = liveCanvas.getBoundingClientRect();
    
    // 【高精度校正】：將相對於網頁 CSS 的實際滑鼠位置 (e.clientX/clientY)
    // 除以 Canvas 的實際顯示寬高 (rect.width/height) 取得正確比例，再乘以 640x480 對齊內建維度，徹底消滅位移誤差
    const x = ((e.clientX - rect.left) / rect.width) * liveCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * liveCanvas.height;
    
    // 轉為 0.0 ~ 1.0 比例
    const relX = parseFloat((x / liveCanvas.width).toFixed(4));
    const relY = parseFloat((y / liveCanvas.height).toFixed(4));
    
    // 檢查首點閉合碰撞 (距離小於 15 像素視為點擊首點)
    if (tempFencePoints.length >= 3) {
        const firstX = tempFencePoints[0][0] * liveCanvas.width;
        const firstY = tempFencePoints[0][1] * liveCanvas.height;
        const dist = Math.hypot(x - firstX, y - firstY);
        
        if (dist < 15) {
            // 首尾自動閉合：將起點座標深拷貝一份推入末尾，組成閉合多邊形
            tempFencePoints.push([...tempFencePoints[0]]);
            showToast("多邊形已自動閉合", "圍欄劃定完成！請點擊『💾 儲存』將設定儲存生效。");
            
            // 啟用儲存按鈕
            const saveBtn = document.getElementById("btn-save-fence");
            if (saveBtn) saveBtn.disabled = false;
            
            updateFenceStatusUI();
            return;
        }
    }
    
    // 限制最大頂點數 (閉合後也禁止再點擊加點)
    let isAlreadyClosed = false;
    if (tempFencePoints.length >= 4) {
        const lastIdx = tempFencePoints.length - 1;
        if (tempFencePoints[lastIdx][0] === tempFencePoints[0][0] && tempFencePoints[lastIdx][1] === tempFencePoints[0][1]) {
            isAlreadyClosed = true;
        }
    }
    
    if (isAlreadyClosed) {
        showToast("已完成繪製", "圍欄已閉合！請直接點擊『💾 儲存』或點擊『🧹 清除』重新劃定。", true);
        return;
    }
    
    if (tempFencePoints.length >= 8) {
        showToast("點數達到上限", "為確保後端效能，圍欄最大支援 8 個頂點，請點擊紅色首點進行閉合。", true);
        return;
    }
    
    tempFencePoints.push([relX, relY]);
    updateFenceStatusUI();
});

// Canvas 繪圖滑鼠移動監聽
liveCanvas.addEventListener("mousemove", (e) => {
    if (!isDrawingMode) return;
    const rect = liveCanvas.getBoundingClientRect();
    
    // 同樣將滑鼠實時位置等比例映射回 640x480 的畫布刻度空間，讓輔助虛線 100% 緊貼滑鼠針尖
    mouseX = ((e.clientX - rect.left) / rect.width) * liveCanvas.width;
    mouseY = ((e.clientY - rect.top) / rect.height) * liveCanvas.height;
});

// 異步同步電子圍欄設定至後端
async function syncFenceSettings(enabled, polygon) {
    try {
        // 先讀取當前設定以保留其他欄位
        const rGet = await fetch("/api/settings");
        const curSettings = await rGet.json();
        
        // 覆蓋電子圍欄設定
        curSettings.enable_fence = enabled;
        curSettings.fence_polygon = polygon;
        
        const rPost = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(curSettings)
        });
        
        if (rPost.ok) {
            showToast("電子圍欄同步成功", "設定已寫入系統核心，即時生效！");
            loadSystemSettings(); // 重新整理前端顯示
        } else {
            showToast("同步失敗", "寫入設定時伺服器拒絕請求。", true);
        }
    } catch (err) {
        console.error("同步圍欄設定失敗:", err);
        showToast("連線異常", "無法與後端伺服器進行設定同步。", true);
    }
}

// ==================== 9. 程式進入點初始化 ====================

document.addEventListener("DOMContentLoaded", () => {
    loadSystemSettings();
    connectWebSocket();
    
    // 【高防禦性綁定】：安全將電子圍欄互動事件封裝於 DOM 加載完畢後，並主動做非空校驗，防範未預期的 Uncaught Error 中斷
    const drawBtn = document.getElementById("btn-draw-fence");
    if (drawBtn) {
        drawBtn.addEventListener("click", toggleDrawingMode);
    }
    
    const clearBtn = document.getElementById("btn-clear-fence");
    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            fencePoints = [];
            tempFencePoints = [];
            isFenceEnabled = false;
            isDrawingMode = false;
            const screenBody = document.getElementById("monitor-screen-body");
            if (screenBody) screenBody.classList.remove("drawing-mode");
            
            const toggleSwitch = document.getElementById("fence-toggle-switch");
            if (toggleSwitch) toggleSwitch.checked = false;
            
            updateFenceStatusUI();
            showToast("電子圍欄已清除", "系統已重置並停用電子圍欄設定。");
            await syncFenceSettings(false, []);
        });
    }
    
    const saveBtn = document.getElementById("btn-save-fence");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            if (tempFencePoints.length >= 3) {
                fencePoints = [...tempFencePoints];
            }
            
            if (fencePoints.length < 3) {
                showToast("儲存失敗", "圍欄多邊形至少需要 3 個頂點！", true);
                return;
            }
            
            isFenceEnabled = true;
            endDrawingMode(false);
            showToast("圍欄儲存中", "正將電子圍欄座標寫入後端系統設定...");
            await syncFenceSettings(true, fencePoints);
        });
    }
    
    const toggleSwitch = document.getElementById("fence-toggle-switch");
    if (toggleSwitch) {
        toggleSwitch.addEventListener("change", async (e) => {
            isFenceEnabled = e.target.checked;
            
            if (isFenceEnabled && fencePoints.length < 3) {
                showToast("無法啟用", "尚未繪製圍欄！請先點擊『➕ 繪製』劃定區域。", true);
                e.target.checked = false;
                isFenceEnabled = false;
                return;
            }
            
            updateFenceStatusUI();
            showToast(isFenceEnabled ? "電子圍欄已啟用" : "電子圍欄已停用", isFenceEnabled ? "AI 將僅針對圍欄內的入侵進行警報過濾。" : "已還原為全域影像辨識模式。");
            await syncFenceSettings(isFenceEnabled, fencePoints);
        });
    }
});
