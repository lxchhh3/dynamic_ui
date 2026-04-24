import { motion } from 'framer-motion'
import GateCard, { type GateStatus } from './GateCard'

interface Props {
  gates: { id: number; label: string; status: GateStatus }[]
}

export default function GateGrid({ gates }: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl"
    >
      {gates.map((g) => (
        <div key={g.id} className="min-w-0">
          <GateCard id={g.id} label={g.label} status={g.status} />
        </div>
      ))}
    </motion.div>
  )
}
