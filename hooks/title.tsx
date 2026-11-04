// "client" animation: the title line as a surface module, which the app animates without
// redrawing the rest of the screen. A dot that pulses on arrival and a check that turns into ✓.
import type { ClientModule } from 'claude-code'

export type TitleProps = {
  title: string
  color: string
  // Title not bold and dimmed, as in the static drawing.
  dimmed: boolean
  checked: boolean
  checkColor: string
  dot: boolean
  pulse: boolean
  boxKey: string
  // Only on the last box of the last answer: the button that checks every box of the conversation.
  all?: boolean
  // The box is in this session's pin list: the button left of the check shows 📌.
  pinned?: boolean
}

// 5 pulses of 3 shades at 100 ms: below that the pulse is easy to miss.
export const DOT_PULSES = 5
export const DOT_FRAMES = ['◦', '◉', '●']
export const DOT_BEAT_MS = 100
// The ball in 8 phases. Only 4 fill glyphs exist: each one shows first dimmed, then lit.
export const FRAME_MS = 80
export const CHECK_FRAMES = ['○', '◔', '◔', '◑', '◑', '◕', '◕', '✓']
const DIMMED_FRAMES = [0, 1, 3, 5]
const STILL_DOT = '●'
export const PIN = { pinned: '📌', unpinned: '⚲' }

type Local = {
  step: number
  frame: number
  // What does not redraw: the timers, and the flags that stop a pulse restarting or a click repeating.
  ref: { pulse?: () => void; pulsed?: boolean; check?: () => void; waiting?: boolean; boxKey: string }
}

const Title: ClientModule<TitleProps, Local> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { step: 0, frame: 0, ref: { boxKey: props.boxKey } }
    surface.setState(state)
  }
  const initial = state
  const current = () => surface.state ?? initial
  const ref = state.ref
  ref.boxKey = props.boxKey
  // The mark has arrived: from here the prop rules, and unchecking from outside goes back to ○.
  if (props.checked) ref.waiting = false

  // The Client mounts while the answer is still arriving: pulse can turn true after mounting.
  if (props.dot && props.pulse && !ref.pulsed) {
    ref.pulsed = true
    ref.pulse = surface.every(DOT_BEAT_MS, () => {
      const cur = current()
      const step = cur.step + 1
      if (step >= DOT_PULSES * DOT_FRAMES.length) {
        ref.pulse?.()
        ref.pulse = undefined
      }
      surface.setState({ ...cur, step })
    })
  }

  // A Button, and not onPointer on the Text: that keeps the mouse arrow over the check.
  const press = () => {
    if (ref.check || ref.waiting) return
    // The requested state, not a toggle: "all" in the middle of the frames is not undone at their end.
    if (props.checked) {
      surface.post({ checked: ref.boxKey, on: false })
      return
    }
    surface.post({ closing: ref.boxKey })
    ref.check = surface.every(FRAME_MS, () => {
      const cur = current()
      const frame = cur.frame + 1
      if (frame >= CHECK_FRAMES.length - 1) {
        ref.check?.()
        ref.check = undefined
        // Stays on ✓ until the prop arrives, so it does not flash back to ○.
        ref.waiting = true
        surface.post({ checked: ref.boxKey, on: true })
      }
      surface.setState({ ...cur, frame })
    })
    surface.setState({ ...current(), frame: 0 })
  }

  const dot = ref.pulse && !props.checked ? DOT_FRAMES[state.step % DOT_FRAMES.length] : STILL_DOT
  const glyph = ref.check ? CHECK_FRAMES[state.frame] : props.checked || ref.waiting ? '✓' : '○'
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" height={1}>
      <Box flexShrink={1} overflow="hidden">
        <Text>
          {props.dot ? <Text color={props.color}>{`${dot} `}</Text> : null}
          <Text color={props.color} bold={!props.dimmed} dimColor={props.dimmed}>{props.title}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <Button key={`pin-${props.boxKey}`} label={props.pinned ? PIN.pinned : PIN.unpinned} onPress={() => surface.post({ pin: ref.boxKey, on: !props.pinned })}>
          {props.pinned ? <Text>{PIN.pinned}</Text> : <Text dimColor>{PIN.unpinned}</Text>}
        </Button>
        {props.all ? (
          <Button key={`all-${props.boxKey}`} label="all" onPress={() => surface.post({ all: true })}>
            <Text dimColor>all</Text>
          </Button>
        ) : null}
        <Button key={`check-${props.boxKey}`} label={glyph} onPress={press}>
          {ref.check ? <Text color={props.checkColor} dimColor={DIMMED_FRAMES.includes(state.frame)}>{glyph}</Text>
            : props.checked || ref.waiting ? <Text color={props.checkColor} bold>{glyph}</Text>
            : <Text dimColor>{glyph}</Text>}
        </Button>
      </Box>
    </Box>
  )
}

export default Title
