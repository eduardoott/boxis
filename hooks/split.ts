// Splits an answer into pieces by the emoji that starts a line. Pure: it only says which piece is
// which box type; drawing is register.tsx's job.

import { closesFence, openFence, type Fence } from './fence'

export type BoxType = 'body' | 'decision' | 'about-you' | 'warning' | 'scope' | 'document' | 'object' | 'test' | 'wrap-up'

type Piece = { type: BoxType; text: string }

// Order matters: "❓ About you:" before the bare "❓". Each label also takes its Portuguese form
// ("Sobre você", "Testar"), so answers written in either language give the same boxes.
// "Test" must end the word, so "🧪 Tests" stays body text.
const STARTS: [RegExp, BoxType][] = [
  [/^❓\s*(?:About you|Sobre você):\s*/iu, 'about-you'],
  [/^❓\s*/u, 'decision'],
  [/^⚠️?\s*/u, 'warning'],
  [/^🚧\s*/u, 'scope'],
  [/^📄\s*/u, 'document'],
  [/^📌\s*/u, 'object'],
  [/^🧪\s*(?:Testar|Test(?!\p{L})):?\s*/u, 'test'],
  [/^✅\s*/u, 'wrap-up'],
]

const STEP = /^\s*\d+[.)]\s/
const INDENTED = /^\s+\S/

function typeOfLine(line: string): { type: BoxType; rest: string } | null {
  for (const [re, type] of STARTS) {
    const m = re.exec(line)
    if (m) return { type, rest: line.slice(m[0].length) }
  }
  return null
}

export function split(text: string): Piece[] {
  const pieces: Piece[] = []
  let current: { type: BoxType; lines: string[] } | null = null
  let blanks: string[] = []
  let fence: Fence | null = null

  const close = () => {
    if (current) {
      const t = current.lines.join('\n').trim()
      if (t) pieces.push({ type: current.type, text: t })
    }
    current = null
  }
  const put = (type: BoxType, line: string, headerOnly = false) => {
    if (current && current.type === type) {
      current.lines.push(...blanks)
    } else {
      close()
      current = { type, lines: [] }
    }
    blanks = []
    if (!headerOnly) current!.lines.push(line)
  }

  for (const line of text.split('\n')) {
    // Inside a code block nothing splits: the line goes to the piece where the block opened.
    if (fence) {
      current!.lines.push(...blanks, line)
      blanks = []
      if (closesFence(line, fence)) fence = null
      continue
    }
    if (line.trim() === '') {
      blanks.push(line)
      continue
    }
    const opens = openFence(line)
    if (opens) {
      // An indented block under a test step stays in the test; any other block is body.
      const type: BoxType = current?.type === 'test' && INDENTED.test(line) ? 'test' : 'body'
      put(type, line)
      fence = opens
      continue
    }
    const found = typeOfLine(line)
    if (found) {
      // "🧪 Test:" alone only becomes the box title; with text after it, the text stays.
      put(found.type, found.rest, found.type === 'test' && found.rest.trim() === '')
      continue
    }
    if (current?.type === 'test' && (STEP.test(line) || INDENTED.test(line))) {
      put('test', line)
      continue
    }
    put('body', line)
  }
  close()
  return pieces
}
