# GIGAB2B 启动说明(给同事)

> 跟着做 5 分钟就能跑起来。遇到问题先看底部「踩坑」。

---

## 1. 装环境(只做一次)

| 工具 | 版本 | 下载 | 安装要点 |
|---|---|---|---|
| Python | 3.11+ | https://python.org | 安装时**勾选 "Add python.exe to PATH"** |
| Node.js | 18.18+ LTS | https://nodejs.org | 装 LTS 版,所有勾保持默认 |
| Git for Windows | 任意 | https://git-scm.com/download/win | 一路 Next,所有勾保持默认 |

装好后在 **新开的 PowerShell 窗口**里验证(装完必须关掉旧窗口,新开一个,否则 PATH 不生效):
```powershell
git --version; python --version; node --version; npm --version
```

四个都能输出版本号 = 装好了。

---

## 2. 拉代码

```powershell
git clone <仓库地址> GIGAB2B
cd GIGAB2B
```

---

## 3. 填 API Key

**⚠️ .env 不能用微信/QQ/邮件附件直接发,聊天工具会把 NUL 字符变成 `?` 污染 Key!**

**正确的获取方式(任选一种):**

### 方式 A:用 base64 字符串分发(最稳,100% 不污染)

项目所有者在本机跑:
```powershell
$base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(".env"))
$half = [Math]::Ceiling($base64.Length / 2)
Write-Host "===PART1==="
Write-Host $base64.Substring(0, $half)
Write-Host "===PART2==="
Write-Host $base64.Substring($half)
```
**把 PART1 和 PART2 分两条消息发给你**(不要拼一起发,IM 工具会截断长字符串)。

你这边:
```powershell
$part1 = "粘贴 PART1"
$part2 = "粘贴 PART2"
$base64 = $part1 + $part2
Write-Host "Base64 length: $($base64.Length)"  # 应该是 2984
[System.IO.File]::WriteAllBytes(".\.env", [Convert]::FromBase64String($base64))
python -c "d=open('.env','rb').read(); print('size:', len(d), 'NUL:', d.count(b'\x00'))"
# 期望:size: 2236, NUL: 0
```

### 方式 B:用 GitHub Secrets / 内部网盘(避免聊天工具污染)
把 .env 传到不会被聊天工具压缩/转码的渠道,下载后**必须验证 NUL 字符数为 0**。

### 方式 C:从你最初拿到 Key 的渠道(老板/同事/企业平台)重新拿 7 个 Key,自己用 PowerShell 拼

```powershell
copy .env.example .env
# 用记事本把 7 个 Key 粘到对应位置,Ctrl+A 全选,Delete 清空,再粘,Ctrl+S
# ⚠️ 记事本可能污染 Key,粘完后验证:
python -c "d=open('.env','rb').read(); print('size:', len(d), 'NUL:', d.count(b'\x00'))"
# 期望:NUL: 0
```

---

**Key 填好后,保存关闭即可。这个文件不要发给别人、不要 commit。**

---

## 4. 一键启动

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会自动:
- 检查 Python 依赖(缺则 `pip install`)
- 检查前端依赖(缺则 `npm install`)
- 启动后端 Flask(`http://localhost:5182`)
- 启动前端 Vite(`http://localhost:5173`)

启动成功后浏览器打开 **http://localhost:5173** 即可使用。

> 首次启动装依赖需要 2-5 分钟,中途别关窗口。

---

## 5. 关闭服务

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_all.ps1
```

---

## 踩坑速查

### 端口被占用 (`Address already in use: 5182` / `5173`)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_all.ps1
```
杀不干净就重启电脑。

### GIGA 接口报 `10053` / `Connection aborted`
Windows 上常见。**关掉 Clash、V2Ray、杀毒软件**再重试。

### `.env` 找不到
`.env` 已被 `.gitignore` 排除,clone 之后**不会自动生成**。按第 3 步手动复制。

