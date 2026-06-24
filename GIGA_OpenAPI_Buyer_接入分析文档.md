# GIGA Open API 2.0 — Buyer 端接入分析文档

> 整理自 2026-06-24 对话记录，原始文档由用户提供（三个 PDF / 页面截图）

---

## 一、项目目标

**最终目标**：通过 GIGA Open API 获取产品信息和库存信息，经过 AI 优化（文案 + 图片）后，上传至亚马逊 Amazon、沃尔玛 Walmart、Wayfair 三个平台进行销售。

---

## 二、GIGA Open API 2.0 概览

### 2.1 接入方式

| 角色 | 申请方式 |
|------|---------|
| Buyer | 在 B2B 平台申请：Buyer个人中心 → APIs → API应用市场 → OpenAPI |
| Seller | 联系在线客服开通（仅支持 On-Site Seller） |

申请成功后获得：
- **Client ID**
- **Client Secret**

### 2.2 域名

| 环境 | 域名 |
|------|------|
| 测试环境 | `https://openapi-sandbox.gigab2b.com` |
| 生产环境 | `https://openapi.gigab2b.com` |

> ⚠️ 注意：1.0 接口使用不同域名，本文档仅涉及 2.0。

### 2.3 公共请求头参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| Content-Type | string | 是 | 固定值 `application/json` |
| timestamp | string | 是 | 毫秒时间戳（UTC 1970-01-01 起），只处理 20 分钟内的请求 |
| nonce | string | 是 | 10 位随机字符串 |
| sign | string | 是 | 签名（见下方签名规则） |
| client-id | string | 是 | Client ID |

### 2.4 签名规则

**构造步骤**：

1. **字符串 1**：`ClientID & API路径 & timestamp & nonce`
2. **密钥**：`ClientID & ClientSecret & nonce`
3. **密串 1**：用密钥对字符串 1 做 `HMAC-SHA256`，转 16 进制
4. **最终 sign**：对密串 1 做 Base64 编码

### 2.5 通用返回结构

```json
{
  "success": true,       // boolean，是否成功
  "code": "200",         // string，成功=200，失败=对应错误码
  "data": [],            // array，返回数据
  "requestId": "xxx",    // string，请求唯一标识
  "msg": "success",      // string，成功时返回 success
  "subMsg": null,        // string，二级错误描述
  "recommend": null      // string，错误诊断链接
}
```

### 2.6 限流说明

| 接口 | 限流规则 |
|------|---------|
| 产品详情查询 | 10 秒内最多 20 次 |
| 库存查询 | 10 秒内最多 10 次 |

---

## 三、接口一：产品详情查询

**路径**：`POST /b2b-overseas-api/v1/buyer/product/detailInfo/v1`

**应用场景**：通过 SKU 或产品名称查询产品详情。
> ⚠️ **重要限制**：仅支持查询 Buyer 收藏夹内或有过囤货库存的产品。

### 3.1 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| skus | string[] | 二选一 | SKU 列表，最多 200 个 |
| productNames | string[] | 二选一 | 产品名称列表，最多 200 个 |

```json
{
  "skus": ["W10172S00004", "W10172S00020", "B215P204169"]
}
```

### 3.2 返回字段（关键）

| 字段 | 类型 | 说明 |
|------|------|------|
| sku | string | 平台产品编码 |
| mpn | string | 商家自定义商品编码 |
| productName | string | 产品名称 |
| description | string | 图文描述 |
| characteristics | string[] | 产品特点 |
| mainMaterial | string | 产品材质 |
| mainColor | string | 产品颜色 |
| weight / length / width / height | number | 包装尺寸（lb / in） |
| weightKg / lengthCm / widthCm / heightCm | number | 包装尺寸（kg / cm） |
| imageUrls | string[] | 除主图外的图片 URL |
| mainImageUrl | string | 产品主图 URL |
| productVideoUrl | string | 产品展示视频 URL |
| category | string | 产品分类 |
| brandInfo | array | 品牌名称、图片、介绍 |
| certificationList | array | 认证文件集合 |
| whiteLabel | string | 是否白牌（Yes/No） |
| comboFlag | boolean | 是否为组合产品 |
| comboInfo | array | 组合产品子项信息 |
| associateProductList | string[] | 关联产品 SKU |
| sellerInfo | object | 店铺名、类型、评分、退货率等 |
| skuAvailable | boolean | 是否可购买 |
| newArrivalFlag | boolean | 是否新品 |

### 3.3 关键限制

- 单次最多查询 200 个 SKU 或 200 个产品名称
- 二者**必须且只能选一个**作为入参
- 仅限收藏夹或有过囤货的产品

---

## 四、接口二：库存查询

**路径**：`POST /b2b-overseas-api/v1/buyer/inventory/quantity/v2`

