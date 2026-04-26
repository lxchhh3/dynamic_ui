import { motion } from 'framer-motion'
import { ShieldCheck, UserRound } from 'lucide-react'

interface Props {
  gateId: number
  gateLabel: string
  users: { username: string; role: string }[]
}

const ROLE_STYLES: Record<string, string> = {
  admin: 'text-skin-danger bg-skin-danger/10',
  user: 'text-skin-accent bg-skin-accent/10',
  guest: 'text-skin-muted bg-skin-muted/10',
}

export default function AccessList({ gateId, gateLabel, users }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="surface rounded-xl p-4 max-w-md"
    >
      <div className="flex items-center gap-2 text-sm text-skin-muted mb-3">
        <ShieldCheck size={15} className="text-skin-accent" />
        <span className="font-mono">access · gate #{gateId} — {gateLabel}</span>
      </div>
      {users.length === 0 ? (
        <div className="text-sm text-skin-muted italic">no users currently permitted</div>
      ) : (
        <ul className="space-y-1.5">
          {users.map((u) => (
            <li key={u.username} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-skin-ink text-sm">
                <UserRound size={13} className="text-skin-muted" />
                {u.username}
              </span>
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${ROLE_STYLES[u.role] ?? ''}`}>
                {u.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}
