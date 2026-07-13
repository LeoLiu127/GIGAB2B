# Amazon 模板引擎复用 main 变体采集设计

## 背景与问题

main 分支的 `giga_fetch_listing` 已负责从 `associateProductList` 与 `comboInfo` 发现候选 SKU、批量获取详情，并过滤 GIGA 不可访问或空的关联记录。现有工作台使用该结果时，CABINET SKU `N890P39984041W` 正确得到两个有效变体。

模板引擎后来新增的 `giga_fetch_listing_products` 重复解析原始关联列表，并将所有未返回的候选 SKU 视为真实变体详情缺失。对于同一 CABINET，它把两个返回 `B20003` 的历史或区域受限关联误判为致命缺失，导致整组 `blocked`。

## 目标

- 模板引擎复用 main 已验证的 Listing 采集结果，不维护第二套变体发现逻辑。
- CABINET 当前两个有效 SKU 能展开为一个 Parent 和两个 Child。
- `B20003`、空记录等不可用关联只产生非阻断提醒。
- 真正的批量请求失败、超过 200 个 SKU、有效集合详情不完整仍然阻断。
- 不改变现有工作台、`/api/fetch-listing`、GIGA API 签名和前端消费契约。

## 设计

### 1. 向后兼容地扩展 `giga_fetch_listing`

保留所有现有返回字段及行为，增加仅供内部调用的元数据：

- `raw_products`：主 SKU 与所有可用 sibling 的完整 GIGA 原始详情，保持 Listing 顺序；
- `requested_skus`：去重后的原始候选集合；
- `skipped_skus`：批量接口未返回或只返回空记录的候选；
- `truncated`：候选是否超过 GIGA 单次 200 SKU 上限；
- `fetch_error`：批量请求是否发生异常。

`/api/fetch-listing` 继续只选择并返回原有公开字段，因此不会把内部原始详情或新元数据暴露给现有前端。

### 2. 模板适配器只做契约转换

`giga_fetch_listing_products` 改为调用 `giga_fetch_listing`，不再直接读取 `associateProductList` 或再次调用批量详情接口。它将共享采集结果转换为模板引擎的 `ListingProducts` 契约：

- `requested_skus` 使用有效 `raw_products` 的 SKU，而不是原始候选；
- `products` 使用完整原始详情，满足库存、包装、重量、原产国、电池和图片字段映射；
- `skipped_skus` 写入 `ListingProducts.warning`，但不放入 `missing_skus`；
- `fetch_error` 转换为 `variant_fetch_incomplete` 阻断；
- `truncated` 转换为 `variant_group_too_large` 阻断。

### 3. 报告语义

有效组成功展开时，增加 `variant_associations_skipped` warning，内容类似“忽略 2 个 GIGA 不可访问关联 SKU”，并在成功的 `VariantGroup.message` 中保留同一说明。该状态不得计入 `groups_blocked` 或令 `upload_ready=false`。提醒中保留具体 SKU，便于运营核对。

网络异常、HTTP/JSON 错误、批量请求整体失败仍是错误，不得降级成只处理主 SKU。

## 数据流

```text
种子 SKU
  -> giga_fetch_listing（唯一采集入口）
     -> 原始关联候选
     -> 批量详情
     -> 可用 raw_products + skipped_skus + fetch_error/truncated
        -> 原工作台：转换为精简 variant view
        -> 模板引擎：转换为 ListingProducts，推断主题并生成父子行
```

## 测试

1. 原始关联为 A、B、C、D，批量详情仅返回 A、B：模板适配器得到 A、B 两个有效 SKU，C、D 进入非阻断提醒。
2. 上述集合展开为一个 Parent 和两个 Child，不产生 `variant_fetch_incomplete`。
3. C、D 生成 `variant_associations_skipped` warning，但不改变 `upload_ready`。
4. 批量请求抛异常时，模板引擎保留种子行并产生 `variant_fetch_incomplete`。
5. 超过 200 个候选时仍产生 `variant_group_too_large`。
6. 原 `/api/fetch-listing` 的字段和两个有效变体结果保持不变。
7. CABINET `N890P39984041W` 真实端到端填表不再因两个 `B20003` 关联而 blocked。

## Git 与合并边界

改动只发生在当前功能分支。main 当前是本分支祖先，现有公共接口保持兼容。正式合并前先处理 main 工作区未提交文件；若 main 出现新提交，则先将 main 合入功能分支、在功能分支解决冲突并完成全部验证，再合回 main。
