# 🛡️ AI Soft-NVR 智慧安全監控與入侵辨識系統

AI Soft-NVR 是一款基於 **Python**、**FastAPI** 與 **OpenCV / YOLOv8** 開發的輕量級、高效能居家智慧安全監控系統。本系統專為低延遲、高安全性的即時監控與智慧警報設計，具備現代化高科技感的網頁控制台，並提供多管道即時推播功能。

---

## 🌟 核心特色

### 1. ⚡ 即時低延遲影像串流
*   **WebSockets 動態串流**：採用 WebSockets 技術，將監視畫面即時進行高效能 JPEG 壓縮並編碼為 Base64 字串，流暢地推播至前端網頁，維持約 ~20 FPS 的低延遲即時動態體驗。
*   **影像辨識框同步**：即時影像上會動態疊加 AI 電子藍框（Cyber Blue）與偵測標籤，並在觸發錄影時顯示紅色閃爍的 「● REC」錄製狀態。
*   **異常中斷釋放**：WebSocket 連線若於瀏覽器關閉/重新整理時中斷，後端會自動拋出異常並優雅地終止背景迴圈，防止任何 CPU 資源浪費與主控台無限報錯（Spam）的情況。

### 2. 🧠 雙重 AI 入侵辨識引擎
*   **高級 YOLOv8 模式 (推薦)**：系統啟動時若偵測到本機有安裝 `ultralytics` 套件，會自動下載並載入 YOLOv8 奈米模型（`yolov8n.pt`），進行高精度的**人形偵測**，大幅減少因風吹草動、寵物或光線變化造成的誤報。
*   **預設輕量模式**：若未安裝 YOLOv8，系統將自動啟動內建的 OpenCV Haar Cascades 人臉偵測與自訂警戒區動態變化偵測，確保在低效能硬體（如 Raspberry Pi）上也能流暢運作。
*   **內建影像模擬器 (Simulator)**：針對無實體相機鏡頭的開發環境，內建高科技雷達感應網格與移動入侵點模擬，便於免硬體快速開發與測試。

### 3. ⏪ 獨家 5 秒「預錄回溯緩衝區」（Pre-record Buffer）
*   系統採用環形雙端佇列（`deque`）在記憶體中快取最近 5 秒的連續影格。當 AI 判定入侵觸發錄影時，會**先將這 5 秒的快取畫面寫入影片**，再繼續錄製威脅畫面。這確保了能完整還原入侵發生的「前因後果」，不漏掉任何關鍵瞬間。

### 4. 🎬 網頁原生 H.264 錄影與 HTTP 206 區段串流
*   **自動部署 OpenH264**：系統在 Windows 執行時，若偵測到缺失 H.264 編碼器，會自動從 Cisco 官方伺服器下載並部署 `openh264-1.8.0-win64.dll`，實現**完全零手動配置的 H.264 (avc1) 本地編碼！**
*   **HTTP 206 Range Requests**：影片下載路由全面支援 HTTP Range 範圍請求，以分段（Chunk）傳輸技術與 `206 Partial Content` 狀態響應瀏覽器。這解決了傳統伺服器直接傳送整份檔案（HTTP 200）導致瀏覽器拒絕解碼的痛點，實現了**秒開影片重播**與**任意拖曳進度條（Seeking）**。

### 5. ⏳ 可自訂「單次錄影最大上限時間」（Auto-Split）
*   **防範無限錄影**：為防止有物體一直在鏡頭前導致單個錄影檔過大，系統支援可自訂的單次錄影最大上限（預設為 30 秒，可在網頁面板自由調整）。
*   **秒級無縫續錄**：一旦錄影時長達到上限，系統會自動將當前影片安全存檔並寫入資料庫（讓您能立刻點選重播），同時若威脅仍在，將在**下一影格立即建立新影片繼續錄影**。

### 6. 🚨 多管道異步警報推播
支援三種警報通知管道，並具備自訂冷卻時間（Cooldown）設計，防止短時間內重複轟炸：
*   **LINE Notify**：一鍵推送警報文字訊息與現場關鍵截圖。
*   **Discord Webhook**：傳送高科技感 Rich Embed 卡片，包含事件類型、偵測置信度、觸發時間，並以附件形式嵌入現場截圖。
*   **Email (SMTP)**：支援 SSL/STARTTLS 協定，寄送精美的 HTML 格式警報郵件，內嵌現場事件截圖。

