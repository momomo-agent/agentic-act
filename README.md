# agentic-act

AI 意图执行引擎 — 多模态输入 → 结构化行动决策

## 核心概念

**act 不负责"怎么做"，它只回答"做什么"。**

输入一个意图（文字/图片/语音/传感器数据），act 从你注册的行动选项中选择最合适的一个，填好参数返回。执行是你的事。

## 安装

```html
<script src="agentic-act.js"></script>
```

```js
const { AgenticAct } = require('./agentic-act.js')
```

## 用法

```js
const act = new AgenticAct({
  provider: 'openai',
  apiKey: 'sk-...',
  actions: [
    {
      id: 'voice',
      name: '语音播报',
      description: '通过音箱语音告知',
      schema: { content: 'string', volume: 'low|normal' },
      when: '用户没在看屏幕',
      handler: async (params) => await speaker.say(params.content)
    },
    {
      id: 'notification',
      name: '屏幕通知',
      description: '屏幕弹出通知',
      schema: { title: 'string', body: 'string' },
      when: '用户在看屏幕'
    }
  ]
})

// 只决策
const decision = await act.decide({
  text: '外卖到了',
  image: cameraFrameBase64
})
// → { action: 'voice', params: { content: '外卖到楼下了', volume: 'low' }, reason: '...' }

// 决策 + 执行
const result = await act.run({ text: '会议要开始了' })
// → { action: 'voice', params: {...}, executed: true, output: {...} }
```

## API

### `new AgenticAct(config)`

| 参数 | 类型 | 说明 |
|------|------|------|
| provider | string | `'openai'` \| `'anthropic'` |
| apiKey | string | API 密钥 |
| baseUrl | string? | 自定义接口地址 |
| model | string? | 模型名 |
| actions | Action[] | 注册的行动选项 |
| systemPrompt | string? | 自定义决策 prompt |

### Action

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 显示名 |
| description | string | 让 LLM 理解这个行动做什么 |
| schema | object? | 参数结构 |
| when | string? | 适用场景描述（自然语言） |
| handler | function? | 执行方法，传入 params |

### `act.decide(input)` → Decision

输入：多模态，全部可选，至少一个

| 字段 | 类型 | 说明 |
|------|------|------|
| text | string? | 文字意图 |
| image | string? | base64 图片 |
| audio | string? | base64 音频 |
| sense | object? | agentic-sense 数据 |
| context | object? | 任意附加上下文 |
| ...any | any | 任意额外字段 |

### `act.run(input)` → Decision

同 decide，但如果选中的 action 有 handler，会自动执行。

### Decision

```js
{
  action: 'voice',           // 选中的 action id
  params: { ... },           // 填好的参数
  reason: '...',             // 决策理由
  confidence: 0.85,          // 置信度
  alternative: { ... },      // 备选方案
  executed: true,            // 是否已执行
  output: { ... }            // handler 返回值
}
```

## 设计哲学

- **tools = 输入扩展**（AI 调外部能力获取信息）
- **actions = 输出扩展**（AI 选外部通道输出信息）
- act 是 AI 意志的投射，不是能力的延伸
