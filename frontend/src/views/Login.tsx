import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { Loader2, LogIn, UserPlus } from 'lucide-react'
import { useAuth } from '../stores/authStore'

type Mode = 'login' | 'register'

export default function Login() {
  const { login, register, loading, error } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
    } catch {
      /* error surfaced via store */
    }
  }

  async function pickDemo(u: string, p: string) {
    // Bypass the form + Chrome password manager by calling login directly.
    setUsername(u)
    setPassword(p)
    setMode('login')
    try {
      await login(u, p)
    } catch {
      /* error surfaced via store */
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="surface rounded-2xl p-7 shadow-xl">
          <div className="text-[11px] uppercase tracking-widest text-gate-muted">custom_ui</div>
          <h1 className="text-xl font-semibold text-gate-text mt-1">
            {mode === 'login' ? 'sign in' : 'create account'}
          </h1>
          <p className="text-sm text-gate-muted mt-1 font-mono">scenario 1 · gate control</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <Field label="username">
              <input
                name="cu-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                data-lpignore="true"
                className="w-full bg-gate-bg border border-gate-border rounded-lg px-3 py-2 text-sm text-gate-text outline-none focus:border-gate-accent"
              />
            </Field>
            <Field label="password">
              <input
                type="password"
                name="cu-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                data-lpignore="true"
                className="w-full bg-gate-bg border border-gate-border rounded-lg px-3 py-2 text-sm text-gate-text outline-none focus:border-gate-accent"
              />
            </Field>

            {error && (
              <div className="text-xs text-gate-locked bg-gate-locked/10 border border-gate-locked/30 rounded-md px-2.5 py-1.5">
                {error}
              </div>
            )}

            <motion.button
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-10 rounded-lg bg-gate-accent text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gate-accent/90 transition-colors"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : mode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
              {mode === 'login' ? 'sign in' : 'register'}
            </motion.button>
          </form>

          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="mt-4 text-xs text-gate-muted hover:text-gate-text transition-colors"
          >
            {mode === 'login' ? "need an account? register" : 'have an account? sign in'}
          </button>
        </div>

        <div className="mt-5 text-[11px] text-gate-muted font-mono px-2">
          <div className="mb-2 uppercase tracking-widest">demo logins</div>
          <div className="space-y-1">
            <DemoChip username="admin" password="admin123" role="admin" onPick={pickDemo} />
            <DemoChip username="IReallyRock" password="rockrock" role="user" onPick={pickDemo} />
            <DemoChip username="guest" password="guest" role="guest" onPick={pickDemo} />
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-gate-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function DemoChip({
  username,
  password,
  role,
  onPick,
}: {
  username: string
  password: string
  role: string
  onPick: (u: string, p: string) => void
}) {
  return (
    <button
      onClick={() => onPick(username, password)}
      className="w-full flex items-center justify-between gap-2 border border-gate-border rounded-md px-2.5 py-1.5 hover:border-gate-accent/60 hover:bg-gate-accent/5 transition-colors text-left"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-gate-text">{username}</span>
        <span className="text-gate-muted/60">·</span>
        <span className="text-gate-muted">{password}</span>
      </span>
      <span className="text-[10px] uppercase tracking-wider text-gate-muted">{role}</span>
    </button>
  )
}
