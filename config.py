import os
import json
import threading
import logging

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

# 預設系統設定
DEFAULT_CONFIG = {
    "camera_source": "simulator",       # "simulator" (內建影像模擬), 0 (本機鏡頭), 或 "rtsp://..." (RTSP 串流/影片路徑)
    "detection_threshold": 0.5,         # AI 偵測門檻置信度 (0.0 到 1.0)
    "detection_cooldown": 30,           # 警報冷卻時間 (秒)，防止頻繁轟炸
    "recording_duration": 10,           # 偵測到入侵後的動態錄影長度 (秒)
    
    # 警報管道設定
    "line_token": "",                   # LINE Notify 權杖
    "discord_webhook": "",              # Discord Webhook URL
    "email_smtp_server": "",            # SMTP 伺服器 (例如: smtp.gmail.com)
    "email_smtp_port": 587,             # SMTP 埠號 (例如: 587 或 465)
    "email_sender": "",                 # 寄件者信箱
    "email_password": "",               # 寄件者密碼 (推薦使用應用程式密碼，非實體密碼)
    "email_receiver": "",               # 收件者信箱
    
    # 警報管道啟用狀態
    "enable_line": False,
    "enable_discord": False,
    "enable_email": False
}

class ConfigManager:
    """線程安全的系統設定管理器"""
    def __init__(self):
        self._config = DEFAULT_CONFIG.copy()
        self._lock = threading.Lock()
        self.load()

    def load(self):
        """從 config.json 載入設定，若檔案不存在則建立預設檔案"""
        with self._lock:
            if os.path.exists(CONFIG_FILE):
                try:
                    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                        loaded_data = json.load(f)
                        # 合併預設值，防止載入舊版缺少新欄位
                        for key, val in DEFAULT_CONFIG.items():
                            if key not in loaded_data:
                                loaded_data[key] = val
                        self._config = loaded_data
                        logging.info("系統設定檔載入成功。")
                except Exception as e:
                    logging.error(f"讀取設定檔失敗: {e}，改用預設設定。")
                    self._config = DEFAULT_CONFIG.copy()
            else:
                self._save_unlocked()
                logging.info("找不到設定檔，已自動建立預設的 config.json。")

    def _save_unlocked(self):
        """(內部非安全鎖) 將目前設定存檔"""
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self._config, f, indent=4, ensure_ascii=False)
        except Exception as e:
            logging.error(f"儲存設定檔失敗: {e}")

    def save(self):
        """線程安全地儲存設定"""
        with self._lock:
            self._save_unlocked()

    def get(self, key, default=None):
        """取得指定金鑰的設定值"""
        with self._lock:
            return self._config.get(key, default)

    def get_all(self):
        """取得所有設定的複本"""
        with self._lock:
            return self._config.copy()

    def update(self, new_settings: dict):
        """安全地批量更新設定，並回寫檔案"""
        with self._lock:
            for key, value in new_settings.items():
                if key in DEFAULT_CONFIG:
                    # 類型檢查與轉換
                    expected_type = type(DEFAULT_CONFIG[key])
                    try:
                        if expected_type == bool:
                            self._config[key] = bool(value)
                        elif expected_type == int:
                            self._config[key] = int(value)
                        elif expected_type == float:
                            self._config[key] = float(value)
                        else:
                            # 針對相機源，若是數字字串 (例如 "0")，自動轉成 int 以利 OpenCV 讀取 Webcam
                            if key == "camera_source" and str(value).isdigit():
                                self._config[key] = int(value)
                            else:
                                self._config[key] = str(value)
                    except Exception as e:
                        logging.warning(f"更新欄位 {key} 時轉型失敗: {e}，維持原值。")
            self._save_unlocked()
            logging.info("系統設定更新成功。")

# 單例模式 (Singleton) 供其他模組調用
config = ConfigManager()
