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
  startUserTurn: (message: string) => string // returns turnId
  appendBlock: (turnId: string, block: Block) => void
  finishTurn: (turnId: string, error?: string) => void
  reset: () => void
}

export const useChat = create<ChatState>((set) => ({
  turns: [],
  sending: false,
  startUserTurn(message) {
    const userId = crypto.randomUUID()
    const botId = crypto.randomUUID()
    set((s) => ({
      sending: true,
      turns: [
        ...s.turns,
        { id: userId, role: 'user', userMessage: message, blocks: [], streaming: false },
        { id: botId, role: 'assistant', blocks: [], streaming: true },
      ],
    }))
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
