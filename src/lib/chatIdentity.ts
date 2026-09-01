export const GUEST_CHAT_ROUTE = '/api/chat/completions'
export const AUTHENTICATED_CHAT_ROUTE = '/api/chat/authenticated/completions'
export const VERIFIED_CHAT_IDENTITY = 'verified-session'

export class ChatTransportError extends Error {
  readonly status: number
  readonly code: string
  readonly requiresReauthentication: boolean

  constructor(
    message: string,
    {
      status = 0,
      code = 'chat_request_failed',
      requiresReauthentication = false,
    }: {
      status?: number
      code?: string
      requiresReauthentication?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'ChatTransportError'
    this.status = status
    this.code = code
    this.requiresReauthentication = requiresReauthentication
  }
}

/**
 * Keep the legacy environment value compatible for anonymous callers, while
 * never allowing it to override the strict same-origin route for a signed-in
 * UI. A custom URL may still be used, but must return the verified identity
 * header or the transport will fail closed.
 */
export function resolveChatApiUrl(
  configuredApiUrl: string | undefined,
  requireAuthentication: boolean,
) {
  const configured = configuredApiUrl?.trim()
  if (requireAuthentication && (!configured || configured === GUEST_CHAT_ROUTE)) {
    return AUTHENTICATED_CHAT_ROUTE
  }
  return configured || GUEST_CHAT_ROUTE
}

export function hasVerifiedChatIdentity(headers: Pick<Headers, 'get'>) {
  return headers.get('X-ChatGPT-Identity-Mode') === VERIFIED_CHAT_IDENTITY
}

export function requiresChatReauthentication(error: unknown): error is ChatTransportError {
  return error instanceof ChatTransportError && error.requiresReauthentication
}
