import type { MockReplyRule } from '../types'

export const DEFAULT_MOCK_REPLY =
  '当然可以。当前页面运行的是本地演示回复，但会话历史、Markdown 渲染、流式输出和停止生成等交互都是真实可用的。你可以继续补充目标、限制条件和期望格式，我会据此给出更具体的方案。'

export const MOCK_REPLY_RULES: readonly MockReplyRule[] = [
  {
    id: 'greeting',
    keywords: ['hello', 'hi', 'hey', '你好', '您好'],
    response:
      '你好！今天想一起完成什么？这是一个本地运行的对话界面演示，你可以像使用常见 AI 助手一样继续提问。',
  },
  {
    id: 'image',
    keywords: ['image', 'picture', 'photo', 'draw', '图片', '图像', '画一张'],
    response: ({ prompt }) =>
      `我可以把“${prompt}”整理成一份清晰的图片提示词。\n\n建议从这些维度定义：\n\n- **主体**：画面中最重要的人物或物体\n- **构图**：视角、景别和视觉重心\n- **光线**：时间、方向与明暗氛围\n- **色彩**：主色、辅助色与对比关系\n- **风格**：摄影、插画、3D 或其他媒介\n\n补充使用场景和画面比例后，我还能继续给出可直接使用的完整提示词。`,
  },
  {
    id: 'code',
    keywords: ['code', 'javascript', 'typescript', 'python', '代码', '编程'],
    response:
      '可以。请告诉我需要实现的行为、技术栈和限制条件。我可以先给出实现思路，再编写代码，并逐步解释关键取舍。\n\n```ts\nfunction nextStep(goal: string) {\n  return `先把 ${goal} 拆成可验证的小步骤`\n}\n```',
  },
  {
    id: 'summary',
    keywords: ['summarize', 'summary', '总结', '摘要'],
    response:
      '把需要总结的内容发给我即可。我可以按你的用途输出：\n\n1. 一句话摘要\n2. 结构化要点\n3. 详细大纲\n4. 行动项与风险清单',
  },
  {
    id: 'plan',
    keywords: ['plan', 'itinerary', 'schedule', '计划', '规划', '行程'],
    response:
      '没问题。我会把目标拆成可执行的里程碑，标出依赖关系，并给出合理的先后顺序。告诉我可用时间、优先级和必须满足的限制，我就能把计划进一步具体化。',
  },
]
