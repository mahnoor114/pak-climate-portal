@echo off
rem Double-click once: wakes this PC every day at 06:00 (when plugged in) so the portal fetches fresh weather data.
title Install daily refresh
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_daily_refresh.ps1"
pause
