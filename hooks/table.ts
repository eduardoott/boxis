// Finds the markdown tables in a piece, so Boxis can draw them with wrapping cells.
// Pure; the drawing lives in register.tsx.

import { closesFence, openFence, type Fence } from './fence'

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const isTableLine = (l: string) => l.trim().startsWith('|') || /\S\s*\|\s*\S/.test(l)

function cells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

export const hasTable = (text: string) => splitTables(text).some(t => t.kind === 'table')

export function splitTables(text: string): Segment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const segments: Segment[] = []
  let loose: string[] = []
  let fence: Fence | null = null
  const flush = () => {
    const t = loose.join('\n').trim()
    if (t) segments.push({ kind: 'text', text: t })
    loose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (fence) {
      loose.push(l)
      if (closesFence(l, fence)) fence = null
      continue
    }
    const m = openFence(l)
    if (m) {
      fence = m
      loose.push(l)
      continue
    }
    // A header followed by a |---|---| separator opens a table. As in GFM, the separator has the
    // header's column count: "cat x | grep y" followed by --- is text and a horizontal rule.
    const header = isTableLine(l) && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]) ? cells(l) : null
    if (header && cells(lines[i + 1]).length === header.length) {
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].trim() && isTableLine(lines[j])) {
        const c = cells(lines[j])
        rows.push(header.map((_, k) => c[k] ?? ''))
        j++
      }
      flush()
      segments.push({ kind: 'table', header, rows })
      i = j - 1
      continue
    }
    loose.push(l)
  }
  flush()
  return segments
}

// How much each column grows: its longest text, with a floor and a ceiling so none disappears.
export function columnWeights(header: string[], rows: string[][]): number[] {
  return header.map((c, k) => {
    const longest = Math.max(c.length, ...rows.map(l => (l[k] ?? '').length))
    return Math.max(6, Math.min(longest, 60))
  })
}
