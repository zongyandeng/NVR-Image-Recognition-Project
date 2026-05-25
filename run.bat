@echo off
:: 設定字元集為 UTF-8
chcp 65001 > nul
title AI Soft-NVR 智慧安全監控與入侵辨識系統 - 一鍵啟動

:: 動態取得 ANSI ESC 字元
for /f "tokens=1-2 delims=#" %%a in ('"prompt #$H#$E# & echo on & for %%b in (1) do rem"') do set "ESC=%%b"
set "Cyan=%ESC%[96m"
set "Green=%ESC%[92m"
set "Yellow=%ESC%[93m"
set "Red=%ESC%[91m"
set "White=%ESC%[97m"
set "Gray=%ESC%[90m"
set "Reset=%ESC%[0m"

cls
echo %Cyan%======================================================================%Reset%
echo %Cyan%   🛡️  AI Soft-NVR 智慧安全監控與入侵辨識系統 (一鍵啟動)%Reset%
echo %Cyan%======================================================================%Reset%
echo %Gray%   系統將自動檢測環境、部署設定檔、建立虛擬環境並啟動服務...%Reset%
echo.

:: 1. 檢測 Python 是否安裝
echo %Cyan%[步驟 1/5]%Reset% 正在檢測 Python 環境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %Red%[錯誤] 未偵測到 Python！請先安裝 Python 3.8 或以上版本，並勾選「Add Python to PATH」。%Reset%
    echo %Yellow%提示：您可以前往 https://www.python.org/downloads/ 下載安裝。%Reset%
    pause
    exit /b 1
)
for /f "tokens=2" %%I in ('python --version 2^>^&1') do set "PY_VER=%%I"
echo %Green%[成功]%Reset% 偵測到 Python %PY_VER%

:: 2. 檢查並建立 config.json
echo.
echo %Cyan%[步驟 2/5]%Reset% 正在檢查設定檔...
if not exist config.json (
    if exist config.json.example (
        echo %Yellow%[提示] config.json 不存在，正在從範本複製...%Reset%
        copy config.json.example config.json > nul
        echo %Green%[成功]%Reset% 已建立預設設定檔 config.json
    ) else (
        echo %Red%[錯誤] 找不到 config.json.example 範本檔案，無法初始化設定檔！%Reset%
        pause
        exit /b 1
    )
) else (
    echo %Green%[成功]%Reset% 設定檔 config.json 已存在。
)

:: 3. 檢查並建立虛擬環境 (venv)
echo.
echo %Cyan%[步驟 3/5]%Reset% 正在檢查 Python 虛擬環境 (venv)...
set "FIRST_RUN=false"
if not exist venv (
    echo %Yellow%[提示] 偵測到尚未建立虛擬環境，正在為您建立 (這可能需要數十秒)...%Reset%
    python -m venv venv
    if %errorlevel% neq 0 (
        echo %Red%[錯誤] 建立虛擬環境失敗！%Reset%
        pause
        exit /b 1
    )
    echo %Green%[成功]%Reset% 虛擬環境建立完成！
    set "FIRST_RUN=true"
) else (
    echo %Green%[成功]%Reset% 虛擬環境已存在。
)

:: 4. 啟用虛擬環境並安裝依賴
echo.
echo %Cyan%[步驟 4/5]%Reset% 正在啟用虛擬環境並更新依賴套件...
call venv\Scripts\activate
if %errorlevel% neq 0 (
    echo %Red%[錯誤] 無法啟用虛擬環境！%Reset%
    pause
    exit /b 1
)

if "%FIRST_RUN%"=="true" (
    echo %Cyan%[系統] 首次啟動，正在安裝依賴套件 (requirements.txt)...%Reset%
    python -m pip install --upgrade pip > nul
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo %Red%[錯誤] 依賴套件安裝失敗！%Reset%
        pause
        exit /b 1
    )
    echo %Cyan%[系統] 正在安裝高級 YOLOv8 AI 引擎 (ultralytics)...%Reset%
    pip install ultralytics
    if %errorlevel% neq 0 (
        echo %Yellow%[警告] YOLOv8 安裝失敗，系統將自動降級使用 OpenCV 輕量模式。%Reset%
    ) else (
        echo %Green%[成功]%Reset% YOLOv8 AI 引擎安裝成功！
    )
) else (
    echo %Green%[成功]%Reset% 虛擬環境已成功啟用。
    echo %Gray%提示：若執行時遇到套件缺失，您可以手動刪除 venv 資料夾，重新執行此批次檔以重新安裝。%Reset%
)

:: 5. 啟動伺服器與開啟網頁
echo.
echo %Cyan%[步驟 5/5]%Reset% 正在啟動 NVR 智慧安全監控系統...
echo %Green%======================================================================%Reset%
echo %Green%   🎉 系統已準備就緒！%Reset%
echo %Green%   👉 網頁控制台：http://127.0.0.1:8000 %Reset%
echo %Green%   ℹ️  若網頁沒有自動開啟，請手動輸入上述網址。%Reset%
echo %Green%======================================================================%Reset%
echo.
echo 正在為您在預設瀏覽器中開啟控制台頁面...
start http://127.0.0.1:8000

python main.py
if %errorlevel% neq 0 (
    echo.
    echo %Red%[錯誤] 伺服器異常終止！%Reset%
    pause
)
