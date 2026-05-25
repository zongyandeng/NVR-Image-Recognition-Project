import os
import cv2
import time
import json
import numpy as np
import threading
import requests
import smtplib
import uuid
import logging
from collections import deque
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from config import config
from database import log_event

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

STORAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage")
RECORDINGS_DIR = os.path.join(STORAGE_DIR, "recordings")
SNAPSHOTS_DIR = os.path.join(STORAGE_DIR, "snapshots")

# 自動建立錄影與截圖儲存資料夾
os.makedirs(RECORDINGS_DIR, exist_ok=True)
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

class NVREngine:
    """NVR 核心錄影與影像辨識引擎"""
    def __init__(self):
        self.running = False
        self.thread = None
        self.latest_frame = None            # 供 Web 串流讀取的最新影格
        self.latest_frame_with_box = None   # 帶有 AI 框的影格
        self.detection_metadata = []        # 偵測到的座標數據
        self.is_recording = False
        
        # 預錄緩衝區 (Pre-record Buffer) - 儲存最近 5 秒的畫面 (以 20 FPS 計為 100 影格)
        self.frame_buffer = deque(maxlen=100)
        
        # 錄影寫入器與狀態變數
        self.video_writer = None
        self.recording_filename = None
        self.recording_end_time = 0
        self.recording_start_time = 0       # 記錄當下錄影檔的啟動時間，用以做時間上限限制
        self.last_alert_time = 0            # 防止重複警報的冷卻計時器
        
        # 影像模擬器參數 (漂浮的入侵目標)
        self.sim_x = 100
        self.sim_y = 150
        self.sim_dx = 3
        self.sim_dy = 2
        
        # 初始化 OpenCV Haar Cascades 人臉偵測器 (作為預設 CPU 輕量辨識)
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        self.face_cascade = cv2.CascadeClassifier(cascade_path)
        
        # 嘗試加載高級 YOLOv8 偵測器 (若使用者有安裝 ultralytics)
        self.yolo_model = None
        try:
            from ultralytics import YOLO
            # 載入極輕量 YOLOv8 奈米模型
            self.yolo_model = YOLO("yolov8n.pt")
            logging.info("成功載入高級 YOLOv8 AI 模型！系統將自動切換為高精度人形偵測。")
        except ImportError:
            logging.info("未安裝 ultralytics 套件，系統將使用預設的 OpenCV 動態偵測與人臉識別模式。")

    def start(self):
        """啟動 NVR 監控線程"""
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._run_loop, daemon=True)
            self.thread.start()
            logging.info("NVR 監控線程已啟動。")

    def stop(self):
        """停止 NVR 監控線程"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)
        if self.video_writer:
            self.video_writer.release()
            self.video_writer = None
        logging.info("NVR 監控線程已停止。")

    def _generate_simulator_frame(self):
        """產生一幀具有網格背景與移動點的模擬監視畫面 (專門用於無鏡頭開發)"""
        # 建立一個 640x480 的深暗色背景畫布
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        # 填滿深色背景
        frame[:] = (20, 22, 28)
        
        # 繪製高科技藍色科技網格
        grid_size = 40
        for x in range(0, 640, grid_size):
            cv2.line(frame, (x, 0), (x, 480), (35, 38, 48), 1)
        for y in range(0, 480, grid_size):
            cv2.line(frame, (0, y), (640, y), (35, 38, 48), 1)
            
        enable_fence = config.get("enable_fence", False)
        fence_poly = config.get("fence_polygon", [])
        
        # 若未啟用電子圍欄，則繪製預設警戒區
        if not (enable_fence and len(fence_poly) >= 3):
            # 繪製警戒區 (Red Warning Zone) - 畫面右側大區域
            cv2.rectangle(frame, (320, 80), (600, 400), (0, 0, 80), -1) # 半透暗紅背景
            cv2.rectangle(frame, (320, 80), (600, 400), (0, 0, 200), 2)  # 紅色邊框
            cv2.putText(frame, "WARNING ZONE", (330, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        
        # 更新模擬「入侵者」物體的移動軌跡
        self.sim_x += self.sim_dx
        self.sim_y += self.sim_dy
        
        # 邊界反彈
        if self.sim_x <= 30 or self.sim_x >= 610:
            self.sim_dx = -self.sim_dx
        if self.sim_y <= 30 or self.sim_y >= 450:
            self.sim_dy = -self.sim_dy
            
        # 繪製移動物體 (模擬入侵者)
        # 我們繪製一個具有「發光」感的綠色幾何圖形
        cv2.circle(frame, (self.sim_x, self.sim_y), 25, (0, 255, 0), -1)
        cv2.circle(frame, (self.sim_x, self.sim_y), 28, (0, 200, 0), 2)
        # 畫上人形模擬符號
        cv2.putText(frame, "HUMAN-SIM", (self.sim_x - 35, self.sim_y - 35), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        
        # 標記當前時間與相機狀態
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        cv2.putText(frame, f"CAM01 [SIMULATED] | {timestamp}", (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        
        return frame

    def _detect_objects(self, frame):
        """
        影像辨識處理核心
        1. YOLO 模式：若有安裝則使用 YOLO 進行高精度人形判定。
        2. Haar Cascade 模式：若無安裝，則對「模擬影像」做座標範圍判定，對「實體影像」做人臉偵測。
        """
        detected_boxes = []
        highest_conf = 0.0
        
        # 取得設定閾值
        threshold = config.get("detection_threshold", 0.5)

        # 模式一：YOLO 偵測
        if self.yolo_model is not None:
            results = self.yolo_model(frame, verbose=False)[0]
            for box in results.boxes:
                # class 0 是 person (人)
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id == 0 and conf >= threshold:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    detected_boxes.append({
                        "box": (x1, y1, x2 - x1, y2 - y1),
                        "label": f"Person {conf:.2f}",
                        "conf": conf
                    })
                    if conf > highest_conf:
                        highest_conf = conf

        # 模式二：Haar Cascade 人臉偵測或模擬目標偵測
        else:
            # A. 針對內建「影像模擬產生器」的特別處理
            if config.get("camera_source") == "simulator":
                enable_fence = config.get("enable_fence", False)
                fence_poly = config.get("fence_polygon", [])
                
                is_inside = False
                if enable_fence and len(fence_poly) >= 3:
                    # 判斷綠球中心是否在多邊形內
                    points = []
                    for pt in fence_poly:
                        points.append([int(pt[0] * 640), int(pt[1] * 480)])
                    pts = np.array(points, dtype=np.int32)
                    dist = cv2.pointPolygonTest(pts, (self.sim_x, self.sim_y), False)
                    if dist >= 0:
                        is_inside = True
                else:
                    # 當模擬入侵者球體進入右側「警戒區」(X > 320 且 80 < Y < 400) 時觸發偵測
                    if self.sim_x > 320 and 80 < self.sim_y < 400:
                        is_inside = True
                
                if is_inside:
                    detected_boxes.append({
                        "box": (self.sim_x - 30, self.sim_y - 30, 60, 60),
                        "label": "Intruder (Simulated) 0.95",
                        "conf": 0.95
                    })
                    highest_conf = 0.95
            # B. 針對 Webcam 或實體視訊檔案
            else:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                # 偵測人臉
                faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
                for (x, y, w, h) in faces:
                    detected_boxes.append({
                        "box": (x, y, w, h),
                        "label": "Face Detected 0.85",
                        "conf": 0.85
                    })
                    highest_conf = 0.85
                    
        return detected_boxes, highest_conf

    def _run_loop(self):
        """持續擷取、辨識與錄影的無窮線程迴圈"""
        cap = None
        last_source = None
        
        while self.running:
            current_source = config.get("camera_source")
            
            # 當影像源改變時，重新釋放並初始化相機
            if current_source != last_source:
                if cap is not None:
                    cap.release()
                    cap = None
                last_source = current_source
                logging.info(f"NVR 切換影像源至: {current_source}")
                
            # 讀取一幀影格
            frame = None
            if current_source == "simulator":
                frame = self._generate_simulator_frame()
                time.sleep(0.05) # 模擬 20 FPS
            else:
                if cap is None:
                    try:
                        cap = cv2.VideoCapture(current_source)
                        # 設定較小的解析度加速處理
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    except Exception as e:
                        logging.error(f"無法開啟相機源 {current_source}: {e}，自動切回模擬器。")
                        config.update({"camera_source": "simulator"})
                        continue
                
                ret, raw_frame = cap.read()
                if not ret:
                    logging.warning("讀取相機影格失敗，嘗試重新連線...")
                    time.sleep(1.0)
                    continue
                # 強制調整至統一尺寸便於處理與錄製
                frame = cv2.resize(raw_frame, (640, 480))
            
            # 將最新影格存入 5 秒預錄緩衝區
            self.frame_buffer.append(frame.copy())
            self.latest_frame = frame.copy()
            
            # 執行影像辨識
            detected_boxes, highest_conf = self._detect_objects(frame)
            
            # 電子圍欄入侵判定
            enable_fence = config.get("enable_fence", False)
            fence_poly = config.get("fence_polygon", [])
            
            intrusion_detected = False
            polygon_contour = None
            
            if enable_fence and len(fence_poly) >= 3:
                points = []
                for pt in fence_poly:
                    points.append([int(pt[0] * 640), int(pt[1] * 480)])
                polygon_contour = np.array(points, dtype=np.int32)
                
            # 標記各偵測目標是否進入電子圍欄
            for obj in detected_boxes:
                x, y, w, h = obj["box"]
                if polygon_contour is not None:
                    # 計算腳步基準點 (底邊中點)
                    feet_point = (int(x + w / 2), int(y + h))
                    dist = cv2.pointPolygonTest(polygon_contour, feet_point, False)
                    obj["in_fence"] = dist >= 0
                    if obj["in_fence"]:
                        intrusion_detected = True
                else:
                    obj["in_fence"] = True
                    intrusion_detected = True
                    
            self.detection_metadata = detected_boxes
            
            # 繪製 AI 發光邊框於 live 影格
            annotated_frame = frame.copy()
            for obj in detected_boxes:
                x, y, w, h = obj["box"]
                is_in = obj.get("in_fence", True)
                
                # 圍欄內使用發光橙色，圍欄外使用綠色
                box_color = (255, 180, 0) if is_in else (0, 255, 0)
                
                # 繪製邊框
                cv2.rectangle(annotated_frame, (x, y), (x + w, y + h), box_color, 2)
                cv2.rectangle(annotated_frame, (x - 1, y - 1), (x + w + 1, y + h + 1), box_color, 1)
                
                # 繪製文字標籤背景
                cv2.rectangle(annotated_frame, (x, y - 25), (x + 180, y), box_color, -1)
                label_text = obj["label"]
                if enable_fence and not is_in:
                    label_text += " (Outside)"
                cv2.putText(annotated_frame, label_text, (x + 5, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (10, 15, 20), 2)
                
            # 繪製多邊形電子圍欄
            if enable_fence and len(fence_poly) >= 3:
                points = []
                for pt in fence_poly:
                    points.append([int(pt[0] * 640), int(pt[1] * 480)])
                pts = np.array(points, dtype=np.int32).reshape((-1, 1, 2))
                
                if intrusion_detected:
                    # 霓虹紅閃爍效果
                    pulse = int(time.time() * 5) % 2
                    fence_color = (0, 0, 255) if pulse == 0 else (0, 0, 180)
                    line_thickness = 3
                    
                    # 畫面頂部警告橫幅
                    cv2.rectangle(annotated_frame, (0, 0), (640, 40), (0, 0, 150), -1)
                    cv2.putText(annotated_frame, "WARNING: INTRUSION DETECTED", (140, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                else:
                    fence_color = (0, 255, 100) # 極光綠
                    line_thickness = 1
                    
                # 繪製半透明多邊形填充
                overlay = annotated_frame.copy()
                fill_color = (0, 0, 100) if intrusion_detected else (0, 100, 0)
                cv2.fillPoly(overlay, [pts], fill_color)
                cv2.addWeighted(overlay, 0.15, annotated_frame, 0.85, 0, annotated_frame)
                
                # 繪製多邊形外框與頂點發光圓點
                cv2.polylines(annotated_frame, [pts], True, fence_color, line_thickness)
                for pt in points:
                    cv2.circle(annotated_frame, (pt[0], pt[1]), 5, fence_color, -1)
                    cv2.circle(annotated_frame, (pt[0], pt[1]), 7, (255, 255, 255), 1)
                
            # NVR 動態事件錄影邏輯
            # 判斷是否滿足觸發警報條件 (啟用圍欄時，必須有在圍欄內的目標)
            trigger_alert = intrusion_detected if (enable_fence and len(fence_poly) >= 3) else (len(detected_boxes) > 0)
            
            if trigger_alert:
                # 偵測到入侵！
                now = time.time()
                self.recording_end_time = now + config.get("recording_duration", 10)
                
                if not self.is_recording:
                    # 取得在圍欄內目標的最高置信度
                    fence_confs = [obj["conf"] for obj in detected_boxes if obj.get("in_fence", False)]
                    trigger_conf = max(fence_confs) if fence_confs else highest_conf
                    # 啟動錄影！
                    self._start_recording(frame, trigger_conf)
            
            # 如果錄影中，將影格寫入影片
            if self.is_recording:
                if self.video_writer is not None:
                    try:
                        self.video_writer.write(frame)
                    except Exception as e:
                        logging.error(f"寫入影片影格失敗: {e}")
                
                # 在網頁即時畫面上加註閃爍的「● REC」警報字樣
                if int(time.time() * 2) % 2 == 0:
                    cv2.circle(annotated_frame, (40, 70), 8, (0, 0, 255), -1)
                    cv2.putText(annotated_frame, "REC ACTIVE", (55, 76), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                
                # 檢查錄影是否超時，或是達到單次錄影的最大時間上限
                now = time.time()
                is_timeout = now > self.recording_end_time
                is_max_reached = now >= (self.recording_start_time + config.get("max_recording_duration", 30))
                
                if is_timeout or is_max_reached:
                    if is_max_reached:
                        logging.info(f"已達到單次最大錄影時長 ({config.get('max_recording_duration', 30)} 秒)，自動切換檔案。")
                    self._stop_recording()
            
            self.latest_frame_with_box = annotated_frame
            
        # 退出循環，釋放資源
        if cap is not None:
            cap.release()

    def _start_recording(self, trigger_frame, confidence):
        """觸發 NVR 錄影事件"""
        self.is_recording = True
        self.recording_start_time = time.time()
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        
        self.recording_filename = f"{timestamp_str}_{unique_id}.mp4"
        video_path = os.path.join(RECORDINGS_DIR, self.recording_filename)
        
        # 初始化錄影寫入器 (H.264/AVC 編碼器，供瀏覽器原生播放)
        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        self.video_writer = cv2.VideoWriter(video_path, fourcc, 20.0, (640, 480))
        
        # 1. 傾倒「前錄緩衝區」內容至影片 (回溯前 5 秒的真相！)
        for buffered_frame in list(self.frame_buffer):
            self.video_writer.write(buffered_frame)
            
        # 2. 儲存當下帶有 AI 辨識框的警報截圖 (.jpg)
        snapshot_filename = self.recording_filename.replace(".mp4", ".jpg")
        snapshot_path = os.path.join(SNAPSHOTS_DIR, snapshot_filename)
        # 用於警報的圖片加上當前 AI 標籤
        cv2.imwrite(snapshot_path, self.latest_frame_with_box if self.latest_frame_with_box is not None else trigger_frame)
        
        # 3. 異步觸發多管道通知，避免阻礙視訊處理主線程
        now = time.time()
        is_cooldown_active = (now - self.last_alert_time) < config.get("detection_cooldown", 30)
        
        if not is_cooldown_active:
            self.last_alert_time = now
            threading.Thread(
                target=self._dispatch_alerts,
                args=("Intruder", confidence, snapshot_path),
                daemon=True
            ).start()
            self._db_log_notified = True
        else:
            logging.info("警報冷卻中，本次事件不重複發送手機/郵件推播。")
            self._db_log_notified = False

        # 4. 立即將事件寫入 SQLite 資料庫，確保在錄影開始時就記錄，以防異常關機或長時間錄影未結束導致遺失
        log_event(
            event_type="Intruder Detected",
            confidence=confidence,
            snapshot_filename=snapshot_filename,
            video_filename=self.recording_filename,
            is_notified=self._db_log_notified
        )

    def _stop_recording(self):
        """停止並關閉影片寫入"""
        self.is_recording = False
        if self.video_writer is not None:
            self.video_writer.release()
            self.video_writer = None
            
        logging.info(f"動態錄影結束，檔案已儲存: {self.recording_filename}")

    def _dispatch_alerts(self, event_type, confidence, snapshot_path):
        """發送警報至所有啟用的通知管道 (LINE, Discord, Email)"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # 1. LINE Notify
        if config.get("enable_line") and config.get("line_token"):
            try:
                token = config.get("line_token")
                headers = {"Authorization": f"Bearer {token}"}
                payload = {
                    "message": f"\n🚨 **[NVR 安全警報]**\n時間: {timestamp}\n類型: {event_type}\n置信度: {confidence:.2f}\n⚠️ 偵測到警戒區內有可疑活動！請即刻查看監控主控台。"
                }
                with open(snapshot_path, "rb") as img:
                    files = {"imageFile": img}
                    r = requests.post("https://notify-api.line.me/api/notify", headers=headers, data=payload, files=files, timeout=5)
                    if r.status_code == 200:
                        logging.info("LINE Notify 警報截圖傳送成功！")
                    else:
                        logging.warning(f"LINE Notify 傳送失敗，狀態碼: {r.status_code}")
            except Exception as e:
                logging.error(f"發送 LINE 警報異常: {e}")

        # 2. Discord Webhook
        if config.get("enable_discord") and config.get("discord_webhook"):
            try:
                webhook_url = config.get("discord_webhook")
                payload = {
                    "content": "🚨 **[警報] NVR 智慧安全監控系統觸發！**",
                    "embeds": [{
                        "title": "🛡️ 居家防盜安全通報",
                        "description": "系統已自動啟動 5 秒預錄緩衝動態監控存檔。",
                        "color": 16711680, # 鮮紅
                        "fields": [
                            {"name": "事件類型", "value": event_type, "inline": True},
                            {"name": "偵測機率", "value": f"{confidence * 100:.1f}%", "inline": True},
                            {"name": "觸發時間", "value": timestamp, "inline": False}
                        ],
                        "image": {"url": "attachment://snapshot.jpg"},
                        "footer": {"text": "AI Soft-NVR Surveillance System"}
                    }]
                }
                with open(snapshot_path, "rb") as img:
                    files = {"files[0]": ("snapshot.jpg", img, "image/jpeg")}
                    r = requests.post(webhook_url, data={"payload_json": json.dumps(payload)}, files=files, timeout=5)
                    if r.status_code in [200, 204]:
                        logging.info("Discord Webhook 警報截圖傳送成功！")
                    else:
                        logging.warning(f"Discord 傳送失敗，狀態碼: {r.status_code}")
            except Exception as e:
                logging.error(f"發送 Discord 警報異常: {e}")

        # 3. Email (SMTP)
        if config.get("enable_email") and config.get("email_smtp_server") and config.get("email_sender"):
            try:
                smtp_server = config.get("email_smtp_server")
                smtp_port = config.get("email_smtp_port", 587)
                sender = config.get("email_sender")
                password = config.get("email_password")
                receiver = config.get("email_receiver")
                
                # 建立郵件本體
                msg = MIMEMultipart()
                msg["Subject"] = f"🚨 安全警報: 偵測到 {event_type} 入侵！"
                msg["From"] = sender
                msg["To"] = receiver
                
                body = f"""
                <h3>🛡️ AI 智慧 NVR 居家安全通報</h3>
                <hr/>
                <p><b>觸發時間:</b> {timestamp}</p>
                <p><b>偵測類型:</b> {event_type}</p>
                <p><b>辨識置信度:</b> {confidence * 100:.1f}%</p>
                <p>系統已自動錄製該段動態畫面。以下為事件發生的現場截圖：</p>
                """
                msg.attach(MIMEText(body, "html", "utf-8"))
                
                # 夾帶截圖附件
                with open(snapshot_path, "rb") as img:
                    img_data = img.read()
                    mime_image = MIMEImage(img_data, name="snapshot.jpg")
                    # 設定 content-id 方便未來在 HTML 內嵌 (可選)
                    mime_image.add_header('Content-ID', '<snapshot>')
                    msg.attach(mime_image)
                
                # 發送郵件 (支援 587 STARTTLS 或 465 SSL)
                if smtp_port == 465:
                    server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=5)
                else:
                    server = smtplib.SMTP(smtp_server, smtp_port, timeout=5)
                    server.starttls()
                
                if password:
                    server.login(sender, password)
                server.sendmail(sender, [receiver], msg.as_string())
                server.quit()
                logging.info("Email 警報郵件發送成功！")
            except Exception as e:
                logging.error(f"發送 Email 警報異常: {e}")

# 全域單例 NVR 引擎
nvr_engine = NVREngine()
