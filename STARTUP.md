# GIGAB2B 启动指南

## 一键启动（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会自动：
1. 检查并安装缺失的 Python 包（flask / requests / openpyxl 等）
2. 检查并安装缺失的 npm 包
3. 按依赖顺序启动 `GIGAB2B Flask` → `GIGAB2B 前端`
4. 等待每个端口就绪
5. 输出健康检查结果

如果端口被占用，脚本会询问是否继续。

## 停止所有服务

```cmd
scripts\stop_all.bat
```

或手动：

```powershell
# 杀掉指定端口的进程
netstat -ano | findstr ":5181.*LISTENING"
taskkill /F /PID <pid>
```

## 启动问题排查

### 问题 1：bat 文件中文乱码 / `echo is not recognized`
**原因**：PowerShell 调用 `cmd /c xxx.bat` 时默认用 GB2312 解析命令行参数，bat 里的中文 echo 全部乱码。

**解决**：
- ✅ 用 `start.ps1`（PowerShell 原生，UTF-8 友好）
- 不要再在 PowerShell terminal 里 `cmd /c start_web.bat`
- 双击 `start_web.bat` 在 cmd 里运行没问题

### 问题 2：重启时报 `Address already in use`
**原因**：`app.py` 之前用 `debug=True`，Flask 的 reloader 父子进程关闭顺序不对，子进程持有的 socket 没释放。

**解决**：
- ✅ `app.py` 已改为默认 `debug=False`，用 `werkzeug.make_server` 显式 `SO_REUSEADDR`
- 如需 reload 调试，设环境变量 `FLASK_DEBUG=1` 即可恢复旧行为

### 问题 3：`vite` 找不到
**原因**：`web/node_modules` 没装。

**解决**：
```cmd
cd web
npm install
```
（`start.ps1` 会自动检测并安装）

### 问题 4：GIGA 凭证未配置
后端 health 检查会显示 `GIGA creds: missing`，需要：
1. 复制 `.env.example` 为 `.env`
2. 填入 `GIGA_DE_TAX_CLIENT_ID` 和 `GIGA_DE_TAX_CLIENT_SECRET` 等

## 端口分配

| 端口 | 服务 | 启动依赖 |
|---|---|---|
| 5182 | GIGAB2B Flask 后端 | 无 |
| 5173 | GIGAB2B Vite 前端 | 依赖 5182 |

## 手动启动（不推荐）

如果 `start.ps1` 有问题，可以手动：

```powershell
# 1. GIGAB2B 后端
cd F:\AI Projects\GIGAB2B
python app.py

# 2. GIGAB2B 前端
cd web
npm run dev
```