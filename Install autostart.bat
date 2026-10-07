@echo off
rem Makes the portal start by itself at every Windows login, and starts it now.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_autostart.ps1"
pause
