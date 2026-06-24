# GIGA Open API 2.0 开发文档与需求整理

> 整理时间：2026-06-24
> 对话背景：GIGA B2B 平台 Open API 2.0 对接，目标是实现产品信息获取 → AI 文案/图片优化 → 上传至亚马逊/Walmart/Wayfair 平台

---

## 一、基础信息

### 1.1 接入概述

GIGA 开放平台提供 Open API 能力，开放 Buyer、Seller 数据。自研系统或使用第三方系统（ERP）的 Buyer、Seller 可通过接入 GIGA Open API 获取数据，实现自定义应用开发。

**接入方式：**

- **Buyer**：在 B2B 平台申请，菜单路径：`Buyer个人中心 / APIs / API应用市场 / OpenAPI`。完成后在"管理我的API"中查看 Client ID、Client Secret。
- **Seller**：联系在线客服开通获取 Client ID、Client Secret（目前仅支持 On-Site Seller）。

**接入流程：**

1. Buyer 在 B2B 平台申请配置 Open API 应用，获取 API key
2. Seller 联系在线客服申请开通（目前仅支持 On-Site Seller）
3. 按文档配置公共参数和签名
4. 调试上线，必要时联系在线客服寻求技术帮助

### 1.2 版本说明

本文档所有规则适用于 **OpenAPI 2.0** 接口。建议尽快切换至本版本，旧版本（OpenAPI 1.0）即将下线。

2025年8月28日前 Buyer 在页面申请的 API key 可用于所有 OpenAPI 2.0 接口。若旧 key 无法调用新接口，请在 B2B 平台重新申请。

### 1.3 域名

| 环境 | 域名 |
|------|------|
| 测试环境 | `https://openapi-sandbox.gigab2b.com` |
| 生产环境 | `https://openapi.gigab2b.com` |

> 注意：以上为 OpenAPI 2.0 版本接口域名，1.0 版本另有域名，请勿混淆。

---

## 二、签名规则

### 2.1 签名算法

**步骤：**

1. **构造字符串1**：`Client ID & API路径 & timestamp & nonce`
2. **构造密钥**：`Client ID & Client Secret & nonce`
3. **密串1**：`HMAC-SHA256(字符串1, 密钥)` → 转为 16 进制
4. **sign 值**：`Base64(密串1)`

### 2.2 Python 实现

```python
import os
import time
import random
import string
import base64
import hmac
import hashlib

BASE_URL = "https://openapi-sandbox.gigab2b.com"  # 测试环境

CLIENT_ID = os.getenv("GIGA_CLIENT_ID")
CLIENT_SECRET = os.getenv("GIGA_CLIENT_SECRET")

def generate_nonce(length: int = 10) -> str:
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def build_sign(client_id: str, client_secret: str,
               timestamp: int, nonce: str, uri: str) -> str:
    msg = f"{client_id}&{uri}&{timestamp}&{nonce}"
    key = f"{client_id}&{client_secret}&{nonce}"
    hex_digest = hmac.new(
        key.encode("utf-8"),
        msg.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return base64.b64encode(hex_digest.encode("utf-8")).decode("utf-8")

def make_headers(uri: str) -> dict:
    timestamp_ms = int(time.time() * 1000)
    nonce = generate_nonce(10)
    sign = build_sign(CLIENT_ID, CLIENT_SECRET, timestamp_ms, nonce, uri)
    return {
        "Content-Type": "application/json",
        "client-id": CLIENT_ID,
        "timestamp": str(timestamp_ms),
        "nonce": nonce,
        "sign": sign,
    }
```

---

## 三、公共参数说明

GIGA Open API 的输入参数由**公共参数**和**请求参数**两部分组成。

### 3.1 请求头公共参数

| 参数名称 | 类型 | 必填 | 描述 |
|----------|------|------|------|
| Content-Type | string | 是 | 默认 `application/json` |
| client-id | string | 是 | B2B 平台申请的 Client ID |
| timestamp | string | 是 | 毫秒时间戳（1970-01-01 UTC 起经过的秒数），只处理 20 分钟以内的请求 |
| nonce | string | 是 | 随机值，要求 10 位 |
| sign | string | 是 | 签名 |

