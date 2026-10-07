@echo off
rem Stops the portal until it is started again (or until next login, if autostart is installed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_portal.ps1"
pause