### 7. 🛡️ 企業級安全性設計
*   **即時觸發資料庫寫入**：事件觸發的當下，系統便會立即將事件資訊、觸發時的**精準真實置信度**與檔名寫入 SQLite 本機資料庫。即便伺服器中途被強行關閉，錄影與事件日誌也絕不遺失。
*   **防範 SQL 注入 (SQL Injection)**：所有安全事件日誌均透過參數化查詢（Parameterized Querying）安全寫入。
*   **目錄穿越防禦 (Path Traversal)**：提供安全檔案服務路由，針對請求路徑實施嚴格的 `os.path.basename` 擷取與邊界邊界校驗（`startswith`），確保外部無法透過 `../` 惡意獲取伺服器私密檔案。
*   **安全性繫結**：本機伺服器預設嚴格綁定在 `127.0.0.1` 迴路，防止未授權的外部連線直接存取內部監控。
*   **敏感資訊隔離**：專案設定檔 `config.json` 包含 Discord API 與 Email 密碼，已安全加入 Git 忽略清單，防止憑證意外流出。

---

## 📂 專案目錄結構

```text
NVR/
├── static/                  # Web 前端靜態資源
├── static/css/
│   └── style.css            # 高科技 Cyberpunk 暗色調 UI 樣式表
├── static/js/
│   └── app.js               # 前端 WebSockets 串流、影音播放控制與 API 互動
├── static/index.html        # 智慧監控主控台 HTML5 頁面
├── storage/                 # 安全監視儲存目錄 (已 Git 忽略，僅保留結構)
│   ├── recordings/          # 入侵事件動態錄影 H.264 (.mp4)
│   └── snapshots/           # 現場關鍵畫面截圖 (.jpg)
├── openh264-1.8.0-win64.dll # [自動下載] Cisco 官方 H.264 編碼庫 (已 Git 忽略)
├── config.py                # 線程安全系統設定管理器 (ConfigManager)
├── config.json              # [本機] 系統私密設定檔 (已 Git 忽略，防止憑證外洩)
├── config.json.example      # 系統設定檔結構範本 (供快速複製與部署)
├── database.py              # SQLite 資料庫初始化與歷史事件讀寫
├── nvr_core.py              # NVR 監控、辨識、緩衝錄製與警報分發核心
├── main.py                  # FastAPI 主程式、安全 206 串流路由與 WebSockets 伺服器
├── requirements.txt         # 專案 Python 依賴套件清單
└── README.md                # 專案說明文件
```

---

## 🛠️ 安裝與部署指南

### 1. 複製專案
```bash
git clone https://github.com/zongyandeng/NVR-Image-Recognition-Project.git
cd NVR-Image-Recognition-Project
```

### 2. 初始化設定檔
將範本檔案複製為本機使用的 `config.json`，並填入您的警報管道憑證（若暫時不需啟用通知可先保持為空）：
```bash
copy config.json.example config.json
```

### 3. 安裝依賴環境
推薦使用虛擬環境（venv）進行安裝：
```bash
# 建立虛擬環境
python -m venv venv
# 啟用虛擬環境 (Windows)
.\venv\Scripts\activate

# 安裝基本核心套件
pip install -r requirements.txt
```

### 4. (選用) 載入高級 YOLOv8 AI 引擎
如果您想要啟用高精度的人形辨識功能，請額外安裝 YOLO 套件（首次執行時系統會自動下載 `yolov8n.pt` 模型）：
```bash
pip install ultralytics
```

> [!TIP]
> **本專案已實裝自動化 OpenH264 部署機制**。當您首次在 Windows 系統啟動伺服器時，後端會自動從 Cisco 官方伺服器下載並解壓載入 H.264 動態連結庫（`.dll`），您不需要手動下載任何視訊編碼器！

---

## 🚀 啟動與使用說明

### 1. 啟動伺服器
在專案根目錄下執行：
```bash
python main.py
```
伺服器將在 `http://127.0.0.1:8000` 啟動，並自動在背景喚醒 NVR 監控引擎，若沒有偵測到本地 H.264 DLL，會先自動進行極速下載與配置。

### 2. 開啟主控台
在瀏覽器中開啟 `http://127.0.0.1:8000`：
*   **即時影像區**：展現當前監視畫面，可在設定區切換 `simulator`（模擬器影像）或 `0`（本機相機鏡頭）。
*   **安全事件歷史日誌**：顯示從資料庫讀取的歷史入侵事件。點擊列表中的縮圖或播放按鈕，可直接在網頁彈出視窗中播放該事件的 **5秒回溯+入侵錄影** 與預覽現場截圖。
*   **系統設定面板**：可隨時修改 AI 偵測門檻、延伸錄影秒數、**單次錄影最大上限時間（秒）**、警報冷卻時間，並啟用與設定 LINE、Discord 或 Email 通知。
*   **一鍵測試警報**：點擊「發送測試警報」按鈕，系統會繞過 AI 偵測，異步向您啟用的通道發送一張寫有「SYSTEM TEST ALERT」的藍色測試圖片，方便快速驗證 API Token 是否設定正確。

---

## 🛡️ 安全開發指引

*   本專案的 `config.json`、`openh264-*.dll` 及 `nvr.db` 皆已被寫入 `.gitignore` 中。**切勿將含有真實 Token、Webhook 網址或密碼的 `config.json` 提交至公開 GitHub 儲存庫**。
*   如有新增套件，請記得同步更新 `requirements.txt`。
