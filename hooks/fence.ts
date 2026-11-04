// Fenced code blocks, read as CommonMark does: the fence that opened says which one closes.
// One place, so split.ts, table.ts and register.tsx never disagree on where a block ends.

export type Fence = { char: string; n: number }

// Any indent (not just up to 3 spaces) on purpose: an indented block under a test step is a fence.
const OPENS = /^\s*(`{3,}|~{3,})(.*)$/
const CLOSES = /^\s*(`{3,}|~{3,})\s*$/

export function openFence(line: string): Fence | null {
  const m = OPENS.exec(line)
  if (!m) return null
  // A backtick in the info string is inline code, not a fence.
  if (m[1][0] === '`' && m[2].includes('`')) return null
  return { char: m[1][0], n: m[1].length }
}

// Closes only with the same character, a run at least as long, and nothing after it.
export function closesFence(line: string, open: Fence): boolean {
  const m = CLOSES.exec(line)
  return !!m && m[1][0] === open.char && m[1].length >= open.n
}

export const hasFence = (text: string) => text.split('\n').some(l => openFence(l) !== null)

export function fenceOpenAtEnd(text: string): Fence | null {
  let open: Fence | null = null
  for (const l of text.split('\n')) open = open ? (closesFence(l, open) ? null : open) : openFence(l)
  return open
}
