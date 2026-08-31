import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PlusHomeShell, type PlusTurn } from '../src/PlusShell'
import '../src/index.css'

const turns: PlusTurn[] = [
  { id: 'user-1', role: 'user', text: '你好，请用一句话说明你能做什么。' },
  {
    id: 'assistant-1',
    role: 'assistant',
    text: '我可以帮你回答问题、分析信息、写作翻译、制定计划，并协助你完成各种实际任务。\n\n**Markdown 验证**\n\n- 支持有序和无序列表\n- 支持 `inline code` 与链接\n\n```ts\nconst answer = "ready"\n```',
  },
]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlusHomeShell
      accountName="Visual Fixture"
      activeConversationId="fixture"
      conversations={[{ id: 'fixture', title: 'Conversation visual fixture' }]}
      initials="VF"
      planLabel="Plus"
      planVariant="plus"
      turns={turns}
    />
  </StrictMode>,
)
