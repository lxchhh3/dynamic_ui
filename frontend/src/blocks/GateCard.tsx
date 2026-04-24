import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Unlock, Link as ChainIcon, Check } from 'lucide-react'

export type GateStatus = 'open' | 'closed' | 'locked'
export type GateAnimation = 'opening' | 'closing' | 'locking' | 'unlocking' | 'denied'

export interface GateCardProps {
  id: number
  label: string
  status: GateStatus
  animate?: GateAnimation
  onClick?: () => void
}

const colorFor = (status: GateStatus) => {
  switch (status) {
    case 'open':
      return { doors: '#1f2937', trim: '#22c55e', bg: 'rgba(34,197,94,0.08)' }
    case 'locked':
      return { doors: '#2a1216', trim: '#ef4444', bg: 'rgba(239,68,68,0.08)' }
    case 'closed':
    default:
      return { doors: '#1e2432', trim: '#6c8cff', bg: 'rgba(108,140,255,0.08)' }
  }
}

const doorSpring = { type: 'spring' as const, stiffness: 140, damping: 16, mass: 0.8 }

export default function GateCard({ id, label, status, animate, onClick }: GateCardProps) {
  const isOpen = status === 'open'
  const isLocked = status === 'locked'
  const c = colorFor(status)

  const shake =
    animate === 'denied'
      ? { x: [0, -8, 8, -6, 6, -3, 3, 0], rotate: [0, -0.6, 0.6, -0.4, 0.4, 0, 0, 0] }
      : undefined

  return (
    <motion.div
      layout
      onClick={onClick}
      className="relative overflow-hidden rounded-xl surface p-4 select-none cursor-pointer"
      style={{ boxShadow: isOpen ? '0 0 24px rgba(34,197,94,0.25)' : isLocked ? '0 0 24px rgba(239,68,68,0.25)' : undefined }}
      animate={shake}
      transition={shake ? { duration: 0.55, ease: 'easeOut' } : undefined}
      whileHover={{ y: -2 }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-gate-muted tracking-wider uppercase">Gate #{id}</div>
          <div className="text-base font-medium text-gate-text">{label}</div>
        </div>
        <StatusPill status={status} />
      </div>

      <div
        className="relative mx-auto w-full aspect-square max-w-[220px] rounded-lg overflow-hidden"
        style={{ background: c.bg }}
      >
        <svg viewBox="0 0 240 240" className="w-full h-full">
          {/* ground line */}
          <line x1="10" y1="218" x2="230" y2="218" stroke={c.trim} strokeOpacity="0.3" strokeWidth="2" />

          {/* top arch beam */}
          <rect x="28" y="34" width="184" height="14" rx="2" fill={c.trim} fillOpacity="0.75" />

          {/* posts */}
          <rect x="28" y="34" width="14" height="186" fill={c.trim} fillOpacity="0.85" />
          <rect x="198" y="34" width="14" height="186" fill={c.trim} fillOpacity="0.85" />

          {/* left door: hinged on x=42 — scales toward the post when opening */}
          <motion.g
            style={{ transformOrigin: '42px 130px', transformBox: 'fill-box' as const }}
            animate={{ scaleX: isOpen ? 0.12 : 1 }}
            transition={doorSpring}
          >
            <rect x="42" y="48" width="78" height="170" fill={c.doors} stroke={c.trim} strokeWidth="2" />
            {/* slat lines */}
            {[72, 96, 120, 144, 168, 192].map((y) => (
              <line key={y} x1="46" y1={y} x2="116" y2={y} stroke={c.trim} strokeOpacity="0.28" strokeWidth="1" />
            ))}
            {/* handle */}
            <circle cx="110" cy="134" r="3.2" fill={c.trim} />
          </motion.g>

          {/* right door: hinged on x=198 — scales toward the post when opening */}
          <motion.g
            style={{ transformOrigin: '198px 130px', transformBox: 'fill-box' as const }}
            animate={{ scaleX: isOpen ? 0.12 : 1 }}
            transition={doorSpring}
          >
            <rect x="120" y="48" width="78" height="170" fill={c.doors} stroke={c.trim} strokeWidth="2" />
            {[72, 96, 120, 144, 168, 192].map((y) => (
              <line key={y} x1="124" y1={y} x2="194" y2={y} stroke={c.trim} strokeOpacity="0.28" strokeWidth="1" />
            ))}
            <circle cx="130" cy="134" r="3.2" fill={c.trim} />
          </motion.g>

          {/* floor shadow widening on open — adds visible cue */}
          <motion.ellipse
            cx="120"
            cy="218"
            rx="60"
            ry="3"
            fill={c.trim}
            fillOpacity="0.25"
            animate={{ scaleX: isOpen ? 1.15 : 0.55, opacity: isOpen ? 0.5 : 0.2 }}
            transition={doorSpring}
            style={{ transformOrigin: '120px 218px', transformBox: 'fill-box' as const }}
          />

          {/* chain overlay — locked only */}
          <AnimatePresence>
            {isLocked && (
              <motion.g
                key="chain"
                initial={{ opacity: 0, scale: 0.6, rotate: -6 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 180, damping: 16 }}
              >
                <line x1="50" y1="60" x2="190" y2="200" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" />
                <line x1="190" y1="60" x2="50" y2="200" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" />
              </motion.g>
            )}
          </AnimatePresence>
        </svg>

        {/* center icon badge */}
        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0, scale: 0.6, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: -4 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div
              className="rounded-full p-2.5"
              style={{
                background: isOpen
                  ? 'rgba(34,197,94,0.18)'
                  : isLocked
                    ? 'rgba(239,68,68,0.18)'
                    : 'rgba(108,140,255,0.18)',
              }}
            >
              {isOpen ? (
                <Check size={20} color="#22c55e" />
              ) : isLocked ? (
                <ChainIcon size={20} color="#ef4444" />
              ) : (
                <Lock size={20} color="#6c8cff" />
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* success pulse ring on open */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="pulse"
              initial={{ opacity: 0.45, scale: 0.9 }}
              animate={{ opacity: 0, scale: 1.25 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
              className="absolute inset-0 rounded-lg pointer-events-none"
              style={{ boxShadow: '0 0 0 3px rgba(34,197,94,0.5) inset' }}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 text-xs text-gate-muted font-mono">
        {isOpen ? 'Access granted — gate open' : isLocked ? 'Locked — admin override required' : 'Secured — awaiting authorization'}
      </div>
    </motion.div>
  )
}

function StatusPill({ status }: { status: GateStatus }) {
  const styles: Record<GateStatus, { bg: string; text: string; label: string; Icon: typeof Lock }> = {
    open: { bg: 'bg-gate-open/15', text: 'text-gate-open', label: 'Open', Icon: Unlock },
    closed: { bg: 'bg-gate-closed/15', text: 'text-gate-closed', label: 'Closed', Icon: Lock },
    locked: { bg: 'bg-gate-locked/15', text: 'text-gate-locked', label: 'Locked', Icon: ChainIcon },
  }
  const s = styles[status]
  const Icon = s.Icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <Icon size={12} />
      {s.label}
    </span>
  )
}
