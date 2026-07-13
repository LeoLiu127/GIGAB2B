# 变体采集结果提示设计

## 目标

模板填表结果必须明确区分：

1. 已取得完整商品详情、可作为 Amazon 子体写入模板的有效 SKU；
2. GIGA 关联列表中出现、但商品详情接口无法查询的额外关联编号。

用户不应将第二类编号误解为遗漏的有效变体。

## 判定口径

- `expected_children`：进入变体主题推断与模板物化的有效 SKU 数，即已取得完整商品详情的主 SKU 与有效关联 SKU 数量。
- `actual_children`：最终生成的 Amazon Child 行数量。
- `skipped_association_skus`：GIGA 原始关联列表中存在、但没有取得可用商品详情的编号；这些编号不计入 `expected_children`。
- `collection_status`：
  - `complete`：`actual_children == expected_children`；
  - `incomplete`：`actual_children < expected_children`。

当有效 SKU 详情不完整、变体主题无法确认或模板物化失败时，现有阻断规则继续生效。额外不可访问关联编号本身只产生 warning，不把一个已经完整生成的有效变体组改成 blocked。

## 接口与兼容性

`variant_groups` 中增加以下可选字段：

- `expected_children`
- `actual_children`
- `skipped_association_skus`
- `collection_status`

后端的 Listing 采集结果保留结构化的 `skipped_skus`，不再要求下游从中文 warning 字符串中解析 SKU。现有 `message` 字段继续保留，供旧前端兼容；新前端优先使用结构化字段生成提示。旧后端未返回新字段时，前端沿用兼容逻辑且不得报错。

## 页面文案

完整且没有额外关联编号：

> 采集完整：预计 3 个有效子体，实际生成 3 个子体。

完整但存在额外不可访问关联编号：

> 采集完整：预计 3 个有效子体，实际生成 3 个子体。GIGA 另返回 2 个无法查询商品详情的关联编号，未计入有效子体：W5807P482051、W5807P482049。

不完整：

> 采集不完整：预计 3 个有效子体，实际仅生成 2 个子体。

问题列表中的 warning 名称由“已忽略无效关联 SKU”改为“额外关联编号无法查询”。不得把无法查询的编号直接断言为无效商品、父体或历史记录。

## 测试

- 后端验证完整组的预计数量等于实际 Child 行数。
- 后端验证额外不可访问编号以结构化数组返回，且不计入预计有效子体数。
- 后端验证有效子体缺失时仍阻断，不生成误导性的“采集完整”。
- 前端验证完整、带额外关联编号、不完整和旧接口四种提示。
- 使用 `CABINET-UK-1SKU.xlsm` 与 `CHAIR-UK-1SKU.xlsm` 真实调用回归，核对父子行数、变体主题和提示文案。

