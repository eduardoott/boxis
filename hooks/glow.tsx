// "client" animation: a glow that runs along the top and bottom border lines.
// One Client per line: the app does not give a Client that covers the whole box its height, so the
// sides are left out. It draws only single cells: a blank cell would erase the border.
import type { ClientModule } from 'claude-code'

export type GlowLap = 'arrive' | 'close' | 'pin'

export type GlowProps = {
  lap: GlowLap
  side: 'top' | 'bottom'
  // The app's thin border sits between two cells, so no cell lands on it: the line runs in the
  // inner cell, its glyph hugging the border. Blinking on the border itself is done by the hook.
  thin: boolean
  // From the head to the end of the tail.
  colors: string[]
  border: string
  durationMs: number
  // The box this rim belongs to: what an `arrived` post names.
  boxKey?: string
  // Draw-in: every cell the head has passed stays in paintColor, a ✦ flashes at each corner, and
  // the end of the lap is posted as { arrived: boxKey }.
  paint?: boolean
  paintColor?: string
  // The lap repeats every durationMs until the instance unmounts.
  loop?: boolean
  // Laps run in durationMs (default 1).
  laps?: number
  // The lap covers this line only (left to right on top), not the round trip: for a rim that runs alone.
  line?: boolean
}

const TICK_MS = 35
const WHITE = '#FFFFFF'
export const SPARK = '✦'
// The frames a corner shows ✦ once the head crosses it.
export const SPARK_FRAMES = 2

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

type Local = { step: number; spark?: { column: number; left: number }; ref: { stop?: () => void } }

const Glow: ClientModule<GlowProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const steps = Math.max(1, Math.ceil(props.durationMs / TICK_MS))
  const laps = Math.max(1, props.laps ?? 1)
  // Where the head is at a step on a line l wide: it keeps going until the tail has passed the end.
  const lapLen = (l: number) => props.line ? l : 2 * l
  const headAt = (step: number, l: number) => Math.floor(((props.loop ? step % steps : step) / steps) * (laps * lapLen(l) + props.colors.length))
  // The lap positions of this line's two corners.
  const corners = (l: number) => props.side === 'top' || props.line ? [0, l - 1] : [l, 2 * l - 1]
  const column = (p: number, l: number) => props.line ? (p >= 0 && p < l ? (props.side === 'top' ? p : l - 1 - p) : null) : columnAt(p, props.side, l)

  let state = surface.state
  if (state === undefined) {
    const ref: Local['ref'] = {}
    state = { step: 0, ref }
    surface.setState(state)
    const initial = state
    ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state ?? initial
      const step = cur.step + 1
      if (!props.loop && step >= steps) {
        ref.stop?.()
        ref.stop = undefined
        if (props.paint && props.boxKey) surface.post({ arrived: props.boxKey })
      }
      let spark = cur.spark && cur.spark.left > 1 ? { ...cur.spark, left: cur.spark.left - 1 } : undefined
      if (props.paint && !props.thin) {
        const l = surface.columns
        // The first tick counts as reaching the cell the head starts on.
        const [before, after] = [cur.step === 0 ? -1 : headAt(cur.step, l), headAt(step, l)]
        for (const p of corners(l)) {
          const x = column(p, l)
          if (x !== null && before < p && after >= p) spark = { column: x, left: SPARK_FRAMES }
        }
      }
      surface.setState({ ...cur, step, spark })
    })
  }

  const l = surface.columns
  if (l < 2 || (!props.loop && state.step >= steps)) return <Box />
  const draw = (x: number) => props.thin ? (props.side === 'top' ? '▔' : '▁') : glyph(props.border, props.side, x, l)
  const head = headAt(state.step, l)
  const len = lapLen(l)
  const cells = []
  if (props.paint) {
    // The run of cells the head has passed on this line, as one text, under the tail.
    const passed = Math.min(head, len)
    const from = props.side === 'top' ? 0 : Math.max(0, len - passed)
    const to = props.side === 'top' ? Math.min(passed, l) : l
    if (to > from) {
      const run = Array.from({ length: to - from }, (_, k) => draw(from + k)).join('')
      cells.push(<Box key="run" position="absolute" top={0} left={from}><Text color={props.paintColor ?? props.colors[0]}>{run}</Text></Box>)
    }
  }
  for (const [k, color] of props.colors.entries()) {
    const q = head - k
    if (q < 0 || q >= laps * len) continue
    const x = column(q % len, l)
    if (x === null) continue
    cells.push(<Box key={`c-${k}`} position="absolute" top={0} left={x}><Text color={color} bold>{draw(x)}</Text></Box>)
  }
  if (state.spark) {
    cells.push(<Box key="spark" position="absolute" top={0} left={state.spark.column}><Text color={WHITE} bold>{SPARK}</Text></Box>)
  }
  return <Box width={l} height={1}>{cells}</Box>
}

export default Glow
