import { motion } from 'framer-motion'
import { ClipboardCheck, Clock4, ShieldCheck, ShieldX, Ban, UserRound } from 'lucide-react'

export type RequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled'

export interface RequestCardProps {
  id: number
  gateId: number
  gateLabel: string
  requester: string
  reason?: string | null
  status: RequestStatus
  decidedBy?: string | null
  decidedAt?: string | null
  createdAt?: string | null
}

const STATUS_META: Record<
  RequestStatus,
  { label: string; pill: string; Icon: typeof Clock4; accent: string }
> = {
  pending: {
    label: 'Pending',
    pill: 'text-skin-accent-deep bg-skin-accent/15 ring-1 ring-skin-accent/40',
    Icon: Clock4,
    accent: 'border-skin-accent/50',
  },
  approved: {
    label: 'Approved',
    pill: 'text-skin-success bg-skin-success/15 ring-1 ring-skin-success/30',
    Icon: ShieldCheck,
    accent: 'border-skin-success/40',
  },
  denied: {
    label: 'Denied',
    pill: 'text-skin-danger bg-skin-danger/15 ring-1 ring-skin-danger/30',
    Icon: ShieldX,
    accent: 'border-skin-danger/40',
  },
  cancelled: {
    label: 'Cancelled',
    pill: 'text-skin-muted bg-skin-muted/15 ring-1 ring-skin-muted/30',
    Icon: Ban,
    accent: 'border-skin-muted/40',
  },
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function RequestCard(props: RequestCardProps) {
  const {
    id,
    gateId,
    gateLabel,
    requester,
    reason,
    status,
    decidedBy,
    decidedAt,
    createdAt,
  } = props
  const meta = STATUS_META[status]
  const Icon = meta.Icon
  const created = fmtDate(createdAt)
  const decided = fmtDate(decidedAt)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`surface rounded-xl p-4 max-w-md border-l-2 ${meta.accent}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm text-skin-muted font-mono">
          <ClipboardCheck size={15} className="text-skin-accent" />
          <span>request #{id}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.pill}`}
        >
          <Icon size={12} />
          {meta.label}
        </span>
      </div>

      <div className="text-base text-skin-ink mb-1">
        gate <span className="font-medium">#{gateId}</span> — {gateLabel}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-skin-muted mb-2">
        <UserRound size={12} />
        <span>requested by {requester}</span>
        {created && <span className="text-skin-muted/60">· {created}</span>}
      </div>

      {reason ? (
        <div className="text-sm text-skin-ink/90 italic border-l-2 border-skin-border pl-3 my-2">
          "{reason}"
        </div>
      ) : (
        <div className="text-xs text-skin-muted/70 italic mb-2">no reason provided</div>
      )}

      {decidedBy && status !== 'pending' && (
        <div className="text-xs text-skin-muted mt-2 pt-2 border-t border-skin-border">
          {meta.label.toLowerCase()} by {decidedBy}
          {decided && <> · {decided}</>}
        </div>
      )}
    </motion.div>
  )
}
