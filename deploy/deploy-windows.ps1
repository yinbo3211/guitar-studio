# ============================================================
# 六弦工坊 · Windows 10/11 一键部署（Nginx + Node + IPv6 DDNS）
# 用法（管理员 PowerShell）：
#   .\deploy-windows.ps1                         # 默认对外 8080，内部 3000，自动尝试 Nginx
#   .\deploy-windows.ps1 -Port 9000              # 自定义对外端口
#   .\deploy-windows.ps1 -NoNginx                # 不使用 Nginx，Node 直接双栈对外
# 双击「start-hosting.bat」会自动以管理员运行本脚本。
# ============================================================
param(
    [int]$Port = 8080,
    [int]$ApiPort = 3000,
    [switch]$NoNginx,
    [string]$NginxVersion = "1.26.2"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Err($m){ Write-Host $m -ForegroundColor Red }

# ---- 管理员权限（防火墙、监听端口需要）----
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    Err "请以管理员身份运行：右键「start-hosting.bat」→ 以管理员身份运行"
    Read-Host "按回车退出"; exit 1
}

Write-Host "==== 六弦工坊 · 外网托管部署（Windows）====" -ForegroundColor Cyan
Write-Host "项目目录：$Root"

# ---- 1. 检测 Node ----
$node = (Get-Command node -ErrorAction SilentlyContinue)
if(-not $node){
    Warn "未检测到 Node.js，尝试用 winget 安装 ..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if($winget){
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if(-not $node){
        Err "Node.js 自动安装失败，请先到 https://nodejs.org 安装 LTS 版后重试。"
        Read-Host "按回车退出"; exit 1
    }
}
Ok ">> Node：$(node -v)"

# ---- 2. 停止旧实例 ----
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*$Root*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# ---- 3. 探测/准备 Nginx ----
$nginxExe = $null
if(-not $NoNginx){
    $existing = Get-Command nginx -ErrorAction SilentlyContinue
    if($existing){ $nginxExe = $existing.Source }
    else {
        $local = Get-ChildItem -Path (Join-Path $Root "nginx-bin") -Recurse -Filter nginx.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if($local){ $nginxExe = $local.FullName }
    }
    # 自动下载便携版 Nginx
    if(-not $nginxExe){
        $binDir = Join-Path $Root "nginx-bin"
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
        $zip = Join-Path $binDir "nginx.zip"
        $url = "https://nginx.org/download/nginx-$NginxVersion.zip"
        Warn ">> 未找到 Nginx，尝试下载便携版 $url ..."
        try{
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 60
            Expand-Archive -Path $zip -DestinationPath $binDir -Force
            Remove-Item $zip -Force
            $local = Get-ChildItem -Path $binDir -Recurse -Filter nginx.exe | Select-Object -First 1
            if($local){ $nginxExe = $local.FullName }
        }catch{
            Warn ">> Nginx 下载失败（可能是网络问题），将改用 Node 直接对外，功能不受影响。"
        }
    }
}

