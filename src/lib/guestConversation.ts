export const CONVERSATION_STICK_THRESHOLD_PX = 96

export type ConversationScrollMetrics = {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export function conversationDistanceFromBottom({
  clientHeight,
  scrollHeight,
  scrollTop,
}: ConversationScrollMetrics) {
  return Math.max(0, scrollHeight - clientHeight - scrollTop)
}

export function shouldStickToConversationBottom(
  metrics: ConversationScrollMetrics,
  threshold = CONVERSATION_STICK_THRESHOLD_PX,
) {
  return conversationDistanceFromBottom(metrics) <= threshold
}

export function guestAssistantTurnUi({
  hasText,
  isGenerating,
  isLastTurn,
}: {
  hasText: boolean
  isGenerating: boolean
  isLastTurn: boolean
}) {
  const streaming = isGenerating && isLastTurn
  return {
    streaming,
    showActions: hasText && !streaming,
  }
}