### 3.2 返回参数结构

| 参数名称 | 类型 | 必填 | 描述 |
|----------|------|------|------|
| success | boolean | 是 | 请求是否成功 |
| code | string | 是 | 错误码，成功返回 200 |
| data | object[] | 否 | 响应数据 |
| requestId | string | 是 | 请求唯一标识 |
| msg | string | 是 | 错误信息描述，成功返回 "success" |
| subMsg | string | 否 | 明细错误场景描述 |
| recommend | string | 否 | 错误诊断链接 |

### 3.3 通用错误码

| 错误码 | 描述 | 解决方案 |
|--------|------|----------|
| 200 | 请求成功 | — |
| 401 | 接口不可用 | 更换可用接口重试，或联系人工客服 |
| 404 | 路径不存在 | 检查接口路径 |
| 500 | 服务器错误 | 稍后重试，联系官方客服 |
| 400001 | 请求频率过高 | 查看接口文档限流规则 |
| 400003 | 入参格式错误 | 检查入参格式和语法 |
| 400004 | 无效签名 | 检查签名及构成因子 |
| 400005 | 缺少签名 | 请求头添加签名 |
| 400006 | 缺少时间戳 | 请求头添加时间戳 |
| 400007 | 无效时间戳 | 检查时间戳格式 |
| 400008 | 请求超时（超20分钟） | 重新请求 |
| 400009 | 缺少随机值 | 请求头添加随机值 |
| 4000010 | 无效随机值 | — |

---

## 四、接口一：产品详情查询

### 4.1 基本信息

| 项目 | 值 |
|------|------|
| 接口路径 | `POST /b2b-overseas-api/v1/buyer/product/detailInfo/v1` |
| 限流规则 | 10 秒内最多 20 次 |

### 4.2 应用场景

支持通过 SKU（item code）或产品名称查询产品详情。

**限制：仅支持查询 Buyer 加入收藏夹内或者有囤货库存的产品。**

### 4.3 请求体参数

| 参数名称 | 类型 | 必填 | 描述 |
|----------|------|------|------|
| skus | string[] | 否（与 productNames 二选一） | SKU 列表，最多 200 个 |
| productNames | string[] | 否（与 skus 二选一） | 产品名称列表，最多 200 个 |

> skus 和 productNames 必须且只能选一个作为入参。

### 4.4 请求示例

```json
{
  "skus": ["W10172S00004", "W10172S00020", "B215P204169"]
}
```

### 4.5 返回参数（data 数组元素）

| 字段 | 类型 | 描述 |
|------|------|------|
| sku | string | 平台产品编码 item code |
| mpn | string | 商家自定义商品编码 |
| productName | string | 产品名称 |
| description | string | 产品图文描述 |
| characteristics | string[] | 产品特点 |
| mainMaterial | string | 产品材质 |
| mainColor | string | 产品颜色 |
| mainImageUrl | string | 产品主图链接 |
| imageUrls | string[] | 产品图片 URL 列表 |
| productVideoUrl | string | 产品视频 URL |
| categoryCode | integer | 分类 code |
| category | string | 分类名称 |
| comboFlag | boolean | 是否为 combo 品 |
| overSizeFlag | boolean | 是否超大件（LTL） |
| isLGP | boolean | 德国是否大件包裹（LGP） |
| partFlag | boolean | 是否为配件 |
| upc | string | 产品 UPC 标识 |
| customized | string | 是否定制化（yes/no） |
| whiteLabel | string | 是否白牌（Yes/No/其他-历史数据） |
| placeOfOrigin | string | 原产地 |
| lithiumBatteryContained | string | 是否含锂电池 |
| weightUnit | string | 重量单位 |
| weight | number | 重量（单位见 weightUnit） |
| lengthUnit | string | 长度单位 |
| length / width / height | number | 产品包装尺寸 |
| weightKg | number | 重量（千克） |
| lengthCm / widthCm / heightCm | number | 产品包装尺寸（厘米） |
| assembledLength / assembledWidth / assembledHeight | string | 组装尺寸 |
| assembledWeight | string | 组装重量 |
| customList | array | 自定义字段集合，含 customName / customValue / customType |
| associateProductList | string[] | 关联产品 SKU 集合 |
| brandInfo | object | 品牌信息，含 brandName / brandPictures / brandIntro |
| certificationList | array | 认证文件集合，含 url / title / fileUrls / videoUrls |
| afterSalesPolicy | string | 售后规则详情 URL |
| protectionServiceRates | array | 保障服务费率，含 protectionService / rate |
| attributes | object | 产品属性（key-value） |
| comboInfo | array | combo 子产品信息，含子 sku / qty / 尺寸重量 |
| firstArrivalDate | string | 首次到库时间（格式 yyyy-MM-dd） |
| sellerInfo | object | Seller 信息，含 sellerStore / sellerType / gigaIndex / sellerCode / sellerReturnRate / sellerReturnApprovalRate / sellerMessageResponseRate |
| skuAvailable | boolean | 是否可购买（true=可购买，false=不可购买） |
| unAvailablePlatform | array | 不可售卖平台列表，含 id / name |
| newArrivalFlag | boolean | 是否新品 |

