# Amazon 模板填表数据默认值与缺失报告设计

## 目标

在现有 Amazon 模板填表 MVP 中明确自动填写边界：尽可能把 GIGA API 实际返回的数据填写到语义正确的 Amazon 字段，同时避免猜测数据；对于仍未填写的 Amazon 必填信息，以及 API 值无法满足模板允许选项的情况，生成可执行的运营报告。

## 数据来源优先级

每个模板单元格按以下顺序处理：

1. 模板中已有运营填写值：原样保留，不被 API 或默认值覆盖。
2. 对品牌和商品编码应用经业务明确批准的固定规则：仅限品牌 `GENERIC` 和商品编码类型 `GTIN Exempt`。
3. 其他 GIGA API 返回且能安全映射的值：写入对应 Amazon 字段。
4. 以上均无值：保持空白，不推测、不拼凑、不使用其他字段冒充。

`GENERIC` 和 `GTIN Exempt` 是业务规则，不视为 API 数据。

## 品牌规则

- Brand Name 已有模板值：保留模板值。
- Brand Name 为空：填写 `GENERIC`。
- 即使 API 返回其他品牌，现阶段也统一使用 `GENERIC`，除非运营已经在模板中填写品牌。

## UK 运营默认值

以下值是超哥明确指定的 Amazon UK 运营默认值；它们只写入模板空单元格，且必须通过该模板的下拉允许值校验：

- `condition_type`：`New`。
- `country_of_origin`：`China`。
- `batteries_required`：`No`。
- `batteries_included`：`No`。
- `supplier_declared_dg_hz_regulation`：`Not Applicable`。
- `fulfillment_availability#1.quantity`：GIGA `skuAvailable=true` 时写入 `5`，否则写入 `0`。这是业务默认库存，不是 GIGA 的实时库存数量。

Amazon 模板已有运营值仍优先保留。若模板下拉列表不包含上述默认值，保持空白并报告下拉不匹配，绝不绕开模板校验。

### UK CHAIR 运营必填策略

运营可对特定市场和类目增加模板 Data Definitions 以外的必填策略；这些规则绝不自动套用到其他模板。当前仅对 `UK + CHAIR` 生效：

- 必须报告并阻止上传：Number of Items、Is Assembly Required?、Size、Unit Count、Unit Count Type、Included Components（第一个槽位）、Is Fragile?、List Price with Tax、Merchant Shipping Group (UK)。
- Fulfillment Channel Code (UK) 仅在 CHAIR 模板允许值中存在精确 `DEFAULT` 时自动填写该值；不存在时同样报告为运营必填，绝不猜测履约渠道。
- CABINET 与未来类目不继承上述列表，继续依据其自身 Data Definitions 及后续单独批准的画像策略处理。

## GTIN 豁免规则

- Product Id Type 已有模板值：保留模板值。
- Product Id Type 为空：填写模板允许值中的精确文本 `GTIN Exempt`。
- 采用 GTIN 豁免时，Product Id 保持为空，不使用 GIGA 的 UPC，也不将 Product Id 报告为缺失。
- 如果模板不提供 `GTIN Exempt` 允许值，则不强行写入，报告 `dropdown_required`。
- 运营已经填写 Product Id Type 或 Product Id 时全部保留，由报告继续检查其合法性。

## API 映射规则

- 只映射当前系统明确支持且语义一致的字段，例如标题、型号、描述、五点、颜色、材质、尺寸、重量和原产国。
- API 返回空值时保持模板为空。
- API 返回值符合普通字段格式时写入。
- API 返回值对应下拉字段时，必须与模板允许值精确匹配，或通过已批准的单位别名匹配后才能写入。
- 不允许为了通过必填校验而生成、推断或复制不相关字段值。
- API 返回了系统尚未建立 Amazon 字段映射的数据时，不自动猜测列；后续通过显式映射扩展支持。

### 包装与库存边界

