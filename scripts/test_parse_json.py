"""
独立测试 _try_parse_json —— 不导入 app.py,避免触发 Key 加载/环境变量读取。
直接复制 app.py 里 _try_parse_json 的实现来测。
"""
import re
import json


def _try_parse_json(content):
    if not content or "{" not in content:
        return None
    m = re.search(r"```(?:json|JSON)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    candidate = m.group(1) if m else None
    if not candidate:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            candidate = content[start:end + 1]
    if not candidate:
        return None
    try:
        obj = json.loads(candidate)
        return obj if isinstance(obj, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


# 5 种典型 AI 输出格式
cases = [
    # 1. 整段 JSON
    ('纯 JSON', '{"title": "T1", "bullets": ["a", "b"], "description": "D1", "search_terms": "s1"}'),
    # 2. ```json 包装
    ('json 代码块',
     '```json\n{"title": "T2", "bullets": ["x", "y"], "description": "D2", "search_terms": "s2"}\n```'),
    # 3. ``` 无语言
    ('裸代码块',
     '```\n{"title": "T3", "bullets": ["p"], "description": "D3", "search_terms": "s3"}\n```'),
    # 4. 前言 + JSON
    ('前言+JSON',
     '下面是 listing:\n{"title": "T4", "bullets": ["q"], "description": "D4", "search_terms": "s4"}\n谢谢'),
    # 5. 含 reasoning 残留(应该已经 strip 过,这里模拟一个错误格式)
    ('损坏 JSON',
     '{"title": "T5", broken'),
]

passed = 0
for name, text in cases:
    obj = _try_parse_json(text)
    if obj is None:
        # 损坏 JSON 应该 None
        if name == '损坏 JSON':
            print(f'  [PASS] {name}: 正确返回 None')
            passed += 1
        else:
            print(f'  [FAIL] {name}: 期望解析出 dict,得到 None')
    else:
        t = obj.get('title', '')
        b = obj.get('bullets', [])
        print(f'  [PASS] {name}: title={t!r}, bullets={b}')
        passed += 1

print()
print(f'通过: {passed}/{len(cases)}')