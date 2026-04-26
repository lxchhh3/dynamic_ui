import { motion } from 'framer-motion'
import { CheckCircle2, Ban, AlertTriangle } from 'lucide-react'

type Variant = 'success' | 'denied' | 'error'

const STYLES: Record<Variant, { border: string; text: string; bg: string; Icon: typeof CheckCircle2 }> = {
  success: { border: 'border-l-skin-success', text: 'text-skin-success', bg: 'bg-skin-success/8', Icon: CheckCircle2 },
  denied: { border: 'border-l-skin-danger', text: 'text-skin-danger', bg: 'bg-skin-danger/8', Icon: Ban },
  error: { border: 'border-l-skin-accent-deep', text: 'text-skin-accent-deep', bg: 'bg-skin-accent/15', Icon: AlertTriangle },
}

export default function Toast({ variant, text }: { variant: Variant; text: string }) {
  const s = STYLES[variant]
  const Icon = s.Icon
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border border-skin-border border-l-4 ${s.border} ${s.bg} ${s.text} text-sm`}
    >
      <Icon size={15} />
      <span>{text}</span>
    </motion.div>
  )
}
