# GIGAB2B Listing Optimizer

**GIGA B2B → AI Listing 优化 → Amazon 模板填表** 全链路工具。

通过 GIGA B2B OpenAPI 拉取产品数据,调用 AI 生成多语言 Listing 文案(DE/EN/FR),自动填入 Amazon Bulk Upload 模板(`.xlsm`),并支持基于 GIGA 原图生成主图/详情图。

---

## ✨ 功能

- 🛒 GIGA B2B 产品详情拉取(5 个 Amazon 市场:DE 含税/免税、UK、US、FR)
- 🤖 AI 文案生成:标题、五点描述、产品描述、Search Terms(支持 reasoning 模型)
- 📊 Excel 模板填表:Amazon Bulk Upload `.xlsm` 格式,保留 VBA 宏
- 🎨 AI 图片生成:主图 + 详情图,锁定产品 IDENTITY 不变形
- 📡 SSE 流式进度:每步状态实时推送

---

## 🛠️ 环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| **Python** | 3.11+ | [下载](https://python.org),安装时勾选 "Add to PATH" |
| **Node.js** | 20+ | [下载 LTS](https://nodejs.org) |
| **Git for Windows** | 任意 | 自带 bash / curl,推荐用 Git Bash 运行命令 |

---

## 🚀 快速开始(3 分钟)

```powershell
# 1. 克隆仓库
git clone <仓库地址> GIGAB2B
cd GIGAB2B

# 2. 配置 API Key(向仓库所有者索要密码,另一个渠道发)
notepad .env
# 填入 5 组 GIGA ID/Secret 和 2 个 AI Key；需要恢复 Web 登录时再启用认证并设置访问密码
# 参考 .env.example 模板

# 3. 装 Python 依赖
pip install -r requirements.txt

# 4. 装前端依赖
cd web
npm install
cd ..

# 5. 启动
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

启动成功后浏览器打开 **http://localhost:5173** 即可使用。

---

## 📋 配置文件 `.env`

从 `.env.example` 复制,需要填写以下 Key:

| Key | 来源 |
|---|---|
| `GIGA_<MARKET>_CLIENT_ID` | GIGA B2B 平台 → 开发者中心 |
| `GIGA_<MARKET>_CLIENT_SECRET` | 同上 |
| `LAOZHANG_API_KEY` | laozhang.ai |
| `MINIMAX_API_KEY` | MiniMax 平台 |
| `GIGAB2B_AUTH_ENABLED` | `1` 时启用 Web 登录；开发阶段默认 `0`（绕过登录） |
| `GIGAB2B_ACCESS_PASSWORD` | 启用 Web 登录后使用的密码，建议至少 20 位随机字符 |

5 个市场变量:`GIGA_US_CLIENT_ID`、`GIGA_DE_TAX_CLIENT_ID`、`GIGA_DE_TAXFREE_CLIENT_ID`、`GIGA_UK_CLIENT_ID`、`GIGA_FR_CLIENT_ID`(每个都配 `_SECRET`)。

`.env` 已被 `.gitignore` 排除,**绝不会被 commit 到仓库**。

---

## 🏃 启动方式

### 一键启动(推荐)

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

`start.ps1` 自动做这些事:
1. 检查端口 5182(Flask)和 5173(Vite)是否被占用
2. 检查 Python 依赖,缺失则用 `requirements.txt` 安装
3. 检查前端 `node_modules`,缺失则 `npm install`
4. 后台启动 Flask + Vite
5. 等端口就绪,做 health check

后端默认只监听 `127.0.0.1`。开发阶段默认绕过登录；后续需要恢复访问保护时，在 `.env` 将 `GIGAB2B_AUTH_ENABLED=1`，并设置固定强密码 `GIGAB2B_ACCESS_PASSWORD`。

### 手动启动(开发用)

```bash
# 终端 1 - Flask 后端
python app.py
# → http://localhost:5182

# 终端 2 - Vite 前端
cd web
npm run dev
# → http://localhost:5173
```

### 关闭所有服务

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_all.ps1
```

---

## 🏗️ 项目结构

```
GIGAB2B/
├── app.py                          # Flask 后端(单文件,~1600 行)
├── giga_config.py                  # GIGA 多市场凭证
├── requirements.txt                # Python 依赖
├── .env / .env.example             # 环境变量
├── start.ps1                       # PowerShell 一键启动
├── scripts/
│   └── stop_all.ps1                # 关闭所有服务
├── PLANTER-{de,uk,us,fr}.xlsm      # Amazon Bulk Upload 模板
├── outputs/                        # AI 生成图片(自动生成,不入库)
├── .logs/                          # AI 调试快照(自动生成,不入库)
├── __pycache__/                    # Python 缓存(自动生成,不入库)
├── web/                            # React + Vite 前端
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx                # 入口
│       ├── App.tsx                 # 主组件(三栏布局)
│       ├── api.ts                  # API 客户端 + SSE
│       ├── types.ts                # TS 类型
│       ├── ErrorBoundary.tsx       # 顶层错误边界
│       └── components/             # 7 个 UI 组件
└── docs/                           # GIGA API 文档
```

---

## 🧩 Amazon 模板填表 MVP

独立页面：`http://localhost:5173/template-filler.html`

1. 在 Seller Central 模板的 SKU 列填入 GIGA Item code；
2. 上传 `.xlsx` / `.xlsm`；
3. 页面识别站点、类目、数据行、严格必填、条件必填和下拉字段；
4. 调用 GIGA 批量 API，只填写空白单元格；
5. 下载填写后的模板和 JSON 缺失报告。

当前优先验证 UK CABINET 与 UK CHAIR。MVP 不调用 AI、不自动新增变体、不覆盖人工值，也不会把 GIGA 时效图片 URL 写入 Amazon 模板。现有 PLANTER 流水线仍保持原行为。

---

## 🌐 API 路由

| 路由 | 方法 | 功能 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/server-status` | GET | 详细状态(provider 配置 + 各市场凭证) |
| `/api/markets` | GET | 列出 5 个市场 |
| `/api/detect-market` | POST | 从 SKU/模板自动检测市场 |
| `/api/upload-template` | POST | 验证并隔离存储 Amazon 模板 |
| `/api/template-filler/analyze` | POST | 解析 Amazon 模板、SKU、必填和下拉规则 |
| `/api/template-filler/fill` | POST | 批量抓取 GIGA 数据并生成填写后的模板与报告 |
| `/api/template-filler/reports/<file>` | GET | 登录后下载 JSON 校验报告 |
| **`/api/run-pipeline`** | POST | **核心流水线**:GIGA → AI → Excel(SSE 流式) |
| `/api/downloads/<file>` | GET | 登录后下载生成的 Excel |
| `/api/generate-image` | POST | AI 生图 |
| `/api/fetch-images` | POST | 代理下载 GIGA 图片 |

---

## ❓ 常见问题

### 端口被占用

```
Address already in use: 5182
```

解决:用 `scripts/stop_all.ps1` 杀掉残留进程,或重启电脑。

### GIGA API 请求失败:10053 / Connection aborted

Windows 上常见。原因:代理软件(Clash/V2Ray)或杀毒软件拦截了 HTTPS。

解决:临时关闭代理 + 杀毒软件后重试。

### AI 文案生成失败 / 内容为空

1. 检查 `.env` 中 `MINIMAX_API_KEY` 是否正确
2. 去 MiniMax 后台看 quota 余额
3. 查看 `.logs/ai_response_*.txt` 里的 AI 原始响应

### 前端启动失败 / 端口 5173 占用

```powershell
cd web
npm install
```

重新装依赖。

### .env 找不到

`.env` 已被 `.gitignore` 排除,clone 后**不会自动生成**。需要手动从 `.env.example` 复制并填值。

---

## 🐛 已知限制

- 现有 `/api/run-pipeline` Excel 步骤仍只支持 PLANTER；新的独立模板填表页优先支持 UK CABINET / CHAIR
- **5 个市场 × 3 种语言**(DE/EN/FR)的本地化处理
- Excel comment 中的 `image_studio` 字样已过时,Excel 模板填写功能正常

---

## 📝 开发

```bash
# 后端热重启
FLASK_DEBUG=1 python app.py

# 前端 hot reload(默认开启)
cd web && npm run dev
```

---

## 📄 许可

Internal tool — 仅限内部使用。
