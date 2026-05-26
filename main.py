import os
import cv2
import json
import base64
import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Union

from config import config
from database import get_events
from nvr_core import nvr_engine, RECORDINGS_DIR, SNAPSHOTS_DIR

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = FastAPI(title="AI Soft-NVR Surveillance System")

# 警報測試資料模型
class SettingsUpdate(BaseModel):
    camera_source: Optional[Union[str, int]] = None
    detection_threshold: Optional[float] = None
    detection_cooldown: Optional[int] = None
    recording_duration: Optional[int] = None
    max_recording_duration: Optional[int] = None
    line_token: Optional[str] = None
    discord_webhook: Optional[str] = None
    email_smtp_server: Optional[str] = None
    email_smtp_port: Optional[int] = None
    email_sender: Optional[str] = None
    email_password: Optional[str] = None
    email_receiver: Optional[str] = None
    enable_line: Optional[bool] = None
    enable_discord: Optional[bool] = None
    enable_email: Optional[bool] = None
    enable_fence: Optional[bool] = None
    fence_polygon: Optional[List] = None

@app.on_event("startup")
async def startup_event():
    """伺服器啟動時，啟動背景 NVR 監控引擎"""
    nvr_engine.start()
    logging.info("FastAPI 伺服器啟動，已啟動 NVR 監控引擎。")

@app.on_event("shutdown")
async def shutdown_event():
    """伺服器關閉時，優雅地停止 NVR 引擎"""
    nvr_engine.stop()
    logging.info("FastAPI 伺服器停止，已停止 NVR 監控引擎。")

# ==================== API 路由 ====================

@app.get("/api/events")
async def get_events_api(limit: int = 50, offset: int = 0):
    """查詢歷史安全事件日誌"""
    events = get_events(limit=limit, offset=offset)
    return JSONResponse(content=events)

@app.get("/api/settings")
async def get_settings_api():
    """讀取當前系統設定"""
    return JSONResponse(content=config.get_all())

@app.post("/api/settings")
async def update_settings_api(request: Request):
    """
    更新系統設定
    【安全防禦與極致除錯】：動態接收 JSON，手動解析，避免 Pydantic 靜態 Validation 錯誤導致 422 卡死，並提供詳盡日誌！
    """
    try:
        body = await request.json()
        logging.info(f"收到更新設定請求 payload: {body}")
        
        # 我們直接使用 Pydantic 進行防禦性驗證，若出錯則主動捕捉，列印出具體是哪個欄位失敗
        try:
            settings_obj = SettingsUpdate(**body)
        except Exception as ve:
            logging.error(f"Pydantic 校驗設定失敗: {ve}")
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"設定格式校驗失敗: {str(ve)}"}
            )
            
        # 安全回寫設定
        config.update(settings_obj.dict())
        return JSONResponse(content={"status": "success", "message": "Settings updated successfully."})
        
    except Exception as e:
        logging.error(f"更新設定路由異常: {e}")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": f"伺服器內部錯誤: {str(e)}"}
        )

