// ==================== 全域狀態與宣告 ====================
let ws = null;
let currentTab = "live-panel";
let fpsLastTime = performance.now();
let fpsFrames = 0;
let isRecordingState = false; // 用於紀錄錄影狀態切換觸發 UI Toast

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
    
    // 顯示 Modal
    videoModal.classList.add("active");
    playbackVideo.play();
}

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
        document.getElementById("conf-threshold-text").textContent = `${settings.detection_threshold * 100}%`;
        
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
        email_receiver: document.getElementById("set-email-receiver").value
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

// ==================== 8. 程式進入點初始化 ====================

document.addEventListener("DOMContentLoaded", () => {
    loadSystemSettings();
    connectWebSocket();
});
