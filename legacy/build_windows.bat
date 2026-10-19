@echo off
REM ===========================================================================
REM  Gratovo IMA ToolBox - one-click Windows export.
REM
REM  Double-click this file (or run it from a terminal) to build the release
REM  .exe and stage a shareable folder + .zip under dist\.
REM
REM  Any arguments are passed through to scripts\build_windows.ps1, e.g.
REM      build_windows.bat -Clean -Installer
REM ===========================================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build_windows.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo Build FAILED with exit code %EXITCODE%.
)
echo.
pause
exit /b %EXITCODE%
