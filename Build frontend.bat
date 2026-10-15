@echo off
rem Double-click after changing anything in the frontend folder: rebuilds the React app into dist (needs Node.js).
title Build portal frontend
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_frontend.ps1"
pause
