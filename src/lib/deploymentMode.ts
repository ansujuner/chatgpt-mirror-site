function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true'
}

/**
 * The native OpenAI OAuth client used by the local replica has a loopback-only
 * callback. A hosted build must not offer provider buttons that can never
 * return to the remote container; hosted users authenticate through the
 * existing Session verification flow instead.
 */
export const hostedSessionOnly = enabled(import.meta.env.VITE_HOSTED_SESSION_ONLY)
