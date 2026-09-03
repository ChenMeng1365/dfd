@echo off
rem 停止后台运行的 dfd hub: 从 server.log 解析实际端口, 按端口精确终止
powershell -NoProfile -Command "$log = Get-Content '%~dp0server.log' -Raw -Encoding UTF8 -ErrorAction Stop; $m = [regex]::Matches($log, '127\.0\.0\.1:(\d+)') | Select-Object -Last 1; if (-not $m) { Write-Host 'server.log 中未找到端口'; exit 1 }; $port = $m.Groups[1].Value; $conns = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host ('dfd 未在运行 (端口 ' + $port + ' 无监听)'); exit 0 }; $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('已停止 pid ' + $_ + ' (端口 ' + $port + ')') }"
pause
