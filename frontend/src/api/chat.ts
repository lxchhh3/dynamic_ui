import type { Block } from '../blocks/registry'

export interface ChatStreamOpts {
  token: string
  message: string
  signal?: AbortSignal
}

/**
 * POST /api/chat and stream SSE events. EventSource doesn't do POST, so we
 * parse the body manually as a ReadableStream of UTF-8 chunks.
 *
 * Each SSE event has the shape:
 *   event: block
 *   data: {"type":"...","props":{...}}
 *
 * We yield each parsed Block (event=="block") and stop on event=="done".
 */
export async function* streamChat({ token, message, signal }: ChatStreamOpts): AsyncIterable<Block> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      accept: 'text/event-stream',
    },
    body: JSON.stringify({ message }),
  })
  if (!res.ok || !res.body) {
    const body = await res.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail ?? body
    } catch {
      /* keep text */
    }
    throw new Error(`chat failed (${res.status}): ${detail}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      // Normalize CRLF → LF so the frame separator is consistently "\n\n".
      // sse-starlette emits CRLF per the SSE spec; the stdlib tolerates both.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const parsed = parseFrame(frame)
        if (!parsed) continue
        if (parsed.event === 'done') return
        if (parsed.event === 'block') {
          try {
            yield JSON.parse(parsed.data) as Block
          } catch (err) {
            console.error('bad block payload', err, parsed.data)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(raw: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    if (line.startsWith(':')) continue // comment / heartbeat
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    // Spec says a single space after the colon is stripped.
    const value = line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length && event !== 'done') return null
  return { event, data: dataLines.join('\n') }
}
