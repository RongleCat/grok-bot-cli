@echo off
rem exit /b forwards powershell.exe's code, including 5. grok-bot.ps1 calls exit, so -File keeps that code.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0grok-bot.ps1" %*
exit /b %ERRORLEVEL%
