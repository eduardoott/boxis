// "client" animation: a glow that runs along the top and bottom border lines.
// One Client per line: the app does not give a Client that covers the whole box its height, so the
// sides are left out. It draws only single cells: a blank cell would erase the border.
import type { ClientModule } from 'claude-code'

export type GlowProps = {
  side: 'top' | 'bottom'
  // The app's thin border sits between two cells, so no cell lands on it: the line runs in the
  // inner cell, its glyph hugging the border. Blinking on the border itself is done by the hook.
  thin: boolean
  // From the head to the end of the tail.
  colors: string[]
  border: string
  durationMs: number
}

const TICK_MS = 35

const GLYPHS: Record<string, { corners: string; h: string }> = {
  round: { corners: '╭╮╰╯', h: '─' },
  bold: { corners: '┏┓┗┛', h: '━' },
  double: { corners: '╔╗╚╝', h: '═' },
  single: { corners: '┌┐└┘', h: '─' },
}

// Column x of a border line that is l columns wide.
export function glyph(border: string, side: GlowProps['side'], x: number, l: number): string {
  const g = GLYPHS[border] ?? GLYPHS.round
  if (x > 0 && x < l - 1) return g.h
  return [...g.corners][(side === 'top' ? 0 : 2) + (x === 0 ? 0 : 1)]
}

// The lap: left to right along the top, right to left along the bottom. The column of position p,
// or null when p is on the other line.
export function columnAt(p: number, side: GlowProps['side'], l: number): number | null {
  if (side === 'top') return p >= 0 && p < l ? p : null
  return p >= l && p < 2 * l ? 2 * l - 1 - p : null
}

type Local = { step: number; ref: { stop?: () => void } }

const Glow: ClientModule<GlowProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const steps = Math.max(1, Math.ceil(props.durationMs / TICK_MS))
  let state = surface.state
  if (state === undefined) {
    const ref: Local['ref'] = {}
    state = { step: 0, ref }
    surface.setState(state)
    const initial = state
    ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state ?? initial
      const step = cur.step + 1
      if (step >= steps) {
        ref.stop?.()
        ref.stop = undefined
      }
      surface.setState({ ...cur, step })
    })
  }

  const l = surface.columns
  if (l < 2 || state.step >= steps) return <Box />
  const draw = (x: number) => props.thin ? (props.side === 'top' ? '▔' : '▁') : glyph(props.border, props.side, x, l)
  const cells = []
  // The head keeps going until the whole tail has passed the end of the lap.
  const head = Math.floor((state.step / steps) * (2 * l + props.colors.length))
  for (const [k, color] of props.colors.entries()) {
    const x = columnAt(head - k, props.side, l)
    if (x === null) continue
    cells.push(<Box key={`c-${k}`} position="absolute" top={0} left={x}><Text color={color} bold>{draw(x)}</Text></Box>)
  }
  return <Box width={l} height={1}>{cells}</Box>
}

export default Glow
