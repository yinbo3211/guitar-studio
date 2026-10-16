# ============================================================
# 六弦工坊 · AI 吉他练习室 - 本地静态服务器
# 仅供本机/局域网练习使用，零依赖，Win10 自带 PowerShell 即可运行
# ============================================================
$ErrorActionPreference = 'Stop'
$Port = 8765
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Entry = 'guitar-studio.html'

$Mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.webm' = 'audio/webm'
    '.mp4'  = 'audio/mp4'
    '.wav'  = 'audio/wav'
    '.md'   = 'text/plain; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$bindAll = $false
try {
    $listener.Prefixes.Add("http://+:$Port/")
    $listener.Start()
    $bindAll = $true
} catch {
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$Port/")
        $listener.Start()
        $bindAll = $false
        Write-Host "[提示] 仅本机模式启动（局域网手机访问需管理员权限，将自动申请）" -ForegroundColor Yellow
    } catch {
        Write-Host "[错误] 端口 $Port 被占用，请关闭占用程序后重试，或修改本脚本顶部的 Port" -ForegroundColor Red
        Read-Host '按回车键退出'
        exit 1
    }
}

# 本机模式下尝试申请局域网访问权限（会弹一次 UAC）
if (-not $bindAll) {
    $wantLan = Read-Host '是否允许同一 WiFi 下的手机访问？(Y=是，其他键=仅本机使用)'
    if ($wantLan -eq 'Y' -or $wantLan -eq 'y') {
        try {
            $arg = "http add urlacl url=http://+:$Port/ user=Everyone"
            Start-Process -FilePath 'netsh' -ArgumentList $arg -Verb RunAs -Wait | Out-Null
            $listener.Stop(); $listener.Close()
            $listener = New-Object System.Net.HttpListener
            $listener.Prefixes.Add("http://+:$Port/")
            $listener.Start()
            $bindAll = $true
            Write-Host '[成功] 局域网访问已开启' -ForegroundColor Green
        } catch {
            Write-Host '[提示] 未获得授权，继续仅本机模式' -ForegroundColor Yellow
        }
    }
}

Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
Write-Host '  六弦工坊 · AI 吉他练习室 已启动' -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ("  本机地址 : http://localhost:{0}/{1}" -f $Port, $Entry)
if ($bindAll) {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -ExpandProperty IPAddress
    foreach ($ip in $ips) {
        Write-Host ("  手机访问 : http://{0}:{1}/{2}  （手机与电脑连同一 WiFi）" -f $ip, $Port, $Entry) -ForegroundColor Green
    }
    Write-Host '  注意：局域网 HTTP 下手机浏览器会限制麦克风，手机端调音/闯关请使用 GitHub Pages 的 HTTPS 地址' -ForegroundColor Yellow
}
Write-Host '  关闭本窗口即可停止服务'
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

Start-Process 'msedge' "http://localhost:$Port/$Entry" | Out-Null

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch { break }
    try {
        $raw = $ctx.Request.Url.AbsolutePath
        $rel = [System.Uri]::UnescapeDataString($raw.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = $Entry }
        $path = Join-Path $Root ($rel -replace '/', '\')
        $fullRoot = (Resolve-Path $Root).Path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'not found' }
        $fullPath = (Resolve-Path -LiteralPath $path).Path
        if (-not $fullPath.StartsWith($fullRoot)) { throw 'forbidden' }
        $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
        $leaf = [System.IO.Path]::GetFileName($fullPath)
        # 安全：后端源码 / 配置（含密码与 DDNS 凭证）/ 部署脚本一律不对外提供
        $denyExt = @('.sh','.ps1','.bat','.service','.conf','.template','.log','.bak','.json','.md')
        if ($denyExt -contains $ext -or $leaf -eq 'server.js') { throw 'not found' }
        if ($Mime.ContainsKey($ext)) { $ctx.Response.ContentType = $Mime[$ext] }
        else { $ctx.Response.ContentType = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.AddHeader('Cache-Control', 'no-cache')
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.OutputStream.Close()
        Write-Host ("[200] {0}" -f $rel) -ForegroundColor DarkGray
    } catch {
        $ctx.Response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $ctx.Response.ContentLength64 = $msg.Length
        $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
        $ctx.Response.OutputStream.Close()
        Write-Host ("[404] {0}" -f $rel) -ForegroundColor DarkRed
    }
}