**应用场景**：查询 Seller 可售库存或 Buyer 自己的库存（含仓租）。
> ⚠️ **重要限制**：仅支持查询 Buyer 收藏夹内或有过囤货库存的产品。

### 4.1 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| skus | string[] | 是 | SKU 列表，最多 200 个 |

### 4.2 返回字段

#### Buyer 库存（buyerInventoryInfo）

| 字段 | 类型 | 说明 |
|------|------|------|
| totalBuyerAvailableInventory | int | 可用库存（全款购买且未锁定） |
| totalMarginInventory | int | 现货协议未付尾款库存 |
| totalFutureInventory | int | 期货协议未付尾款库存 |
| totalSystemLockedInventory | int | 系统锁定库存 |
| totalBuyerLockedInventory | int | 手动锁定库存 |
| buyerInventoryDistribution | array | 按仓库分布的库存明细 |
| totalStorageFee | number | 截止昨日总仓租 |
| unpaidStorageFee | number | 未支付仓租 |

#### Seller 库存（sellerInventoryInfo）

| 字段 | 类型 | 说明 |
|------|------|------|
| sellerAvailableInventory | int | 平台可售库存（最大可采购量） |
| discountAvailableInventory | int | 限时促销折扣限购数量 |
| sellerInventoryDistribution | array | 按仓库分布的可采购数量区间 |
| nextArrivalInventory | object | 预计下次到货（日期区间 + 数量区间） |

### 4.3 关键限制

- 单次最多查询 200 个 SKU
- SKU 必须存在于 B2B 平台

---

## 五、能力评估总结

| 信息维度 | 可通过 API 获取 | 说明 |
|---------|:---------:|------|
| 产品基本信息（名称/描述/规格） | ✅ | 完整 |
| 产品图片 / 视频 | ✅ | 完整，含 URL |
| 产品价格 | ✅ | 通过此接口获取 |
| 品牌 / 材质 / 颜色 | ✅ | 完整 |
| 认证文件 | ✅ | 含 URL |
| Seller 信息（评分/退货率） | ✅ | 完整 |
| **Seller 可售库存** | ✅ | 完整，含仓库维度 |
| **Buyer 自有库存** | ✅ | 含可用/锁定/仓租 |
| 财务信息（账单/发票/流水） | ❌ | 无公开 API |

---

## 六、业务场景：AI 优化 + 多平台上传

### 6.1 目标链路

```
GIGA 产品信息 → AI 文案优化 → AI 图片处理 → 亚马逊 / 沃尔玛 / Wayfair 上架
```

### 6.2 各平台 API 成熟度

| 平台 | API | 上传难度 | 关键门槛 |
|------|-----|---------|---------|
| 亚马逊 Amazon | SP-API | ⭐⭐ 中 | 需要 UPC/EAN，白牌需申请白名单 |
| 沃尔玛 Walmart | Walmart Marketplace API | ⭐⭐⭐ 中高 | 有白名单申请门槛 |
| Wayfair | Supplier API | ⭐⭐⭐⭐ 高 | 审核严格，供应商资质要求高 |

### 6.3 核心风险点

1. **UPC / EAN**：亚马逊强制要求，需提前准备或申请白名单
2. **产品合规认证**：各平台类目审核不同，GIGA 产品认证不一定满足所有平台
3. **图片版权**：需向 GIGA 确认图片商用授权范围
4. **库存同步**：多平台库存、价格同步是持续工程
5. **GIGA API 限制**：产品必须在收藏夹或有过囤货记录，否则无法查询

### 6.4 建议路径

**MVP（最小可行产品）**：先从亚马逊单一平台验证链路通顺，再逐步扩展。

---

## 七、已验证的连通性测试脚本

> 文件位置：`F:\AI Projects\GIGAB2B\test_giga_connection.py`

脚本包含：
- Python 签名工具类（对照文档 Java 示例逻辑一致）
- 产品详情查询接口调用
- 库存查询接口调用

使用方法：
```powershell
# 设置环境变量（仅当前会话有效，不影响其他应用）
$env:GIGA_CLIENT_ID="你的测试ClientID"
$env:GIGA_CLIENT_SECRET="你的测试ClientSecret"

# 运行测试
python F:\AI Projects\GIGAB2B\test_giga_connection.py
```

---

## 八、下一步行动计划

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 获取测试环境 Client ID + Client Secret | 待用户完成 |
| 2 | 运行 `test_giga_connection.py` 验证连通性 | 待执行 |
| 3 | 连通性验证通过后，切换生产环境 key | 待执行 |
| 4 | 搭建产品数据获取 → 清洗 → 存储流程 | 待规划 |
| 5 | 接入 AI 优化模块（文案 + 图片） | 待规划 |
| 6 | 接入亚马逊 SP-API 上传模块 | 待规划 |
| 7 | 扩展至沃尔玛、Wayfair | 待规划 |

---

*文档生成时间：2026-06-24*
