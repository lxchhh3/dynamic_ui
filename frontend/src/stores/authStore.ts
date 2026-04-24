import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, ApiError } from '../api/client'

export type Role = 'guest' | 'user' | 'admin'

export interface AuthUser {
  id: number
  username: string
  role: Role
  created_at: string
}

interface TokenResponse {
  token: string
  user: AuthUser
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      loading: false,
      error: null,
      async login(username, password) {
        set({ loading: true, error: null })
        try {
          const res = await api<TokenResponse>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          })
          set({ token: res.token, user: res.user, loading: false, error: null })
        } catch (err) {
          const msg = err instanceof ApiError ? err.detail : String(err)
          set({ loading: false, error: msg })
          throw err
        }
      },
      async register(username, password) {
        set({ loading: true, error: null })
        try {
          const res = await api<TokenResponse>('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          })
          set({ token: res.token, user: res.user, loading: false, error: null })
        } catch (err) {
          const msg = err instanceof ApiError ? err.detail : String(err)
          set({ loading: false, error: msg })
          throw err
        }
      },
      logout() {
        set({ token: null, user: null, error: null })
      },
    }),
    { name: 'custom_ui.auth' },
  ),
)
