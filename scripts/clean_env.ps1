#requires -Version 5.1
<#
.SYNOPSIS
  把 .env 里的所有 KEY=VAL 行清洗成"严格无引号、UTF-8 无 BOM、首尾无空白"。
  适用于:
    - 修复 .env 里的 NUL/零宽字符污染
    - 去掉中文 IM 工具复制时混入的双引号
    - 统一换行符为 LF
  执行:  powershell -ExecutionPolicy Bypass -File .\scripts\clean_env.ps1
#>

$ErrorActionPreference = "Stop"
$envPath = Join-Path (Get-Location) ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "!! 当前目录没有 .env" -ForegroundColor Red
    exit 1
}

# 1) 备份
$bakPath = "$envPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $envPath $bakPath -Force
Write-Host "已备份到: $bakPath" -ForegroundColor Cyan

# 2) 逐行读,清洗
$cleanLines = New-Object System.Collections.Generic.List[string]
foreach ($raw in [System.IO.File]::ReadAllLines($envPath, [System.Text.Encoding]::UTF8)) {
    $line = $raw

    # 跳过空行 / 注释行
    if ([string]::IsNullOrWhiteSpace($line)) { $cleanLines.Add(""); continue }
    if ($line.TrimStart().StartsWith("#"))  { $cleanLines.Add($line); continue }
    if ($line -notmatch "=")                { $cleanLines.Add($line); continue }

    # 分割 KEY=VAL
    $idx = $line.IndexOf("=")
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1)

    # 去 UTF-8 BOM(防御性)
    $val = $val.TrimStart([char]0xFEFF)

    # 去首尾空白(包括零宽空白 U+200B / U+FEFF)
    $val = $val -replace '^[\s​‌‍﻿]+', ''
    $val = $val -replace '[\s​‌‍﻿]+$', ''

    # 去成对引号("..." 或 '...')
    if ($val.Length -ge 2) {
        $first = $val[0]; $last = $val[$val.Length - 1]
        if (($first -eq '"' -and $last -eq '"') -or
            ($first -eq "'" -and $last -eq "'")) {
            $val = $val.Substring(1, $val.Length - 2)
            # 引号内部可能还有空白,再 trim 一次
            $val = $val.Trim()
        }
    }

    $cleanLines.Add("$key=$val")
}

# 3) 用 UTF-8(无 BOM)重写
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($envPath, $cleanLines, $utf8NoBom)
Write-Host "已重写 $envPath,共 $($cleanLines.Count) 行(UTF-8 无 BOM)" -ForegroundColor Green

# 4) 验证:大小 / NUL / 行数
$size = (Get-Item $envPath).Length
$nulCount = ([System.IO.File]::ReadAllBytes($envPath) | Where-Object { $_ -eq 0 }).Count
Write-Host "文件大小: $size 字节, NUL 字符: $nulCount" -ForegroundColor Yellow
Write-Host "预期:本项目 NUL = 0"