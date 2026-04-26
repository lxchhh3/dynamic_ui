import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export default function Portal({ children }: { children: ReactNode }) {
  const [el] = useState(() => document.createElement('div'))
  useEffect(() => {
    document.body.appendChild(el)
    return () => {
      document.body.removeChild(el)
    }
  }, [el])
  return createPortal(children, el)
}
