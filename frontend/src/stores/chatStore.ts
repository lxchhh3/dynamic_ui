import { create } from 'zustand'
import type { Block } from '../blocks/registry'

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  userMessage?: string
  blocks: Block[]
  streaming: boolean
  error?: string
}

interface ChatState {
  turns: ChatTurn[]
  sending: boolean
  // `silent` skips painting the user bubble — used when an interactive block
  // (e.g. RequestForm) synthesizes a command on the user's behalf, so the chat
  // doesn't show text the user never actually typed.
  startUserTurn: (message: string, opts?: { silent?: boolean }) => string
  appendBlock: (turnId: string, block: Block) => void
  finishTurn: (turnId: string, error?: string) => void
  reset: () => void
}

export const useChat = create<ChatState>((set) => ({
  turns: [],
  sending: false,
  startUserTurn(message, opts) {
    const userId = crypto.randomUUID()
    const botId = crypto.randomUUID()
    const newTurns: ChatTurn[] = []
    if (!opts?.silent) {
      newTurns.push({
        id: userId,
        role: 'user',
        userMessage: message,
        blocks: [],
        streaming: false,
      })
    }
    newTurns.push({ id: botId, role: 'assistant', blocks: [], streaming: true })
    set((s) => ({ sending: true, turns: [...s.turns, ...newTurns] }))
    return botId
  },
  appendBlock(turnId, block) {
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === turnId ? { ...t, blocks: [...t.blocks, block] } : t,
      ),
    }))
  },
  finishTurn(turnId, error) {
    set((s) => ({
      sending: false,
      turns: s.turns.map((t) =>
        t.id === turnId ? { ...t, streaming: false, error } : t,
      ),
    }))
  },
  reset() {
    set({ turns: [], sending: false })
  },
}))