### 4.6 接口特有错误码

| 错误码 | 二级错误描述 | 解决方案 |
|--------|-------------|----------|
| B20002 | skus 最大限制 200 个 | 减少 skus 数量 |
| B20002 | productNames 单次限制 200 个 | 减少 productNames 数量 |
| B20004 | productNames 在 B2B 平台不存在 | 检查产品名称 |
| B20002 | skus 和 productNames 必须二选一 | 调整入参 |

---

## 五、接口二：库存查询

### 5.1 基本信息

| 项目 | 值 |
|------|------|
| 接口路径 | `POST /b2b-overseas-api/v1/buyer/inventory/quantity/v2` |
| 限流规则 | 10 秒内最多 10 次 |

### 5.2 应用场景

通过 SKU 编码查询 B2B 平台上的产品可售库存（Seller 库存）或 Buyer 自己的库存信息。支持查询产品促销活动可购库存、仓租。美国 & 欧洲上门取货 Buyer 支持查询仓库维度库存。

**限制：仅支持查询 Buyer 加入收藏夹内或者有囤货库存的产品。**

### 5.3 请求体参数

| 参数名称 | 类型 | 必填 | 描述 |
|----------|------|------|------|
| skus | string[] | 是 | 平台产品编码 item code，单次最多 200 个 |

### 5.4 请求示例

```json
{
  "skus": ["W10172S00004"]
}
```

### 5.5 返回参数（data 数组元素）

| 字段 | 类型 | 描述 |
|------|------|------|
| sku | string | 平台产品编码 |

**buyerInventoryInfo（Buyer 库存信息）：**

| 字段 | 类型 | 描述 |
|------|------|------|
| totalBuyerAvailableInventory | integer | Buyer 可用（全款购买且未锁定）的库存总量 |
| totalMarginInventory | integer | Buyer 签订现货协议未付尾款的库存总量 |
| totalFutureInventory | integer | Buyer 签订期货协议未付尾款的库存总量 |
| totalSystemLockedInventory | integer | 系统锁定库存总量 |
| totalBuyerLockedInventory | integer | Buyer 手动锁定库存总量 |
| buyerInventoryDistribution | array | Buyer 库存仓库分布，含 warehouseCode / buyerAvailableInventory / marginInventory / systemLockedInventory / buyerLockedInventory |
| totalStorageFee | number | 截止昨日 sku 总仓租（含已支付部分） |
| unpaidStorageFee | number | 未支付仓租 |
| currency | string | 仓租费用币种 |

**sellerInventoryInfo（Seller 库存信息）：**

| 字段 | 类型 | 描述 |
|------|------|------|
| sellerAvailableInventory | integer | Seller 可售库存（最大可采购数量） |
| discountAvailableInventory | integer | 限时促销折扣限购数量 |
| sellerInventoryDistribution | array | Seller 库存仓库分布，含 warehouseCode / availableQtyMin / availableQtyMax |
| nextArrivalInventory | object | 预计下次到库，含 nextArrivalBegin / nextArrivalEnd / nextArrivalQtyMin / nextArrivalQtyMax |

