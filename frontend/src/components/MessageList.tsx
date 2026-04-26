import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BlockRenderer } from '../blocks/registry'
import { useChat, type ChatTurn } from '../stores/chatStore'
import { Loader2 } from 'lucide-react'

export default function MessageList() {
  const turns = useChat((s) => s.turns)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  if (turns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-skin-muted text-sm font-mono">
        start by asking something about gates · e.g. "list gates"
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      <AnimatePresence initial={false}>
        {turns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} />
        ))}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  )
}

function TurnBlock({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex justify-end"
      >
        <div className="max-w-xl bg-skin-accent/15 border border-skin-accent/30 text-skin-ink rounded-2xl px-4 py-2 text-sm">
          {turn.userMessage}
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {turn.blocks.length === 0 && turn.streaming && (
        <div className="inline-flex items-center gap-2 text-skin-muted text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>thinking…</span>
        </div>
      )}
      {turn.blocks.map((block, i) => (
        <div key={i}>
          <BlockRenderer block={block} />
        </div>
      ))}
      {turn.error && (
        <div className="text-sm text-skin-danger">⚠ {turn.error}</div>
      )}
    </motion.div>
  )
}
