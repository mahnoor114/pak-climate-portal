@echo off
rem Double-click to open the Pakistan Climate portal in your browser (starts it first if needed).
title Pakistan Climate Intelligence
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_portal.ps1"
if errorlevel 1 pause
