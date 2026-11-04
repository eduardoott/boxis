// Splits an answer into pieces by the emoji that starts a line. Pure: it only says which piece is
// which box type; drawing is register.tsx's job.

import { closesFence, openFence, type Fence } from './fence'

export type BoxType = 'body' | 'decision' | 'about-you' | 'warning' | 'scope' | 'document' | 'object' | 'test' | 'wrap-up'

// title: the subject a "### heading" gave a body box; the other types keep their fixed title.
export type Piece = { type: BoxType; text: string; title?: string }

// Order matters: "❓ About you:" before the bare "❓". Each label also takes its Portuguese form
// ("Sobre você", "Testar"), so answers written in either language give the same boxes.
// Labelled slots need the label and the colon ("✅ Done:", "🧪 Test:"): a bare "✅ passed" is body text.
// A bold label counts too, with the colon inside or outside the bold ("**Done:**", "__Done__:").
const label = (words: string) => `(?:(\\*\\*|__)(?:${words})(?::\\1|\\1:)|(?:${words}):)`
const STARTS: [RegExp, BoxType][] = [
  [new RegExp(`^❓\\s*${label('About you|Sobre você')}\\s*`, 'iu'), 'about-you'],
  [/^❓\s*/u, 'decision'],
  [/^⚠️?\s*/u, 'warning'],
  [/^🚧\s*/u, 'scope'],
  [/^📄\s*/u, 'document'],
  [/^📌\s*/u, 'object'],
  [new RegExp(`^🧪\\s*${label('Testar|Test')}\\s*`, 'iu'), 'test'],
  // The wrap-up keeps "Done:" in its text: it sits next to "Planned:" in the same paragraph.
  [new RegExp(`^✅\\s*(?=${label('Feito|Done')})`, 'iu'), 'wrap-up'],
]

// A heading opens a body box of its own, titled with the subject. Closing hashes need a space
// before them, so "### F#" keeps its "#".
const HEADING = /^#{2,3}\s+(.+?)(?:\s+#+)?\s*$/
const MAX_TITLE = 60
// Same cleaning as the pin excerpt: the single _ stays, it is part of names like usp_x_y.
function titleOf(raw: string): string {
  const clean = raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1).trimEnd()}…` : clean
}
const TABLE_ROW = /^\s*\|/
const TABLE_OWNERS: BoxType[] = ['warning', 'decision']
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
  let current: { type: BoxType; lines: string[]; title?: string } | null = null
  let blanks: string[] = []
  let fence: Fence | null = null

  const close = () => {
    if (current) {
      const t = current.lines.join('\n').trim()
      // A heading with nothing under it still shows: its title alone is part of the answer.
      if (t || current.title) pieces.push({ type: current.type, text: t, ...(current.title ? { title: current.title } : {}) })
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

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
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
    const heading = HEADING.exec(line)
    if (heading) {
      close()
      blanks = []
      current = { type: 'body', lines: [], title: titleOf(heading[1]) }
      continue
    }
    const found = typeOfLine(line)
    if (found) {
      // "🧪 Test:" alone only becomes the box title; with text after it, the text stays.
      put(found.type, found.rest, found.type === 'test' && found.rest.trim() === '')
      continue
    }
    // The alternatives table under a warning or a decision belongs to it, not to a new body box.
    if (current && TABLE_OWNERS.includes(current.type) && TABLE_ROW.test(line)) {
      put(current.type, line)
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