### .env 里有 Key 但 Flask 读出来是空
**最常见原因:Key 字符串里有 NUL 字符(`\0`,记事本/GPT/聊天工具复制时常混入),Python 读环境变量时遇到 NUL 就截断。**
**诊断:**
```powershell
# 看 .env 里有没有 NUL 字符(应该返回 Count = 0)
[System.IO.File]::ReadAllBytes(".\.env") | Where-Object { $_ -eq 0 } | Measure-Object | Select Count

# 看 .env 里 Key 行有没有被换行拆开
Get-Content .\.env | Select-String "^MINIMAX_API_KEY="
# 期望:1 行,长度 50-80
# 异常:2 行(说明被换行符拆开了)或有 `?` `\` 字符
```
**修法:** 从最初拿 Key 的渠道(老板/同事/企业平台)**重新拿一个干净的 Key**,确保没有 `?` `\` 等乱码。然后用 PowerShell 重写:
```powershell
powershell -ExecutionPolicy Bypass -File .\stop_all.ps1
(Get-Content .\.env) | Where-Object { $_ -notmatch "^MINIMAX_API_KEY=" } | Set-Content -Encoding utf8 .\.env -Force
"MINIMAX_API_KEY=sk-你的干净Key" | Add-Content -Encoding utf8 .\.env
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

### 用 PowerShell 重写 .env 后 Flask 还是读不到某个 Key
**最常见原因:粘贴 PowerShell 命令时,`$minimaxKey = "..."` 那行没复制进去**,导致变量是空字符串,写入 .env 后那一行变成 `MINIMAX_API_KEY=`(值为空)。
**验证:**
```powershell
Get-Content .\.env | Select-String "^(MINIMAX|LAOZHANG)_API_KEY="
# 期望返回 2 行,如果有 1 行就是缺哪个 Key
```
**修法:** 找到 `MINIMAX_API_KEY=` 那行,在记事本里手动把 Key 粘到 `=` 后面(用 `setx` 设环境变量也行,见下面条目)。

