#requires -Version 5.1
# 同事在 C:\Users\Administrator\GIGAB2B 目录下跑这个脚本
# 直接以管理员权限:
#   powershell -ExecutionPolicy Bypass -File .\scripts\diag_minimax.ps1
# 不需要任何参数

$ErrorActionPreference = "Continue"

Write-Host "===== 1. 读 .env 里 MINIMAX_API_KEY =====" -ForegroundColor Cyan
$match = Select-String -Path ".\.env" -Pattern '^MINIMAX_API_KEY='
if (-not $match) {
    Write-Host "!! .env 里没找到 MINIMAX_API_KEY 行" -ForegroundColor Red
    return
}

$raw = $match.ToString()
Write-Host "原始行长度: $($raw.Length)"
Write-Host "原始行: [$raw]"

$key = $raw.Split('=', 2)[1]
Write-Host "Key 长度: $($key.Length)"
Write-Host "Key 前 30: [$($key.Substring(0,[Math]::Min(30,$key.Length)))]"
Write-Host "Key 后 30: [$($key.Substring([Math]::Max(0,$key.Length-30)))]"

# 检查引号 / 不可见字符
$hasQuote   = $key.Contains('"') -or $key.Contains("'")
$hasSpace   = $key.Contains(' ') -or $key.Contains("`t")
$hasNewline = $key.Contains("`n") -or $key.Contains("`r")
Write-Host "含引号: $hasQuote   含空格/Tab: $hasSpace   含换行: $hasNewline"

# 把 Key 每个字符的码点打出来
Write-Host "----- Key 字符码点 -----" -ForegroundColor Yellow
$codes = ($key.ToCharArray() | ForEach-Object { [int]$_ }) -join ","
Write-Host $codes

Write-Host ""
Write-Host "===== 2. 直接 curl MiniMax =====" -ForegroundColor Cyan

$body = @{
    model = "MiniMax-M3"
    messages = @(@{role="user"; content="ping"})
    max_tokens = 16
} | ConvertTo-Json -Depth 5

$headers = @{
    "Authorization" = "Bearer $key"
    "Content-Type"  = "application/json"
}

# PowerShell 5.1 写法:不用 -SkipHttpErrorCheck,改用 try/catch
try {
    $resp = Invoke-WebRequest -Method Post `
        -Uri 'https://api.minimaxi.com/v1/chat/completions' `
        -Headers $headers `
        -Body $body `
        -ContentType 'application/json' `
        -TimeoutSec 20
    Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Green
    Write-Host $resp.Content
} catch {
    # 5.1 里 4xx/5xx 会进 catch
    $resp = $_.Exception.Response
    if ($resp) {
        $status = [int]$resp.StatusCode
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
        Write-Host "HTTP $status" -ForegroundColor Red
        Write-Host $bodyText
    } else {
        Write-Host "调用失败: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "===== 3. 看 Flask 进程用的 Key(从 /api/server-status 反推) =====" -ForegroundColor Cyan
Write-Host "(如果 Flask 没启动,这段会报错,忽略)"
try {
    $status = Invoke-RestMethod -Uri 'http://localhost:5182/api/server-status' -TimeoutSec 5
    $status | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Flask 没启 / 不可达: $($_.Exception.Message)" -ForegroundColor Yellow
}