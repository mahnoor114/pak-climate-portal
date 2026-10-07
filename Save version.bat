@echo off
rem Saves the portal: a new version in the history and a dated backup zip in the backups folder (API keys excluded).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0save_version.ps1" %*
pause