当前 GIGA 商品详情接口针对 CABINET 样例仅返回已装配尺寸和重量（`assembledLength`、`assembledWidth`、`assembledHeight`、`assembledWeight`），不返回包装尺寸、包装重量、箱数、每箱数量或真实库存数量。已装配数据只可写入商品尺寸/重量字段，不可写入 `item_package_dimensions` 或 `item_package_weight`。

若未来 API 返回经过确认的包装字段，再单独建立包装字段映射；在此之前，包装字段保持空白。`skuAvailable` 只驱动上述 Quantity (UK) 业务默认值。

## 报告规则

填表后按最终单元格状态生成报告：

1. `missing_required`：Amazon 严格必填字段最终仍为空。
2. `conditional_attention`：Amazon 条件必填字段为空，且未被当前业务规则明确豁免。
3. `dropdown_required`：API 候选值与模板允许选项不一致，未写入，需要运营选择。
4. `invalid_existing_value`：运营已有值不在模板允许选项中。
5. `api_not_found`：GIGA API 未返回该 SKU。
6. `preserved`：运营已有值被保留，API 或默认值未覆盖。
7. `manual_attention`：运营明确要求保留空白、但需要后续处理的字段。
8. `business_required`：当前模板画像的运营规则要求填写，最终仍为空。

`upload_ready` 仅在没有严格缺失、下拉待选、SKU 查询失败或已有值非法时为真；Recommended Browse Nodes 和 Manufacturer 的 `manual_attention` 只提醒、不阻塞。

结果中另输出 `filled_fields`：每一项包含 SKU、Excel 行、Amazon 字段 ID、字段名、写入值和来源（`giga_api` 或 `business_default`）。页面先展示已填字段，再展示待处理项。

当字段因 `GTIN Exempt` 明确豁免时，不生成 Product Id 的缺失报告。对完全不适用的可选空字段不生成缺失报告，避免数百条无行动价值的信息。默认仅显示严格必填缺失、下拉不匹配、API 未找到 SKU，以及 `recommended_browse_nodes` 和 `manufacturer` 的人工提醒；其余条件必填字段不进入待处理列表。

## 填写流程

1. 读取模板现有值。
2. 获取 SKU 对应的 GIGA API 商品数据。
3. 计算所有支持字段的 API 候选值。
4. 应用运营值优先原则。
5. 对品牌和 Product Id Type 应用白名单固定值。
6. 对其他空白字段应用 API 候选值。
7. 对空白 UK 默认字段应用运营默认值。
8. 对 Recommended Browse Nodes 和 Manufacturer 生成留空提醒。
9. 按最终状态执行必填和下拉校验。
10. 写入 XLSM 并输出 JSON 报告和 filled_fields。

## 测试标准

- 空白品牌填写 `GENERIC`，即使 API 返回了其他品牌。
- 模板已有品牌时不覆盖。
- 空白 Product Id Type 填写 `GTIN Exempt`，Product Id 保持为空且不报缺失。
- 空白 Country of Origin、Item Condition、两项电池字段和 Quantity (UK) 写入运营指定默认值。
- `skuAvailable=true` 写入 Quantity (UK) `5`，`false` 写入 `0`。
- API 有可映射值时写入正确字段。
- API 缺失的严格必填字段保持为空并报告。
- API 候选值不在必填下拉选项中时保持为空并报告允许值。
- Recommended Browse Nodes 与 Manufacturer 即使模板标记为必填，也按运营规则保持空白并生成 `manual_attention`，不作为阻塞性缺失；其他未标注的条件字段不生成噪声报告。
- API 返回的已装配尺寸/重量不写入包装字段；包装字段缺失时保持空白。
- UI 显示每个 SKU 的已填写字段和值，再显示待处理字段。
- CABINET 和 CHAIR 两个真实模板均保持隐藏页、下拉校验及非目标 ZIP 部件不变。
- 全部既有后端和前端测试继续通过。

## 非目标

- 不生成 API 未返回的商品事实。
- 不自动选择无法确定的危险品类别、浏览节点或原产国。
- 不在本次调整中新增图片 CDN、父子变体扩展或 AI 文案生成。
- 不报告模板中所有不适用的可选空字段。
