import { motion } from 'framer-motion'
import { CheckCircle2, Ban, AlertTriangle } from 'lucide-react'

type Variant = 'success' | 'denied' | 'error'

const STYLES: Record<Variant, { border: string; text: string; bg: string; Icon: typeof CheckCircle2 }> = {
  success: { border: 'border-l-gate-open', text: 'text-gate-open', bg: 'bg-gate-open/8', Icon: CheckCircle2 },
  denied: { border: 'border-l-gate-locked', text: 'text-gate-locked', bg: 'bg-gate-locked/8', Icon: Ban },
  error: { border: 'border-l-amber-400', text: 'text-amber-300', bg: 'bg-amber-400/8', Icon: AlertTriangle },
}

export default function Toast({ variant, text }: { variant: Variant; text: string }) {
  const s = STYLES[variant]
  const Icon = s.Icon
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gate-border border-l-4 ${s.border} ${s.bg} ${s.text} text-sm`}
    >
      <Icon size={15} />
      <span>{text}</span>
    </motion.div>
  )
}
