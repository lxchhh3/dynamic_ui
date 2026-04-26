import { LogOut, ShieldCheck, UserRound, Eye } from 'lucide-react'
import { useAuth, type Role } from '../stores/authStore'

const ROLE_ICON: Record<Role, typeof UserRound> = {
  admin: ShieldCheck,
  user: UserRound,
  guest: Eye,
}

const ROLE_STYLE: Record<Role, string> = {
  admin: 'text-skin-danger bg-skin-danger/10 border-skin-danger/30',
  user: 'text-skin-accent-deep bg-skin-accent/15 border-skin-accent/40',
  guest: 'text-skin-muted bg-skin-muted/10 border-skin-muted/30',
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  if (!user) return null
  const Icon = ROLE_ICON[user.role]

  return (
    <aside className="w-64 shrink-0 border-r border-skin-border p-5 flex flex-col gap-5">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-skin-muted">custom_ui</div>
        <div className="text-lg font-semibold text-skin-ink mt-0.5">gate control</div>
        <div className="text-xs text-skin-muted font-mono mt-1">scenario 1 · security gates</div>
      </div>

      <div className={`rounded-xl border p-3 ${ROLE_STYLE[user.role]}`}>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={15} />
          <span className="text-xs uppercase tracking-widest">{user.role}</span>
        </div>
        <div className="text-skin-ink font-medium truncate">{user.username}</div>
      </div>

      <div className="flex-1" />

      <button
        onClick={logout}
        className="flex items-center justify-center gap-2 text-sm text-skin-muted hover:text-skin-ink border border-skin-border hover:border-skin-danger/60 hover:bg-skin-danger/5 rounded-lg px-3 py-2 transition-colors"
      >
        <LogOut size={14} />
        sign out
      </button>
    </aside>
  )
}
