@echo off
rem Mesh UI command line launcher (docs/platform/build-and-release.md#cli-launcher).
rem Runs the app's own Node mode on cli-relay.js, which starts "Mesh UI.exe --cli"
rem with piped stdio so output reaches this console and the exit code passes through.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\Mesh UI.exe" "%~dp0..\resources\cli-relay.js" %*
exit /b %ERRORLEVEL%
