@echo off
setlocal

:: TherapyNote AI Scribe - Windows Setup Script
:: Checks for Ollama and the AI model, installs only what's missing.

set "OLLAMA_MODEL=phi3"

echo ===================================
echo   TherapyNote AI Scribe - Setup
echo ===================================
echo.

:: ── Step 1: Check for Ollama ─────────────────────────────────

echo Checking for Ollama...

where ollama >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Ollama is installed.
) else (
    echo [!!] Ollama is not installed.
    echo.
    echo Please install Ollama from:
    echo   https://ollama.com/download
    echo.
    echo Run the installer, then re-run this script.
    goto :end
)

echo.

:: ── Step 2: Check if Ollama server is running ────────────────

echo Checking if Ollama server is running...

curl -s http://localhost:11434/api/tags >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Ollama server is running.
) else (
    echo [!!] Ollama server is not running. Attempting to start...
    start /b ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul

    curl -s http://localhost:11434/api/tags >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Ollama server started.
    ) else (
        echo [!!] Could not auto-start Ollama server.
        echo      You may need to run 'ollama serve' manually.
    )
)

echo.

:: ── Step 3: Check for the AI model ───────────────────────────

echo Checking for AI model (%OLLAMA_MODEL%)...

ollama list 2>nul | findstr /b "%OLLAMA_MODEL%" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Model '%OLLAMA_MODEL%' is already downloaded.
) else (
    echo [!!] Model '%OLLAMA_MODEL%' is not downloaded.
    echo      Downloading now (this may take a few minutes)...
    echo.

    ollama pull %OLLAMA_MODEL%
    if %ERRORLEVEL% EQU 0 (
        echo.
        echo [OK] Model '%OLLAMA_MODEL%' downloaded successfully.
    ) else (
        echo.
        echo [!!] Failed to download model. Please run manually:
        echo      ollama pull %OLLAMA_MODEL%
        goto :end
    )
)

echo.

:: ── Step 4: Generate icons (if missing) ──────────────────────

echo Checking extension icons...

if exist "%~dp0icons\icon128.png" (
    echo [OK] Extension icons exist.
) else (
    echo [!!] Extension icons missing. Generating...
    where python >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        pip install Pillow -q 2>nul
        python "%~dp0generate_icons.py"
    ) else (
        where python3 >nul 2>&1
        if %ERRORLEVEL% EQU 0 (
            pip3 install Pillow -q 2>nul
            python3 "%~dp0generate_icons.py"
        ) else (
            echo [!!] Python not found. Please install Python or run:
            echo      pip install Pillow ^&^& python generate_icons.py
        )
    )
)

echo.

:: ── Done ─────────────────────────────────────────────────────

echo ===================================
echo Setup complete!
echo ===================================
echo.
echo To use the extension:
echo   1. Open chrome://extensions in Chrome
echo   2. Enable Developer mode
echo   3. Click 'Load unpacked' and select this folder
echo   4. Pin the extension to your toolbar
echo.
echo Tip: Use Ctrl+Enter to generate notes.
echo.

:end
endlocal
pause
