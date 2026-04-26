import { motion } from 'framer-motion'
import { Info, AlertTriangle, Ban } from 'lucide-react'

type Severity = 'info' | 'warning' | 'error'

const STYLES: Record<Severity, { border: string; text: string; bg: string; Icon: typeof Info }> = {
  info: { border: 'border-l-skin-accent', text: 'text-skin-ink', bg: 'bg-skin-accent/8', Icon: Info },
  warning: { border: 'border-l-skin-accent-deep', text: 'text-skin-accent-deep', bg: 'bg-skin-accent/15', Icon: AlertTriangle },
  error: { border: 'border-l-skin-danger', text: 'text-skin-danger', bg: 'bg-skin-danger/8', Icon: Ban },
}

export default function Alert({ message, severity = 'info' }: { message: string; severity?: Severity }) {
  const s = STYLES[severity] ?? STYLES.info
  const Icon = s.Icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex items-start gap-2 px-3 py-2 rounded-md border border-skin-border border-l-4 ${s.border} ${s.bg} ${s.text} text-sm max-w-xl`}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </motion.div>
  )
}
