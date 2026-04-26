import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { ClipboardEdit, SendHorizontal } from 'lucide-react'

export interface RequestFormProps {
  gateId: number
  gateLabel: string
}

export default function RequestForm({ gateId, gateLabel }: RequestFormProps) {
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitted) return
    const text =
      `request gate ${gateId}` +
      (reason.trim() ? ` because ${reason.trim()}` : '')
    // Bridge into the chat send pipeline owned by Home.tsx without a global store change.
    window.dispatchEvent(new CustomEvent('cu:chat-send', { detail: text }))
    setSubmitted(true)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="surface rounded-xl p-4 max-w-md border-l-2 border-amber-300/40"
    >
      <div className="flex items-center gap-2 text-sm text-skin-muted font-mono mb-3">
        <ClipboardEdit size={15} className="text-amber-300" />
        <span>request sheet</span>
      </div>

      <div className="text-base text-skin-ink mb-1">
        gate <span className="font-medium">#{gateId}</span> — {gateLabel}
      </div>
      <div className="text-xs text-skin-muted mb-3">
        you don't currently have access. tell an admin why you need it.
      </div>

      <form onSubmit={onSubmit} className="space-y-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitted}
          rows={3}
          maxLength={400}
          placeholder="reason for access (optional but recommended)"
          className="w-full bg-skin-bg border border-skin-border rounded-lg px-3 py-2 text-sm text-skin-ink placeholder:text-skin-muted/70 outline-none focus:border-skin-accent resize-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-skin-muted/70">
            {reason.length}/400
          </span>
          <motion.button
            type="submit"
            disabled={submitted}
            whileTap={{ scale: 0.96 }}
            className="h-8 px-3 rounded-lg bg-amber-300/90 text-skin-bg font-medium text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-300 transition-colors"
          >
            <SendHorizontal size={13} />
            {submitted ? 'submitted' : 'submit request'}
          </motion.button>
        </div>
      </form>
    </motion.div>
  )
}
