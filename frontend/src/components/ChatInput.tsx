import { useRef, useState, type KeyboardEvent, type FormEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { motion } from 'framer-motion'

interface Props {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    ref.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function onForm(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  return (
    <form onSubmit={onForm} className="relative flex items-end gap-2">
      <div className="flex-1 surface rounded-xl px-3 pt-2 pb-1.5 focus-within:border-skin-accent transition-colors">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          rows={1}
          placeholder="tell me what to do — e.g. &quot;open gate 7&quot;, &quot;grant IReallyRock access to gate 2&quot;, &quot;list gates&quot;"
          className="w-full bg-transparent outline-none resize-none text-sm text-skin-ink placeholder:text-skin-muted/70 min-h-[28px] max-h-40"
        />
      </div>
      <motion.button
        type="submit"
        disabled={disabled || !value.trim()}
        whileTap={{ scale: 0.94 }}
        className="h-10 px-4 rounded-xl bg-skin-accent text-skin-ink font-medium text-sm flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-skin-accent-deep hover:text-skin-bg transition-colors"
      >
        <SendHorizontal size={15} />
        send
      </motion.button>
    </form>
  )
}
