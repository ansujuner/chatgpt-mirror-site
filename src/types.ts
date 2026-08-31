export type MessageRole = 'system' | 'user' | 'assistant'

export type MessageStatus = 'streaming' | 'complete' | 'error'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  status: MessageStatus
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
  model?: string
  pinned?: boolean
}

export interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
}

export interface PromptSuggestion {
  id: string
  title: string
  description: string
  prompt: string
  icon: 'image' | 'write' | 'learn' | 'plan'
}

export interface MockReplyContext {
  prompt: string
  messages: readonly ChatMessage[]
}

export type MockReplyFactory = (
  context: MockReplyContext,
) => string | Promise<string>

export interface MockReplyRule {
  id: string
  keywords: readonly string[]
  response: string | MockReplyFactory
}
