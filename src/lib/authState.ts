import type { AuthSessionSnapshot, SessionAccount } from './authSession'

export type AuthState =
  | { status: 'checking'; account: null }
  | { status: 'anonymous'; account: null }
  | { status: 'authenticated'; account: SessionAccount }

export function createInitialAuthState(forceAnonymous = false): AuthState {
  return forceAnonymous
    ? { status: 'anonymous', account: null }
    : { status: 'checking', account: null }
}

export function authStateFromSnapshot(snapshot: AuthSessionSnapshot): AuthState {
  return snapshot.authenticated && snapshot.user
    ? { status: 'authenticated', account: snapshot.user }
    : { status: 'anonymous', account: null }
}

export function authenticatedAuthState(account: SessionAccount): AuthState {
  return { status: 'authenticated', account }
}

export const ANONYMOUS_AUTH_STATE: AuthState = {
  status: 'anonymous',
  account: null,
}
