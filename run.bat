@echo off
title AI Soft-NVR Starter

echo ==========================================
echo       AI Soft-NVR Starter Program
echo ==========================================
echo.

:: 1. Navigate to project directory
echo [1/3] Navigating to project directory...
d:
cd "d:\MyDesktop\antigravity2.0\NVR"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to navigate to d:\MyDesktop\antigravity2.0\NVR
    pause
    exit /b 1
)

:: 2. Activate virtual environment if it exists
echo [2/3] Checking Python virtual environment (venv)...
if exist "venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "venv\Scripts\activate.bat"
) else (
    echo [INFO] No virtual environment found, using system Python...
)

:: 3. Open browser to http://127.0.0.1:8000
echo [3/3] Launching web browser to http://127.0.0.1:8000 ...
start http://127.0.0.1:8000

:: 4. Run application
echo Launching FastAPI Server (main.py)...
python main.py
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server terminated with error code %errorlevel%.
    pause
)
