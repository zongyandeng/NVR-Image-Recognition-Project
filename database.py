import os
import sqlite3
import logging
from datetime import datetime

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nvr.db")

def get_db_connection():
    """建立並取得資料庫連線，設定 row_factory 方便以字典格式讀取欄位"""
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """初始化資料庫與事件日誌表"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 建立事件資料表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                confidence REAL NOT NULL,
                snapshot_filename TEXT,
                video_filename TEXT,
                is_notified INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        logging.info("資料庫表格初始化成功。")
    except Exception as e:
        logging.error(f"資料庫初始化失敗: {e}")
    finally:
        conn.close()

def log_event(event_type: str, confidence: float, snapshot_filename: str = None, video_filename: str = None, is_notified: bool = False):
    """
    安全地記錄一次偵測事件
    使用 SQL 參數化查詢 (?) 徹底防禦 SQL Injection (SQL注入攻擊)
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    notified_int = 1 if is_notified else 0
    try:
        cursor.execute(
            """
            INSERT INTO events (timestamp, event_type, confidence, snapshot_filename, video_filename, is_notified)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (timestamp, event_type, confidence, snapshot_filename, video_filename, notified_int)
        )
        conn.commit()
        last_id = cursor.lastrowid
        logging.info(f"安全事件已寫入資料庫：ID {last_id} - {event_type} (置信度: {confidence:.2f})")
        return last_id
    except Exception as e:
        logging.error(f"寫入事件至資料庫失敗: {e}")
        return None
    finally:
        conn.close()

def get_events(limit: int = 50, offset: int = 0):
    """
    取得歷史安全事件列表，按時間降序排列 (最新事件在前)
    使用參數化設計限制回傳筆數
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id, timestamp, event_type, confidence, snapshot_filename, video_filename, is_notified
            FROM events
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset)
        )
        rows = cursor.fetchall()
        # 轉換為容易轉為 JSON 的字典列表
        return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"查詢歷史事件失敗: {e}")
        return []
    finally:
        conn.close()

def get_event_by_id(event_id: int):
    """根據 ID 查詢特定事件"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM events WHERE id = ?",
            (event_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    except Exception as e:
        logging.error(f"查詢特定事件失敗: {e}")
        return None
    finally:
        conn.close()

# 程式載入時自動初始化資料庫
init_db()
