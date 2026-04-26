import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Lock, Check, Minus } from 'lucide-react'

export type GateStatus = 'open' | 'closed' | 'locked'
export type GateAnimation = 'opening' | 'closing' | 'locking' | 'unlocking' | 'denied'

export interface GateCardProps {
  id: number
  label: string
  status: GateStatus
  animate?: GateAnimation
  onClick?: () => void
}

const TAG_HEX: Record<GateStatus, string> = {
  open: '#8B9D5A',
  closed: '#D89B7A',
  locked: '#C9543E',
}

const CIRCLE_HEX: Record<GateStatus, string> = {
  open: '#8B9D5A',
  closed: '#C9543E',
  locked: '#C9543E',
}

const colorTransition = { duration: 0.32, ease: 'easeOut' as const }

export default function GateCard({ id, label, status, animate, onClick }: GateCardProps) {
  const reduced = useReducedMotion()
  const isOpen = status === 'open'
  const isLocked = status === 'locked'

  const shake =
    !reduced && animate === 'denied'
      ? { x: [0, -8, 8, -6, 6, -3, 3, 0] }
      : undefined

  return (
    <motion.div
      layout
      onClick={onClick}
      className="relative select-none"
      whileHover={onClick ? { y: -1 } : undefined}
      data-testid={`gate-row-${id}`}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-md translate-x-1.5 translate-y-1.5"
        initial={false}
        animate={{ backgroundColor: TAG_HEX[status] }}
        transition={reduced ? { duration: 0 } : colorTransition}
      />
      <motion.div
        animate={shake}
        transition={shake ? { duration: 0.55, ease: 'easeOut' } : undefined}
        className="relative bg-skin-bg border border-skin-ink/60 rounded-md px-3 py-2.5 flex items-center gap-3"
      >
        <motion.span
          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center relative overflow-hidden"
          initial={false}
          animate={{ backgroundColor: CIRCLE_HEX[status] }}
          transition={reduced ? { duration: 0 } : colorTransition}
          data-testid={`gate-status-${id}`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isOpen ? 'open' : 'shut'}
              initial={reduced ? false : { opacity: 0, scale: 0.5, rotate: -45 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={reduced ? undefined : { opacity: 0, scale: 0.5, rotate: 45 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="flex items-center justify-center"
            >
              {isOpen ? (
                <Check size={12} color="#fff" strokeWidth={3} />
              ) : (
                <Minus size={12} color="#fff" strokeWidth={3} />
              )}
            </motion.span>
          </AnimatePresence>
        </motion.span>

        <div className="min-w-0 flex-1 text-sm text-skin-ink truncate">
          <span className="text-skin-muted font-mono mr-1">#{id}</span>
          <span>{label}</span>
        </div>

        <AnimatePresence initial={false}>
          {isLocked && (
            <motion.span
              key="lock"
              initial={reduced ? false : { opacity: 0, x: 14, scale: 0.6 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, x: 14, scale: 0.6 }}
              transition={{ duration: 0.26, ease: 'easeOut' }}
              className="shrink-0 text-skin-danger"
              data-testid={`gate-lock-${id}`}
              title="admin override required"
            >
              <Lock size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
