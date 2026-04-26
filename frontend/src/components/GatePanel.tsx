import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client'
import { useGates, type GateRecord } from '../stores/gatesStore'
import GateCard from '../blocks/GateCard'

export default function GatePanel() {
  const { byId, order, hydrated, hydrate, clearAnimate } = useGates()

  useEffect(() => {
    if (hydrated) return
    api<GateRecord[]>('/api/gates')
      .then((gates) => hydrate(gates))
      .catch((err) => console.error('failed to load gates', err))
  }, [hydrated, hydrate])

  // Clear transient animation hints after 900ms so spring doesn't linger.
  useEffect(() => {
    const timers: number[] = []
    for (const id of order) {
      if (byId[id]?.animate) {
        timers.push(window.setTimeout(() => clearAnimate(id), 900))
      }
    }
    return () => timers.forEach(clearTimeout)
  }, [byId, order, clearAnimate])

  if (!hydrated) {
    return (
      <div className="p-6 text-sm text-skin-muted font-mono">loading gates…</div>
    )
  }

  return (
    <motion.div layout className="p-5 flex flex-col gap-3" data-testid="gates-panel">
      {order.map((id) => {
        const g = byId[id]
        return <GateCard key={id} id={g.id} label={g.label} status={g.status} animate={g.animate} />
      })}
    </motion.div>
  )
}