### 5.6 接口特有错误码

| 错误码 | 二级错误描述 | 解决方案 |
|--------|-------------|----------|
| B50001 | SKU 要求必填 | 添加 skus 参数 |
| B50002 | SKU 单次查询需 200 个以内 | 减少 skus 数量 |
| B50003 | SKU 未加入收藏夹或无库存，无法查询 | 将产品加入收藏夹或确认有囤货 |
| B50004 | SKU 在 B2B 平台不存在 | 检查 SKU 是否正确 |

---

## 六、业务需求：多平台铺货自动化

### 6.1 目标

1. 通过 GIGA Open API 获取产品信息（产品详情 + 库存）
2. 使用 AI 对产品文案和图片进行优化（标题、描述、bullet points、SEO 适配）
3. 上传至以下平台：亚马逊（Amazon）、沃尔玛（Walmart）、Wayfair

### 6.2 可行性分析

**GIGA API 获取数据：** ✅ 完全可行
- 产品详情接口可获取：名称、描述、图片、视频、材质、颜色、尺寸、认证、品牌信息等

**AI 文案优化：** ✅ 可行
- LLM 可改写标题（SEO）、生成 bullet points（亚马逊格式）、适配多平台语言风格

**图片优化：** ⚠️ 部分可行
- 基础处理（尺寸、格式、背景去除）：完全可做
- AI 生成场景图/模特图：技术可行，但需确认 GIGA 图片版权是否允许商用

**上传至各平台：** ⚠️ 各有挑战

| 平台 | API 成熟度 | 主要门槛 |
|------|-----------|----------|
| 亚马逊 | SP-API（成熟） | 需要 UPC/EAN |
| 沃尔玛 | Walmart MP API | 有白名单门槛 |
| Wayfair | Supplier API | 审核严格 |

### 6.3 主要风险点

1. **UPC/EAN**：亚马逊要求每个产品有 UPC/EAN 或申请白名单
2. **产品合规**：各平台类目审核不同，GIGA 产品不一定都满足
3. **图片版权**：需向 GIGA 确认图片是否可商用
4. **多平台同步**：库存、价格、订单、评价同步需要持续维护

### 6.4 建议的 MVP 路径

**阶段一：验证连通性**（当前阶段）
- 用测试环境 key 验证签名 + 两个查询接口是否通
- 测试环境：`https://openapi-sandbox.gigab2b.com`

**阶段二：数据采集**
- 批量获取产品详情和库存数据
- 建立本地产品数据库

**阶段三：AI 优化**
- 对接 LLM API，优化文案
- 处理图片（需确认版权）

**阶段四：单平台上传**
- 先从亚马逊 SP-API 入手（最成熟）
- 验证上传链路

**阶段五：多平台扩展**
- Walmart → Wayfair

### 6.5 当前进度

- [x] API 文档整理
- [x] 签名工具 Python 实现
- [x] 连接测试脚本（`test_giga_connection.py`）
- [ ] 获取测试环境 Client ID / Client Secret
- [ ] 运行连通性测试
- [ ] 后续待定

---

## 七、连接测试脚本

已保存测试脚本：`F:\AI Projects\GIGAB2B\test_giga_connection.py`

### 使用方法

1. **设置环境变量**（PowerShell，当前会话有效，不影响其他应用）：
```powershell
$env:GIGA_CLIENT_ID="your_test_client_id"
$env:GIGA_CLIENT_SECRET="your_test_client_secret"
```

2. **运行测试脚本**：
```powershell
cd F:\AI Projects\GIGAB2B
python test_giga_connection.py
```

3. **预期结果**：返回 `success: true`，HTTP 200

---

## 八、文件清单

| 文件 | 说明 |
|------|------|
| `test_giga_connection.py` | GIGA API 连接测试脚本 |
| `GIGA_OpenAPI_开发文档整理.md` | 本文档，含 API 文档汇总 + 需求整理 |
