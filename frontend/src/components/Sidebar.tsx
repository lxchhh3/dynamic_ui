import { LogOut, ShieldCheck, UserRound, Eye } from 'lucide-react'
import { useAuth, type Role } from '../stores/authStore'

const ROLE_ICON: Record<Role, typeof UserRound> = {
  admin: ShieldCheck,
  user: UserRound,
  guest: Eye,
}

const ROLE_STYLE: Record<Role, string> = {
  admin: 'text-amber-300 bg-amber-300/10 border-amber-300/30',
  user: 'text-gate-accent bg-gate-accent/10 border-gate-accent/30',
  guest: 'text-gate-muted bg-gate-muted/10 border-gate-muted/30',
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  if (!user) return null
  const Icon = ROLE_ICON[user.role]

  return (
    <aside className="w-64 shrink-0 border-r border-gate-border p-5 flex flex-col gap-5">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-gate-muted">custom_ui</div>
        <div className="text-lg font-semibold text-gate-text mt-0.5">gate control</div>
        <div className="text-xs text-gate-muted font-mono mt-1">scenario 1 · security gates</div>
      </div>

      <div className={`rounded-xl border p-3 ${ROLE_STYLE[user.role]}`}>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={15} />
          <span className="text-xs uppercase tracking-widest">{user.role}</span>
        </div>
        <div className="text-gate-text font-medium truncate">{user.username}</div>
      </div>

      <div className="flex-1" />

      <button
        onClick={logout}
        className="flex items-center justify-center gap-2 text-sm text-gate-muted hover:text-gate-text border border-gate-border hover:border-gate-locked/60 hover:bg-gate-locked/5 rounded-lg px-3 py-2 transition-colors"
      >
        <LogOut size={14} />
        sign out
      </button>
    </aside>
  )
}
