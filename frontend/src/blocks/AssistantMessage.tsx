import { motion } from 'framer-motion'

export default function AssistantMessage({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="text-[15px] leading-relaxed text-gate-text max-w-xl"
    >
      {text}
    </motion.div>
  )
}
