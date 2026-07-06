# 阿里云轻量应用服务器部署经验总结

> 本文档基于 GIGAB2B 项目(2026-07-06)部署过程踩坑整理,适用于所有"Python/Node + PM2 + 阿里云 ECS"类项目。

---

## 📑 目录

- [一、服务器基本信息](#一服务器基本信息)
- [二、部署架构现状](#二部署架构现状)
- [三、本次踩过的 8 个坑](#三本次踩过的-8-个坑)
- [四、以后部署新项目的标准流程](#四以后部署新项目的标准流程)
- [五、常见故障排查清单](#五常见故障排查清单)
- [六、必须避开的"地雷"行为](#六必须避开的地雷行为)
- [七、运维速查](#七运维速查)

---

## 一、服务器基本信息

| 项 | 值 |
|---|---|
| **公网 IP** | 39.108.63.108 |
| **系统** | Alibaba Cloud Linux 3(类 CentOS) |
| **当前用户** | admin(sudoer) |
| **可用磁盘** | 32 GB(共 40 GB,已用 6.2 GB) |
| **RAM** | 2 GB(使用率 ~27%) |
| **Node.js** | v20.20.2(系统装) |
| **Python** | 3.11(系统装) |
| **PM2** | v7.0.3 |
| **/opt/GIGAB2B** | 当前部署的 Flask + Vite 项目 |

---

## 二、部署架构现状

### GIGAB2B 的部署架构

```
┌────────────────────────────────────────────────────┐
│ 阿里云轻量应用服务器                                │
├────────────────────────────────────────────────────┤
│ systemd (PID 1)                                    │
│   └─ PM2 God Daemon (PID 930, /root/.pm2)         │
│       ├─ gigab2b-backend  (PID 13729)              │
│       │   venv/bin/python app.py                   │
│       │   监听 0.0.0.0:5182                        │
│       └─ gigab2b-frontend (PID 13730)              │
│           npx vite preview                         │
│           监听 0.0.0.0:5173                        │
└────────────────────────────────────────────────────┘
```

### 关键特征

- **进程由 root 用户的 PM2 托管**(`/root/.pm2/dump.pm2` 存配置)
- **应用名以 `gigab2b-` 开头**(`gigab2b-backend` / `gigab2b-frontend`)
- **端口直连 0.0.0.0**(无 Nginx,依赖阿里云防火墙做访问控制)
- **systemd 开机自启**:`pm2-admin.service`(由 `pm2 startup` 生成)

---

## 三、本次踩过的 8 个坑

### 坑 1:以为是 root 在裸跑,实际是 root 的 PM2 守护

**症状**:每次 `kill` 掉 Python/Vite 进程,几秒后又被拉起。
**真相**:`/root/.pm2` 里的 PM2 实例托管着 `gigab2b-backend` 和 `gigab2b-frontend`,死了会自动重启。
**教训**:
- `pm2 list` 默认看**当前用户**的 PM2(admin 看 `/home/admin/.pm2`,空)
- 看 root 的 PM2 必须用 `sudo pm2 list`(`/root/.pm2`)
- 杀进程前先确认"是谁在拉起它"

### 坑 2:`.env` 文件权限 `600`,普通用户读不到

**症状**:`PermissionError: [Errno 13] Permission denied: '/opt/GIGAB2B/.env'`
**原因**:`.env` 是 root 创建的,权限 `-rw-------`,admin 用户读不到。
**解决**:`sudo chmod 644 .env`(只读权限,不让其他用户写)
**教训**:
- 用 PM2 跑 Python 项目时,如果 PM2 用的用户不是 .env 拥有者,要先 `chmod 644`
- 或者**直接把项目目录 chown 给运行用户**:`sudo chown -R admin:admin /opt/项目名`

### 坑 3:PM2 启动 Python 的语法错了

**错误写法**:
```bash
pm2 start /opt/.../python --name giga-backend --interpreter none -- app.py
```
**报错**:`can't open file '/opt/.../interpreter': No such file or directory`
**原因**:`--interpreter none` 后面,PM2 试图把 `app.py` 当作参数传给 `none`,实际把第一个参数 `--` 后面的内容当成了脚本名。
**正确写法**:
```bash
pm2 start app.py --name giga-backend --interpreter /opt/.../venv/bin/python
```
**关键点**:`--interpreter` 直接指定解释器路径,`app.py` 作为 PM2 的第一个位置参数。

### 坑 4:vite 不认识 `--cwd` 参数

**错误写法**:
```bash
pm2 start .../vite --name giga-frontend --interpreter none -- preview --cwd /opt/.../web
```
**报错**:`CACError: Unknown option '--cwd'`
**原因**:`--cwd` 是给 PM2 用的(要写在 PM2 参数区,不能透传给 vite)
**正确写法**:
```bash
pm2 start /opt/.../vite --name giga-frontend --cwd /opt/.../web -- preview --host 0.0.0.0 --port 5173
```
**关键点**:`--cwd` 是 PM2 的元数据,放在 `script` 后、`--` 前;`--` 后面才是给 vite 自己的参数。

### 坑 5:`start_services.sh` 是"地雷"脚本

**症状**:你之前可能误跑过 `/tmp/start_services.sh`,它:
1. `pm2 delete all` —— 杀掉所有 PM2 管理的服务
2. `sed -i 's/host=127.0.0.1/host=0.0.0.0/' app.py` —— **自动改源码**!
3. 用 root 重新 `pm2 start`,应用名变成 `gigab2b-*`
**教训**:
- **永远别再跑** `/tmp/start_services.sh` / `/tmp/deploy_app.sh` 这类脚本
- 如果想加新服务,直接用 `sudo pm2 start ...` 启动
- 如果 `/tmp/` 下有 `start_*.sh` / `deploy_*.sh` / `setup_*.sh`,先看看内容再决定是否删除

### 坑 6:端口被占导致 PM2 启动失败

**症状**:PM2 显示 `errored`,restart 次数疯狂涨。
**排查**:
```bash
sudo ss -tlnp | grep -E ":5182|:5173"
```
**原因**:另一个进程占着端口(可能是 root 看门狗拉起的),PM2 启不动。
**解决**:先 `sudo kill -9 <PID>`,再 `pm2 start`。

### 坑 7:两个 PM2 实例(用户级)互相干扰

**症状**:admin 启动了 giga-backend,但 5182 还是 root 那个老进程在响应。
**原因**:`/home/admin/.pm2` 和 `/root/.pm2` 是两套独立的 PM2,互不感知。
**解决**:
- 要么**统一用一个用户**跑(推荐 root,跟现有服务一致)
- 要么**用 `sudo pm2`** 来管所有服务
- 部署完成后 `pm2 delete` 把当前用户 PM2 里的服务清空,避免双份守护

### 坑 8:健康检查报"Permission denied"但接口能访问

**症状**:`pm2 list` 显示 `errored`,但 `curl /api/health` 返回 200。
**真相**:`errored` 是 PM2 的状态(它启动的进程挂了),但端口被**别的进程**(root 看门狗拉起的)占着,所以 curl 还是通的。
**教训**:
- **不要只看 `pm2 list`,要 `curl` 实际验证**
- `pm2 list` 和实际服务是两回事,端口被占时 PM2 进程死了但服务还活着

---

## 四、以后部署新项目的标准流程

### 0. 准备工作(只做一次)

```bash
# SSH 到服务器
ssh admin@39.108.63.108

# 基础环境(应该已经装了)
node -v   # 应 v20+
python3 --version   # 应 3.11+
pm2 -v   # 应 v7+

# 如果 PM2 没装:
sudo npm install -g pm2
```

### 1. 上传项目代码

```bash
# 在本机打包(排除依赖和日志)
cd "项目目录"
tar --exclude=node_modules --exclude=__pycache__ --exclude=outputs \
    --exclude=.logs --exclude=.env --exclude=venv -czf project.tar.gz .

# 上传到服务器
scp project.tar.gz admin@39.108.63.108:/opt/

# 服务器上解压
ssh admin@39.108.63.108
cd /opt/
sudo tar -xzf project.tar.gz
sudo mv 原目录名 新项目名
sudo chown -R admin:admin 新项目名   # 关键:让 admin 拥有
cd 新项目名
```

### 2. 配置 .env(本地写好上传,绝不在这台机器上用记事本)

```bash
# 本机 PowerShell 里拼 .env 内容,scp 上传
# (参考 GIGAB2B/HANDOFF.md 的 base64 拆分方案)

# 上传后
sudo chmod 644 .env   # 让运行用户能读
```

### 3. 装依赖

```bash
# Python 项目
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Node 项目
cd web   # 或者前端目录
npm install
npm run build   # 一定要 build,不要用 dev 模式上生产
```

### 4. 用 PM2 启动(以 root 身份,跟现有架构统一)

```bash
# 切到 root(关键!否则会有 2 套 PM2)
sudo -i
cd /opt/新项目名

# Python 后端(标准模板)
pm2 start app.py --name <项目名>-backend --interpreter /opt/.../venv/bin/python

# Node 前端(serve dist 产物,不要 vite dev)
cd /opt/.../web
pm2 start /opt/.../web/node_modules/.bin/vite --name <项目名>-frontend \
    --cwd /opt/.../web -- preview --host 0.0.0.0 --port <端口>

# 验证
pm2 list
curl http://127.0.0.1:<端口>/api/health
```

### 5. 持久化(开机自启)

```bash
# 第一次需要这样启用 systemd 集成
pm2 startup | tee /tmp/pm2-startup.sh
# 把输出的最后一行(带 sudo env ...的那个)复制粘贴跑一下

# 保存当前进程列表(系统重启后自动恢复)
pm2 save
```

### 6. 验证 + 监控

```bash
# 进程状态
sudo pm2 list

# 实时日志
sudo pm2 logs <项目名>-backend --lines 50
sudo pm2 logs <项目名>-frontend --lines 50

# 端口监听
sudo ss -tlnp | grep -E ":<端口>"

# 健康检查
curl http://127.0.0.1:<端口>/api/health
```

---

## 五、常见故障排查清单

### Q1:改了代码但服务没生效?

```bash
sudo pm2 restart <项目名>-backend
# 前端如果改了:
cd /opt/.../web && npm run build && cd ..
sudo pm2 restart <项目名>-frontend
```

### Q2:`pm2 list` 显示 `errored`?

```bash
# 1. 看错误日志
sudo pm2 logs <项目名>-backend --lines 30 --nostream --err

# 2. 90% 是端口被占
sudo ss -tlnp | grep :<端口>
sudo kill -9 <占端口的PID>

# 3. 90% 是 .env 权限不对
ls -la .env
sudo chmod 644 .env
```

### Q3:服务不停重启(restart 次数疯涨)?

```bash
# 一定是启动命令错了
sudo pm2 logs <项目名>-backend --lines 30 --nostream --err
# 看具体报错,常见:
# - ModuleNotFoundError → 漏装依赖 / venv 没激活
# - PermissionError → 文件权限
# - Address already in use → 端口被占
# - can't open file → 启动命令里路径写错
```

### Q4:`curl localhost` 通,但 `curl 公网IP` 不通?

```bash
# 阿里云控制台 → 防火墙 → 添加规则,放行该端口
# 注意:阿里云有"控制台防火墙"和"服务器 ufw"两层,都要开
```

### Q5:服务器重启后服务没起来?

```bash
# 看 PM2 的 systemd 集成是否还在
systemctl status pm2-admin
# 如果没 enabled:
sudo systemctl enable pm2-admin
# 看 dump 文件:
ls -la /root/.pm2/dump.pm2
# 看进程列表:
sudo pm2 list
```

### Q6:端口被占,但 `lsof` 找不到占用的进程?

```bash
# 看具体哪个进程在占
sudo ss -tlnp | grep :<端口>
# users:(("python",pid=XXXX,fd=Y))  ← 看这个 PID
# 然后看这个进程是什么:
ps -p <PID> -o pid,ppid,user,cmd
```

### Q7:删了 PM2 服务,几秒后又自动启动?

**这是 PM2 的 autorestart 特性在生效**(默认开启)。说明有别的 PM2 实例(很可能是 root 的)接管了它。
```bash
# 查所有 PM2 实例
sudo pm2 list
pm2 list
# 看两边都管着什么
```

---

## 六、必须避开的"地雷"行为

| 行为 | 后果 |
|---|---|
| ❌ 跑 `/tmp/start_services.sh` / `/tmp/deploy_*.sh` | 会 `pm2 delete all` + `sed` 改源码 |
| ❌ 用记事本直接编辑 .env | 引入 NUL 字符,Python 读环境变量会截断 |
| ❌ 部署时用 `vite dev`(开发模式) | 性能差、不会自动重启、依赖源文件不能删 |
| ❌ 让 admin 和 root 的 PM2 同时跑同名的服务 | 端口冲突、服务状态混乱 |
| ❌ 在 SSH 里 `sudo chmod 777` | 任何安全风险 |
| ❌ 把 .env 提交到 Git | API Key 泄露 |
| ❌ 改代码后只 `pm2 reload`(不 restart) | Flask 不支持热重载,改完必须 restart |
| ❌ 用 `kill -9` PM2 进程但没 `pm2 delete` | PM2 会一直尝试重启,看不到真实状态 |
| ❌ 在 PM2 里用 `nohup &` 套娃 | 双重守护,debug 时混淆 |
| ❌ 服务器上 `npm install -g xxx` 但不记下来 | 升级或重装时丢失依赖,不知道当初装的什么 |

---

## 七、运维速查

### 日常

```bash
# 看所有服务状态
sudo pm2 list

# 重启单个服务
sudo pm2 restart <项目名>-backend
sudo pm2 restart <项目名>-frontend

# 看实时日志(follow 模式,Ctrl+C 退出)
sudo pm2 logs <项目名>-backend
sudo pm2 logs <项目名>-frontend

# 看最近 N 行日志
sudo pm2 logs <项目名>-backend --lines 100 --nostream

# 看磁盘
df -h /

# 看内存
free -h
```

### 更新代码(标准流程)

```bash
sudo -i
cd /opt/<项目名>

# 1. 备份(可选)
sudo cp -a .env .env.bak.$(date +%H%M)

# 2. 拉代码(如果是 git 仓库)
git pull

# 3. 装新依赖(如果 requirements.txt 变了)
source venv/bin/activate
pip install -r requirements.txt

# 4. 重新 build 前端(如果前端代码变了)
cd web
npm install   # 如果 package.json 变了
npm run build
cd ..

# 5. 重启
sudo pm2 restart <项目名>-backend
sudo pm2 restart <项目名>-frontend

# 6. 验证
curl http://127.0.0.1:<后端端口>/api/health
curl -I http://127.0.0.1:<前端端口>/
```

### 紧急恢复

```bash
# 服务挂了,先看错误
sudo pm2 logs <项目名>-backend --lines 50 --nostream --err

# 如果 PM2 自己也挂了
sudo systemctl restart pm2-admin

# 如果 systemd 找不回 PM2
sudo -i
pm2 resurrect   # 从 dump.pm2 恢复

# 如果全完了,只剩代码还在
sudo -i
cd /opt/<项目名>
source venv/bin/activate
nohup venv/bin/python app.py > /tmp/backend.log 2>&1 &
cd web
nohup node node_modules/.bin/vite preview --host 0.0.0.0 --port <端口> > /tmp/frontend.log 2>&1 &
```

### 防火墙(阿里云控制台)

| 端口 | 服务 | 备注 |
|---|---|---|
| 22 | SSH | 默认开 |
| 80 | HTTP(如果有 Nginx) | - |
| 443 | HTTPS(如果有) | - |
| 5173 | Vite preview(GIGAB2B) | 当前在用 |
| 5182 | Flask 后端(GIGAB2B) | 当前在用 |
| **新项目端口** | 新服务 | 在控制台 → 防火墙 → 添加规则 |

---

## 📝 附录:本机对应改动记录(可复制到 commit message)

```
chore: 添加 DEPLOY_NOTES.md - 阿里云服务器部署经验总结

- 服务器信息(Alibaba Cloud Linux 3, admin 用户, root PM2 守护)
- 本次踩过的 8 个坑(PM2 守护、env 权限、Python 启动语法、vite cwd 等)
- 标准部署流程(上传代码 → 装依赖 → PM2 start → 持久化)
- 故障排查清单(7 个常见 Q&A)
- 必须避开的"地雷"行为清单
- 运维速查(日常/更新/紧急恢复)
```

---

**最后更新**:2026-07-06
**维护者**:Leo
**服务器**:阿里云轻量应用服务器 39.108.63.108