@app.post("/api/test-alert")
async def test_alert_api():
    """
    手動發送測試警報 (LINE / Discord / Email)
    方便使用者在沒有入侵者時，一鍵驗證通知權杖與設定是否正確。
    """
    # 建立一個測試用的臨時圖片 (藍色底圖寫上 TEST ALERT)
    import numpy as np
    import tempfile
    
    test_img = np.zeros((480, 640, 3), dtype=np.uint8)
    test_img[:] = (200, 50, 50) # 藍色背景
    cv2.putText(test_img, "SYSTEM TEST ALERT", (80, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    cv2.putText(test_img, "Verification Successful!", (120, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
    
    temp_dir = tempfile.gettempdir()
    test_path = os.path.join(temp_dir, "nvr_test_alert.jpg")
    cv2.imwrite(test_path, test_img)
    
    try:
        # 異步發送測試警報
        nvr_engine._dispatch_alerts("Manual Test Event", 0.99, test_path)
        return JSONResponse(content={"status": "success", "message": "測試警報已發送！請檢查您啟用的 LINE、Discord 或 Email 信箱。"})
    except Exception as e:
        return JSONResponse(content={"status": "error", "message": f"測試警報發送失敗: {str(e)}"}, status_code=500)

# ==================== 安全檔案服務路由 (防禦 Path Traversal) ====================

@app.get("/api/video/{filename}")
async def get_video(filename: str, request: Request):
    """
    安全地串流播放特定 .mp4 錄影檔案，支援 HTTP 206 範圍請求 (Range Requests)
    【安全防禦】：全面防範 Path Traversal (目錄穿越攻擊)
    """
    # 1. 強制擷取純檔名，防止惡意傳入 ../../../ 等字元
    safe_filename = os.path.basename(filename)
    
    # 2. 合併為絕對路徑
    full_path = os.path.abspath(os.path.join(RECORDINGS_DIR, safe_filename))
    
    # 3. 取得錄影目錄的絕對路徑，並強制加上路徑分隔符，進行邊界防禦
    base_dir = os.path.abspath(RECORDINGS_DIR)
    
    # 4. 嚴格檢查解析後的路徑是否位於指定的錄影目錄內，且檔案必須存在
    if not full_path.startswith(base_dir + os.path.sep):
        logging.warning(f"偵測到目錄穿越攻擊企圖！請求路徑: {filename}")
        raise HTTPException(status_code=403, detail="Forbidden: Access Denied")
        
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Recording video not found")
        
    file_size = os.path.getsize(full_path)
    range_header = request.headers.get("range")
    
    if not range_header:
        # 如果瀏覽器沒有要求 Range，則回傳完整的檔案流
        return FileResponse(full_path, media_type="video/mp4")
        
    # 處理 HTTP 206 Range 請求
    try:
        # 解析 "bytes=start-end"
        range_str = range_header.replace("bytes=", "")
        parts = range_str.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        
        # 確保邊界正確
        if start >= file_size or end >= file_size or start > end:
            raise HTTPException(status_code=416, detail="Requested Range Not Satisfiable")
    except Exception:
        raise HTTPException(status_code=416, detail="Requested Range Not Satisfiable")
        
    # 建立影片區段生成器 (Chunk Generator)
    def file_chunk_generator(path, start_pos, end_pos, chunk_size=1024*512):
        with open(path, "rb") as f:
            f.seek(start_pos)
            remaining = end_pos - start_pos + 1
            while remaining > 0:
                chunk = f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
                
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Content-Type": "video/mp4",
    }
    
    return StreamingResponse(
        file_chunk_generator(full_path, start, end),
        status_code=206,
        headers=headers
    )

@app.get("/api/image/{filename}")
async def get_image(filename: str):
    """
    安全地提供警報事件截圖預覽
    【安全防禦】：防範 Path Traversal 穿越攻擊；若實體檔案遺失，自動渲染高科技感佔位圖防範 404 報錯與前端破圖！
    """
    safe_filename = os.path.basename(filename)
    full_path = os.path.abspath(os.path.join(SNAPSHOTS_DIR, safe_filename))
    base_dir = os.path.abspath(SNAPSHOTS_DIR)
    
    if not full_path.startswith(base_dir + os.path.sep):
        logging.warning(f"偵測到目錄穿越攻擊企圖！請求路徑: {filename}")
        raise HTTPException(status_code=403, detail="Forbidden: Access Denied")
        
    # 若截圖檔案遺失（例如歷史紀錄被刪除），自動動態渲染高科技感佔位圖
    if not os.path.exists(full_path):
        import numpy as np
        # 建立一個 320x180 (16:9) 的高科技深灰背景
        placeholder = np.zeros((180, 320, 3), dtype=np.uint8)
        placeholder[:] = (20, 22, 28) # 深暗色背景
        
        # 畫上高科技裝飾格線
        cv2.rectangle(placeholder, (5, 5), (315, 175), (45, 48, 58), 1)
        cv2.line(placeholder, (5, 5), (25, 5), (0, 210, 255), 2)
        cv2.line(placeholder, (5, 5), (5, 25), (0, 210, 255), 2)
        
        # 繪製文字 (若無法顯示中文，用英文字體確保相容)
        cv2.putText(placeholder, "AI Soft-NVR", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 210, 255), 1)
        cv2.putText(placeholder, "SNAPSHOT MISSING", (20, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 120), 1)
        cv2.putText(placeholder, "File Not Found (404)", (20, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (80, 80, 95), 1)
        
        # 編碼為 JPEG
        ret, jpeg_buffer = cv2.imencode('.jpg', placeholder)
        if ret:
            from fastapi.responses import Response
            return Response(content=jpeg_buffer.tobytes(), media_type="image/jpeg")
            
        raise HTTPException(status_code=404, detail="Snapshot image not found")
    return FileResponse(full_path, media_type="image/jpeg")

# ==================== WebSocket 即時串流服務 ====================

@app.websocket("/api/stream")
async def websocket_stream(websocket: WebSocket):
    """
    即時影像 WebSockets 伺服器
    將影格進行高壓縮比 JPEG 編碼並轉為 Base64 字串，與 AI 置信度、錄影狀態打包為 JSON 即時推播。
    """
    await websocket.accept()
    logging.info("Web 監控終端已連線至 WebSocket 串流。")
    
    try:
        while True:
            # 優先讀取帶有 AI 藍框與 REC 字樣的影格
            frame = nvr_engine.latest_frame_with_box
            if frame is None:
                # 若尚未就緒，使用原始影格
                frame = nvr_engine.latest_frame
                
            if frame is not None:
                payload = None
                try:
                    # 將影像進行 JPEG 壓縮 (品質設為 75，以取得頻寬與解析度的平衡)
                    ret, jpeg_buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    if ret:
                        # 將 JPEG 二進位資料編碼為 base64 字串
                        base64_image = base64.b64encode(jpeg_buffer).decode('utf-8')
                        
                        # 整理打包要推送到前端的實時封包
                        payload = {
                            "image": f"data:image/jpeg;base64,{base64_image}",
                            "is_recording": nvr_engine.is_recording,
                            "active_objects": len(nvr_engine.detection_metadata),
                            "objects": [
                                {
                                    "box": obj["box"],
                                    "label": obj["label"],
                                    "conf": obj["conf"]
                                } for obj in nvr_engine.detection_metadata
                            ]
                        }
                except Exception as e:
                    logging.error(f"影像編碼與封包組裝失敗: {e}")
                
                if payload is not None:
                    # 發送 JSON (若連線已中斷將直接拋出異常由外層捕獲，結束此連線迴圈，防止無限 Log 狂飆)
                    await websocket.send_json(payload)
                    
            # 維持 ~20 FPS 傳輸速度，避免瀏覽器繪製阻塞
            await asyncio.sleep(0.05)
            
    except WebSocketDisconnect:
        logging.info("Web 監控終端已中斷 WebSocket 連線。")
    except Exception as e:
        logging.error(f"WebSocket 異常: {e}")

# ==================== 託管 Web 前端靜態資源 ====================

# 確保靜態目錄存在
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)

# 託管前端 (html=True 表示預設尋找 index.html)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # 【安全規範】：測試伺服器嚴格綁定在 127.0.0.1 (localhost)，禁止綁定 0.0.0.0 防止未授權連線
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
