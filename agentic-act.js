/**
 * agentic-act — AI 意图执行引擎
 * 
 * 多模态输入 → LLM 决策 → 结构化行动选择
 * 
 * act 不负责"怎么做"，它只回答"做什么"。
 * 执行是 consumer 的事，除非你注册了 handler。
 */

class AgenticAct {
  /**
   * @param {Object} config
   * @param {string} config.provider - 'openai' | 'anthropic'
   * @param {string} config.apiKey
   * @param {string} [config.baseUrl]
   * @param {string} [config.model]
   * @param {Array<Action>} config.actions - 注册的可选行动
   * @param {string} [config.systemPrompt] - 自定义决策 prompt（覆盖默认）
   */
  constructor(config) {
    this.provider = config.provider || 'openai';
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model || (this.provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
    this.actions = config.actions || [];
    this.customSystemPrompt = config.systemPrompt || null;
  }

  /**
   * 注册一个 action
   */
  register(action) {
    this.actions.push(action);
    return this;
  }

  /**
   * 只决策，不执行
   * @param {Object} input - 多模态输入（全部可选，至少一个）
   * @param {string} [input.text] - 文字意图
   * @param {string} [input.image] - base64 图片
   * @param {string} [input.audio] - base64 音频
   * @param {Object} [input.sense] - agentic-sense 结构化数据
   * @param {Object} [input.context] - 任意附加上下文
   * @returns {Promise<Decision>}
   */
  async decide(input) {
    const systemPrompt = this._buildSystemPrompt();
    const userContent = this._buildUserContent(input);
    const images = this._extractImages(input);

    const response = await this._callLLM(systemPrompt, userContent, images);

    let decision;
    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      decision = JSON.parse(cleaned);
    } catch {
      return {
        action: null,
        params: {},
        reason: response,
        raw: response,
        executed: false,
        error: 'Failed to parse LLM response as JSON'
      };
    }

    // Validate action exists
    const actionDef = this.actions.find(a => a.id === decision.action);
    if (!actionDef && decision.action) {
      decision.warning = `Action "${decision.action}" not found in registry`;
    }

    decision.executed = false;
    return decision;
  }

  /**
   * 决策 + 执行（如果 action 有 handler）
   * @param {Object} input - 同 decide()
   * @returns {Promise<Decision>} - 含 executed 和 output
   */
  async run(input) {
    const decision = await this.decide(input);
    if (!decision.action) return decision;

    const actionDef = this.actions.find(a => a.id === decision.action);
    if (actionDef?.handler) {
      try {
        decision.output = await actionDef.handler(decision.params);
        decision.executed = true;
      } catch (e) {
        decision.error = e.message;
        decision.executed = false;
      }
    }

    return decision;
  }

  // ── Internal ──

  _buildSystemPrompt() {
    if (this.customSystemPrompt) return this.customSystemPrompt;

    const actionsDesc = this.actions.map(a => {
      let desc = `- **${a.id}** (${a.name}): ${a.description}`;
      if (a.schema) desc += `\n  参数: ${JSON.stringify(a.schema)}`;
      return desc;
    }).join('\n\n');

    return `你是一个行动决策引擎。你接收多模态输入（文字、图片、传感器数据等），根据当前场景从预定义的行动选项中选择最合适的一个，并填写参数。

## 可选行动

${actionsDesc}

## 输出格式

返回 JSON（不要 markdown 包裹）：
{
  "action": "action_id",
  "params": { ... },
  "reason": "1-2 句话解释为什么选这个",
  "confidence": 0.0-1.0,
  "alternative": {
    "action": "备选 action_id",
    "reason": "什么情况下用备选"
  }
}

## 决策原则

- 优先不打扰：能不打断就不打断
- 匹配注意力：用户专注→轻量方式，用户空闲→可以直接
- 匹配形态：手忙→语音，看屏幕→视觉，走路→简短
- 紧急覆盖：真正紧急的事可以打断

所有描述用中文。只返回合法 JSON。`;
  }

  _buildUserContent(input) {
    const parts = [];

    if (input.text) parts.push(`意图: ${input.text}`);
    if (input.sense) parts.push(`感知数据: ${JSON.stringify(input.sense)}`);
    if (input.context) parts.push(`上下文: ${JSON.stringify(input.context)}`);
    if (input.audio) parts.push('[附带音频输入]');
    if (input.image) parts.push('请分析附带的图片场景。');

    // 允许任意额外字段
    for (const [key, val] of Object.entries(input)) {
      if (!['text', 'image', 'audio', 'sense', 'context'].includes(key)) {
        parts.push(`${key}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
      }
    }

    return parts.join('\n\n') || '请根据当前输入做出行动决策。';
  }

  _extractImages(input) {
    const images = [];
    if (input.image) {
      images.push({
        data: input.image,
        media_type: 'image/jpeg'
      });
    }
    return images;
  }

  async _callLLM(system, userContent, images) {
    if (this.provider === 'anthropic') {
      return this._callAnthropic(system, userContent, images);
    }
    return this._callOpenAI(system, userContent, images);
  }

  async _callOpenAI(system, userContent, images) {
    const url = (this.baseUrl || 'https://api.openai.com/v1') + '/chat/completions';
    const content = [];
    if (images.length) {
      images.forEach(img => {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${img.media_type};base64,${img.data}`, detail: 'low' }
        });
      });
    }
    content.push({ type: 'text', text: userContent });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }

  async _callAnthropic(system, userContent, images) {
    const url = (this.baseUrl || 'https://api.anthropic.com') + '/v1/messages';
    const content = [];
    if (images.length) {
      images.forEach(img => {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type, data: img.data }
        });
      });
    }
    content.push({ type: 'text', text: userContent });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        system,
        messages: [{ role: 'user', content }],
        max_tokens: 1024
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text || JSON.stringify(data);
  }
}

// ── Exports ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AgenticAct };
}
if (typeof window !== 'undefined') {
  window.AgenticAct = AgenticAct;
}
