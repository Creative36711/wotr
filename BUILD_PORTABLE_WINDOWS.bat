@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   War of the Ring - portable Windows build
echo ================================================
echo.

where node >nul 2>nul || (
  echo ERROR: Node.js was not found.
  echo Install Node.js 20 or newer and restart this terminal.
  pause
  exit /b 1
)
where cargo >nul 2>nul || (
  echo ERROR: Rust/Cargo was not found.
  echo Run: winget install --id Rustlang.Rustup
  echo Then restart PowerShell and run: rustup default stable-msvc
  pause
  exit /b 1
)

call npm ci
if errorlevel 1 goto :error

call npm run desktop:portable
if errorlevel 1 goto :error

echo.
echo SUCCESS. The single portable EXE is in the portable folder.
echo You can send that EXE to the tester without any other project files.
start "" "%~dp0portable"
pause
exit /b 0

:error
echo.
echo BUILD FAILED. Read the error above.
echo Make sure Visual Studio Build Tools with Desktop development with C++ is installed.
pause
exit /b 1
