@echo off
chcp 65001 >nul
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 exit /b
cd /d "C:\Users\luansha\Desktop\大众包实时出勤\web"
start "" /min "C:\Users\luansha\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\luansha\Desktop\大众包实时出勤\web\server.js"
