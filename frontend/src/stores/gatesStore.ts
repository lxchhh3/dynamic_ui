import { create } from 'zustand'
import type { GateStatus, GateAnimation } from '../blocks/GateCard'

export interface GateRecord {
  id: number
  label: string
  status: GateStatus
  animate?: GateAnimation
}

interface GatesState {
  byId: Record<number, GateRecord>
  order: number[]
  hydrated: boolean
  hydrate: (gates: GateRecord[]) => void
  apply: (g: GateRecord) => void
  clearAnimate: (id: number) => void
}

export const useGates = create<GatesState>((set) => ({
  byId: {},
  order: [],
  hydrated: false,
  hydrate(gates) {
    const byId: Record<number, GateRecord> = {}
    const order: number[] = []
    for (const g of gates) {
      byId[g.id] = g
      order.push(g.id)
    }
    set({ byId, order, hydrated: true })
  },
  apply(g) {
    set((state) => {
      const next = { ...state.byId, [g.id]: g }
      const order = state.order.includes(g.id) ? state.order : [...state.order, g.id]
      return { byId: next, order }
    })
  },
  clearAnimate(id) {
    set((state) => {
      const existing = state.byId[id]
      if (!existing || !existing.animate) return state
      return { byId: { ...state.byId, [id]: { ...existing, animate: undefined } } }
    })
  },
}))
