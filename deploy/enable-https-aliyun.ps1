# ============================================================
# 六弦工坊 · Windows 阿里云域名 HTTPS 一键启用（Posh-ACME）
# 前置条件：
#   1) 已用 start-hosting.bat / deploy-windows.ps1 完成基础部署
#   2) 已有阿里云域名，DNS 托管在阿里云云解析
#   3) 已创建阿里云 RAM 子账号 AccessKey（仅需 AliyunDNSFullOnly 权限）
# 用法（管理员 PowerShell）：
#   .\enable-https-aliyun.ps1 -Domain guitar.example.com `
#                             -AliKeyId <AccessKeyId> -AliSecret <AccessKeySecret>
# 效果：
#   · Posh-ACME 通过阿里云 DNS API 验证签发 Let's Encrypt 证书（无需 80 可达）
#   · 便携 nginx 启用 443 SSL，80 端口 301 跳转
#   · 证书落库 Posh-ACME，续期后重跑本脚本即可更新（脚本内置提示）
# ============================================================
param(
    [Parameter(Mandatory=$true)][string]$Domain,
    [Parameter(Mandatory=$true)][string]$AliKeyId,
    [Parameter(Mandatory=$true)][string]$AliSecret,
    [int]$ApiPort = 3000
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Err($m){ Write-Host $m -ForegroundColor Red }

# ---- 0. 管理员校验 ----
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    Err "请以管理员身份运行本脚本（右键 PowerShell → 以管理员身份运行）"; exit 1
}

# ---- 1. 找到便携 nginx（与 deploy-windows.ps1 同一套路径约定）----
$nginxExe = Get-ChildItem -Path (Join-Path $Root "nginx-bin") -Recurse -Filter nginx.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $nginxExe){ Err "未找到 nginx-bin 下的便携 nginx，请先运行 deploy-windows.ps1"; exit 1 }
$ngPrefix = Split-Path -Parent $nginxExe.FullName

# ---- 2. 安装 / 导入 Posh-ACME ----
if(-not (Get-Module -ListAvailable Posh-ACME)){
    Warn ">> 首次运行，安装 Posh-ACME 模块（约 1 分钟）..."
    Install-Module Posh-ACME -Scope CurrentUser -Force -Repository PSGallery
}
Import-Module Posh-ACME

# ---- 3. 签发 / 读取证书（阿里云 DNS 验证，支持通配符）----
Warn ">> 通过阿里云 DNS 验证签发证书（DNS 传播约 1-3 分钟）..."
$paArgs = @{ AliKeyId = $AliKeyId; AliSecret = $AliSecret }
try {
    $cert = New-PACertificate $Domain -AcceptTOS -Contact "admin@$Domain" `
             -DnsPlugin Aliyun -PluginArgs $paArgs -ErrorAction Stop
} catch [PoshACME.PAException] {
    if($_.Exception.Order.Status -eq 'valid'){ $cert = Get-PACertificate -MainDomain $Domain }
    else { Err "证书签发失败：$($_.Exception.Message)"; Err "请核对 AccessKey（需 AliyunDNSFullOnly 权限）与域名 DNS 是否托管在阿里云"; exit 1 }
} catch {
    Err "证书签发失败：$($_.Exception.Message)"; exit 1
}
Ok ">> 证书就绪：$($cert.PFullChainFile)"

# ---- 4. 生成 nginx HTTPS 配置（无 BOM UTF-8，兼容中文路径）----
$tpl = Get-Content (Join-Path $Root "nginx\guitar-studio-https.conf.template") -Raw
$conf = $tpl -replace '__WEBROOT__', ($Root -replace '\\','/')
$conf = $conf -replace '__HTTPPORT__','80' -replace '__APIPORT__',"$ApiPort"
$conf = $conf -replace '__DOMAIN__',$Domain
$conf = $conf -replace '__SSL_CERT__', ($cert.PFullChainFile -replace '\\','/')
$conf = $conf -replace '__SSL_KEY__',  ($cert.PKeyFile -replace '\\','/')

# 无全局 IPv6 时移除 [::] 监听（与 P1-07 同源问题）
$hasV6 = (Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -ne '::1' } |
    Select-Object -First 1)
if(-not $hasV6){
    $conf = $conf -replace '(?m)^\s*listen\s+\[::\]:\d+[^;]*;\s*$', ''
    Warn ">> 未检测到可用 IPv6，已移除 [::] 监听"
}

# 80/443 端口与现有 HTTP 站点冲突：先停旧 nginx
# 便携版 nginx 以 -c 加载完整配置，需将模板（裸 server 块）包进 events/http 块
$fullConf = @"
worker_processes  1;
error_log  logs/error.log;
pid        logs/nginx.pid;
events { worker_connections 1024; }
http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout  65;
$conf
}
"@
$confPath = Join-Path $ngPrefix "conf\guitar-studio-https.conf"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)   # P1-05：无 BOM UTF-8
[System.IO.File]::WriteAllText($confPath, $fullConf, $utf8NoBom)

# ---- 5. 校验并重启 nginx ----
Push-Location $ngPrefix
Start-Process -FilePath $nginxExe.FullName -ArgumentList "-s","stop" -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Start-Process -FilePath $nginxExe.FullName -ArgumentList "-p","`"$ngPrefix`"","-c",(Join-Path "conf" "guitar-studio-https.conf") -WindowStyle Hidden
Pop-Location

# 探测 HTTPS 真实可用（与 P1-06 同源思路）
$up = $false
for($i=0; $i -lt 12; $i++){
    Start-Sleep -Milliseconds 500
    try{
        $r = Invoke-WebRequest -Uri "https://$Domain/app.html" -UseBasicParsing -TimeoutSec 5
        if($r.StatusCode -eq 200){ $up = $true; break }
    }catch{}
}
if(-not $up){
    Warn ">> HTTPS 未就绪（DNS 未生效/证书未下发/443 被占用），稍后可重跑本脚本。"
    Warn ">> 本机可先用 http://localhost:8080/app.html 继续。"
} else {
    Ok ">> HTTPS 已生效：https://$Domain/app.html"
}

# ---- 6. 防火墙放行 443 ----
New-NetFirewallRule -DisplayName "Guitar-Studio-HTTPS-443" -Direction Inbound `
    -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "Guitar-Studio-HTTP-80" -Direction Inbound `
    -Protocol TCP -LocalPort 80 -Action Allow -ErrorAction SilentlyContinue | Out-Null
Ok ">> 防火墙已放行 80/443"

# ---- 7. 完成提示 ----
Ok "================ HTTPS 部署完成 ================"
Write-Host "  外网访问： https://$Domain/app.html"
Write-Host "  后台面板： https://$Domain/admin"
Write-Host ""
Warn "  别忘了 DDNS（域名指向你家的 IPv6），编辑 $Root\config.json："
Warn '    "ddns": { "enabled": true, "provider": "aliyun",'
$parts = $Domain.Split('.'); $sub = $parts[0]; $main = ($parts[1..($parts.Length-1)] -join '.')
Warn "              ""domain"": ""$main"", ""sub"": ""$sub"", ""aliId"": ""..."", ""aliSecret"": ""..."" }"
Warn "  然后重启 Node 后端（结束 node.exe 进程后重跑 start-hosting.bat）。"
Warn "  证书 90 天有效：到期前重跑本脚本即可更新（Posh-ACME 自动复用验证配置）。"
Ok "==============================================="
Read-Host "按回车退出本窗口"