### 某个 API Key 单独读不到(其他都 OK)
**最常见原因:.env 里这一行被记事本污染了 NUL/零宽字符**,`os.getenv()` 读到 NUL 就截断,Key 变空。
**验证 Key 是否被污染:**
```powershell
[System.Environment]::GetEnvironmentVariable("MINIMAX_API_KEY", "User").Length
# 期望 50+ 字符,如果只有 10-20 说明被 NUL 截断了
```
**修法:从你最初拿到 Key 的渠道(老板/同事/企业平台)重新复制 MINIMAX_API_KEY 的值**,确认是干净 ASCII 字符(不含 `?` `\` 之类乱码),重新填到 .env 或设到环境变量。

**如果环境变量已设且长度正常但 Flask 仍报未配置:** `python-dotenv` 默认 `override=True`,会覆盖系统环境变量。从 `.env` 里删掉对应行:
```powershell
powershell -ExecutionPolicy Bypass -File .\stop_all.ps1
(Get-Content .\.env) | Where-Object { $_ -notmatch "^MINIMAX_API_KEY=" } | Set-Content -Encoding utf8 .\.env -Force
# 重开 PowerShell 窗口(让 User 环境变量在当前进程生效)
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

### 改完 .env 各种姿势都试了,Key 一直读不到
**不要用记事本编辑 .env!** 记事本会留下 NUL/零宽字符污染 Key,显示成 `?` 让你看不出。
**用 PowerShell 直接重写干净的 .env(UTF-8 无 BOM):**
```powershell
powershell -ExecutionPolicy Bypass -File .\stop_all.ps1
Copy-Item .\.env .\.env.bak -Force   # 备份旧的
# 在下面 7 个 Key 的位置替换成你的真实值
$envContent = @"
GIGA_US_CLIENT_ID=<填你的>
GIGA_US_CLIENT_SECRET=<填你的>
GIGA_DE_TAX_CLIENT_ID=<填你的>
GIGA_DE_TAX_CLIENT_SECRET=<填你的>
GIGA_DE_TAXFREE_CLIENT_ID=<填你的>
GIGA_DE_TAXFREE_CLIENT_SECRET=<填你的>
GIGA_UK_CLIENT_ID=<填你的>
GIGA_UK_CLIENT_SECRET=<填你的>
GIGA_FR_CLIENT_ID=<填你的>
GIGA_FR_CLIENT_SECRET=<填你的>
GIGA_ENV=production
MINIMAX_API_KEY=<填你的>
LAOZHANG_API_KEY=<填你的>
MINIMAX_API_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M3
LAOZHANG_API_URL=https://api.laozhang.ai/v1
LAOZHANG_IMAGE_MODEL=gemini-3.1-flash-image-preview
"@
[System.IO.File]::WriteAllText("$PWD\.env", $envContent, [System.Text.UTF8Encoding]::new($false))
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

### Key 存在但界面报「未配置」(某个 API Key 单独失败)
**最常见原因:把 Key 写到了带 `#` 注释的模板行上**(如 `# MINIMAX_API_KEY=`)。注释行整行被忽略,Key 等于没填。
**验证:**
```powershell
Get-Content .\.env | Select-String "^(MINIMAX|LAOZHANG)_API_KEY=" | Measure-Object
# 期望返回 Count = 2(没结果就是写在注释行了)
```
**修法:** 记事本打开 `.env`,**找到不带 `#` 那一行**写 Key,或者直接用 PowerShell:
```powershell
$realKey = "sk-..."  # 你的真实 Key
(Get-Content .\.env | Where-Object { $_ -notmatch "^#\s*MINIMAX_API_KEY=" }) +
"MINIMAX_API_KEY=$realKey" | Set-Content .\.env -Encoding utf8 -Force
```

> 其他原因:从网页/聊天工具复制的 Key 带了行尾空格/全角空格/引号等不可见字符。记事本打开 .env,光标点到 `=` 后按 End 跳到行尾,Backspace 删光多余字符。
>
> **重要:** Flask 启动时只读一次 `.env`,改 .env 后必须 `stop_all.ps1` → `start.ps1` 才生效。

### 填了 `.env` 但界面还显示「无凭证」/ 启动时 `GIGA creds: missing (.env)`
**最常见原因:旧的 Flask 进程还在占着 5182 端口,新启动的 Flask 没生效,浏览器还连着旧进程。**
**修法:用 stop 脚本彻底杀干净再启动**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_all.ps1
powershell -ExecutionPolicy Bypass -File .\start.ps1
```
**如果还不行,逐步排查:**
```powershell
# 1. 文件是否存在
Test-Path .\.env    # 必须 True(注意是 .\.env,不是 env)

# 2. 文件大小(应该 > 1000 字节,空文件大小是 0)
(Get-Item .\.env).Length

# 3. 是否有真正的 Key 行(应该返回 10 行:5 个市场 × ID+SECRET)
Get-Content .\.env | Select-String "^GIGA_"
```
- **Test-Path False** → 文件名错乱,见下面"重建 .env"
- **Length 是 0** → 文件是空的,记事本打开重新填 7 个 Key
- **Select-String 返回 0 行** → 文件里只有注释没有 Key,记事本打开 Ctrl+A 清空,重新粘贴 7 个 Key(注意 Key 不要写到 .env.example.example 这种错乱的文件名里)

**重建 .env:**
```powershell
notepad .env       # 打开
# Ctrl+A 全选 → Delete 清空 → 粘贴 7 个 Key → Ctrl+S 保存 → 关闭记事本
# 验证
Get-Content .\.env | Select-String "^GIGA_"   # 看到 10 行 GIGA_xxx=xxx 才是正确的
```

### AI 文案生成失败 / 内容为空
1. 检查 `.env` 里 `MINIMAX_API_KEY` 没填错
2. 去 MiniMax 后台看额度余额
3. 看项目根目录 `.logs/ai_response_*.txt` 里的 AI 原始报错

### AI 生图失败
1. 检查 `LAOZHANG_API_KEY`
2. 看 `.logs/` 里的报错

### 前端启动失败 / 白屏
```powershell
cd web
npm install
cd ..
```
重新装前端依赖,再跑第 4 步。

### PowerShell 报「无法加载文件,因为在此系统上禁止运行脚本」
必须用第 4 步带 `-ExecutionPolicy Bypass` 的写法,不要直接双击 `.ps1` 文件。

### PowerShell 报「字符串缺少终止符」/「ParserError: TerminatorExpectedAtEndOfString」
文件编码问题(`start.ps1` 在某些 PowerShell 版本下读 UTF-8 缺 BOM 会报语法错)。
**修法:** 用记事本打开 `start.ps1` → 另存为 → 编码选 **"UTF-8 with BOM"** → 保存覆盖,再重跑启动命令。

---

## 联系

用出问题截图 + `.logs/` 里的最新日志,直接发给项目所有者。
