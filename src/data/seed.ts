import type { ChatState, PromptSuggestion } from '../types'

export const PROMPT_SUGGESTIONS: readonly PromptSuggestion[] = [
  {
    id: 'create-image',
    title: 'Create image',
    description: 'for my presentation',
    prompt: 'Create an image for my presentation',
    icon: 'image',
  },
  {
    id: 'help-write',
    title: 'Help me write',
    description: 'a thoughtful message',
    prompt: 'Help me write a thoughtful message',
    icon: 'write',
  },
  {
    id: 'learn-topic',
    title: 'Explain a topic',
    description: 'in simple terms',
    prompt: 'Explain a complex topic to me in simple terms',
    icon: 'learn',
  },
  {
    id: 'make-plan',
    title: 'Make a plan',
    description: 'for a productive week',
    prompt: 'Make a plan for a productive week',
    icon: 'plan',
  },
]

export function createInitialChatState(): ChatState {
  return {
    conversations: [],
    activeConversationId: null,
  }
}