# ---- 4. 写 config.json ----
$webRootJs = $Root.Replace('\','/')
if($nginxExe){
    $bind = "127.0.0.1"; $listenPort = $ApiPort
    Ok ">> 模式：Nginx 容器托管（静态由 Nginx，API 反代 Node）"
}else{
    $bind = "::"; $listenPort = $Port
    Ok ">> 模式：Node 直接双栈对外（IPv6+IPv4）"
}
$nodeScript = @"
const fs=require('fs'),path=require('path');
const root=process.cwd();
const p=path.join(root,'config.json');
let c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8'));
c.webPort=$listenPort; c.bindHost='$bind';
fs.writeFileSync(p,JSON.stringify(c,null,2));
console.log('config.json ready: '+c.bindHost+':'+c.webPort);
"@
$nodeScript | node -
if($LASTEXITCODE -ne 0){ Err "config.json 写入失败"; exit 1 }

# ---- 5. 启动 Node 后端（最小化窗口，保留日志）----
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $Root -WindowStyle Minimized
Ok ">> Node 后端已启动（$bind`:$listenPort）"

# ---- 6. 配置并启动 Nginx ----
if($nginxExe){
    $ngDir = Split-Path -Parent $nginxExe
    # Nginx prefix 必须是 nginx.exe 所在目录（其下才有 conf/、html/、logs/），
    # 便携版解压后形如 nginx-bin/nginx-1.26.2/，不能再取上一级。
    $ngPrefix = $ngDir
    # 从模板生成 server 块
    $tpl = Get-Content (Join-Path $Root "nginx\guitar-studio.conf.template") -Raw
    # 只取第一个 server { ... } 块（忽略底部 HTTPS 注释示例）
    $serverBlock = [regex]::Match($tpl, "(?s)server\s*\{.*?\n\}", [Text.RegularExpressions.RegexOptions]::Singleline).Value
    $serverBlock = $serverBlock -replace '__WEBROOT__', $webRootJs -replace '__PORT__', "$Port" -replace '__APIPORT__', "$ApiPort"
    $conf = @"
worker_processes auto;
events { worker_connections 1024; }
http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;
    $serverBlock
}
"@
    # 确保便携版存在 mime.types
    $confDir = Join-Path $ngPrefix "conf"
    $confPath = Join-Path $confDir "guitar-studio.conf"
    # P1-07 修复：无 IPv6 环境（内核禁用/虚拟机未开启）下 listen [::] 会导致
    # nginx 报 socket() failed (97: Address family not supported) 并退出。
    $hasV6 = (Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -ne '::1' } |
        Select-Object -First 1)
    if(-not $hasV6){
        $conf = $conf -replace '(?m)^\s*listen\s+\[::\]:\d+;.*$', ''
        Warn ">> 未检测到可用 IPv6，已移除 [::] 监听"
    }
    # P1-05 修复：-Encoding ascii 会把中文路径（root 行）写成乱码字节，
    # 导致 nginx 找不到站点目录、全站 404/403。改用无 BOM 的 UTF-8。
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($confPath, $conf, $utf8NoBom)
    # 停止旧 nginx 再启动
    Push-Location $ngPrefix
    Start-Process -FilePath $nginxExe -ArgumentList "-s","stop" -WindowStyle Hidden -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Start-Process -FilePath $nginxExe -ArgumentList "-p","`"$ngPrefix`"","-c","conf/guitar-studio.conf" -WindowStyle Hidden
    Pop-Location
    # P1-06 修复：启动 nginx 后探测真实响应，失败自动回退 Node 直连，
    # 不再无条件打印「部署完成」。
    $up = $false
    for($i=0; $i -lt 12; $i++){
        Start-Sleep -Milliseconds 500
        try{
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/app.html" -UseBasicParsing -TimeoutSec 3
            if($r.StatusCode -eq 200){ $up = $true; break }
        }catch{}
    }
    if(-not $up){
        Warn ">> Nginx 未能对外提供服务（端口占用/配置错误），自动回退 Node 直连模式"
        Start-Process -FilePath $nginxExe -ArgumentList "-s","stop" -WindowStyle Hidden -ErrorAction SilentlyContinue
        # 改写 config.json 为双栈直连后重启 Node
        $fallbackScript = @"
const fs=require('fs'),path=require('path');
const root=process.cwd();
const p=path.join(root,'config.json');
let c=JSON.parse(fs.readFileSync(p,'utf8'));
c.webPort=$Port; c.bindHost='::';
fs.writeFileSync(p,JSON.stringify(c,null,2));
console.log('config.json fallback: ::'+'$Port');
"@
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*$Root*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $fallbackScript | node -
        Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $Root -WindowStyle Minimized
        Ok ">> 已回退：Node 直接双栈对外（IPv6+IPv4），端口 $Port"
    } else {
        Ok ">> Nginx 已启动，对外端口 $Port"
    }
}

# ---- 7. 防火墙放行 ----
$rule = "Guitar-Studio-$Port"
netsh advfirewall firewall delete rule name="$rule" | Out-Null
netsh advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=$Port | Out-Null
Ok ">> 已放行 Windows 防火墙入站 TCP $Port"

# ---- 8. 输出访问地址 ----
$v6 = (Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -notlike 'f*' -and $_.IPAddress -ne '::1' } |
    Select-Object -First 1).IPAddress
$v4 = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress
Write-Host ""
Ok "================ 部署完成 ================"
Write-Host "  本机访问： http://localhost:$Port/app.html"
if($v4){ Write-Host "  局域网：   http://$v4`:$Port/app.html" }
if($v6){ Write-Host "  外网 IPv6：http://[$v6]:$Port/app.html" }
Write-Host "  后台面板： http://localhost:$Port/admin"
Write-Host ""
Warn "  还需在路由器/光猫放行 IPv6 入站 TCP $Port。"
Warn "  外网手机麦克风需 HTTPS：域名接入 Cloudflare 橙云或配置证书。"
Warn "  停止服务：任务管理器结束 node.exe（及 nginx.exe），或运行：nginx -s stop"
Ok "=========================================="
Write-Host ""
Read-Host "按回车退出本窗口（服务会在后台继续运行）"
