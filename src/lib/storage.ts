import type { ChatMessage, ChatState, Conversation } from '../types'

export const CHAT_STORAGE_KEY = 'chatgpt-replica:chat-state'
export const CHAT_STORAGE_VERSION = 1

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ChatStorageOptions {
  key?: string
  storage?: StorageLike | null
}

interface StoredChatState {
  version: number
  state: ChatState
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.status === 'streaming' ||
      value.status === 'complete' ||
      value.status === 'error')
  )
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    (value.model === undefined || typeof value.model === 'string') &&
    (value.pinned === undefined || typeof value.pinned === 'boolean')
  )
}

function isChatState(value: unknown): value is ChatState {
  if (!isRecord(value)) return false

  return (
    Array.isArray(value.conversations) &&
    value.conversations.every(isConversation) &&
    (value.activeConversationId === null ||
      typeof value.activeConversationId === 'string')
  )
}

function cloneState(state: ChatState): ChatState {
  return {
    activeConversationId: state.activeConversationId,
    conversations: state.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    })),
  }
}

export function createChatStorage(options: ChatStorageOptions = {}) {
  const key = options.key ?? CHAT_STORAGE_KEY
  const storage =
    options.storage === undefined ? getBrowserStorage() : options.storage

  return {
    load(fallback: ChatState): ChatState {
      if (!storage) return cloneState(fallback)

      try {
        const raw = storage.getItem(key)
        if (!raw) return cloneState(fallback)

        const stored: unknown = JSON.parse(raw)
        if (
          !isRecord(stored) ||
          stored.version !== CHAT_STORAGE_VERSION ||
          !isChatState(stored.state)
        ) {
          return cloneState(fallback)
        }

        return cloneState(stored.state)
      } catch {
        return cloneState(fallback)
      }
    },

    save(state: ChatState): boolean {
      if (!storage) return false

      try {
        const payload: StoredChatState = {
          version: CHAT_STORAGE_VERSION,
          state: cloneState(state),
        }
        storage.setItem(key, JSON.stringify(payload))
        return true
      } catch {
        return false
      }
    },

    clear(): boolean {
      if (!storage) return false

      try {
        storage.removeItem(key)
        return true
      } catch {
        return false
      }
    },
  }
}

export const chatStorage = createChatStorage()
