// Animated skins: the title line as a surface module, which the app animates without
// redrawing the rest of the screen. A dot that pulses on arrival, a check that turns into ✓, a pin
// that spins (or sparks, in Neon), buttons lit under the pointer and a title wiped on check.
import type { ClientModule } from 'claude-code'

export type TitleSkin = 'animated-i' | 'animated-ii'

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
  // The hook is closing the box (the border blinks): the title wipes out while the ✓ fills.
  closing?: boolean
  skin?: TitleSkin
  // With the buttons at the bottom of the box, one instance draws the title and another the buttons.
  part: 'both' | 'title' | 'buttons'
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
// The pin spins once before landing; unpinning spins it back.
export const PIN_FRAMES = ['◜', '◠', '◝', '◞', '◡', '◟']
export const PIN_FRAME_MS = 70
// Neon: a spark burst instead of the spin, pinning and unpinning alike.
export const PIN_SPARK_FRAMES = ['✧', '✦', '✧', '✦']
export const PIN_SPARK_MS = 80
// Closing a box: the hook blinks (or ramps) the border this many beats; the title wipes over the
// same window. Shared with the hook, which re-exports them.
export const BLINKS = 6
export const BLINK_MS = 150
export const CLOSE_MS = 2 * BLINKS * BLINK_MS
export const WIPE_STEP_MS = 100
export const WIPE_STEPS = Math.ceil(CLOSE_MS / WIPE_STEP_MS)

type Local = {
  step: number
  frame: number
  pinFrame: number
  wipe: number
  hot: boolean
  // What does not redraw: the timers, and the flags that stop a pulse restarting or a click repeating.
  ref: {
    pulse?: () => void; pulsed?: boolean
    check?: () => void; waiting?: boolean
    pin?: () => void; pinFrames?: string[]; pinWaiting?: boolean; pinShown?: boolean
    wipe?: () => void
    props: TitleProps
  }
}

const Title: ClientModule<TitleProps, Local> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { step: 0, frame: 0, pinFrame: 0, wipe: 0, hot: false, ref: { props } }
    surface.setState(state)
    const initial = state
    const latest = () => surface.state ?? initial
    // Lit buttons while the pointer is on the line; in Neon the hook also shimmers the rim.
    surface.onPointer(e => {
      if (e.type !== 'enter' && e.type !== 'leave') return
      const cur = latest()
      const hot = e.type === 'enter'
      if (cur.hot === hot) return
      surface.setState({ ...cur, hot })
      const p = cur.ref.props
      if (p.part !== 'buttons' && p.skin === 'animated-ii') surface.post({ hot: p.boxKey, on: hot })
    })
  }
  const initial = state
  const current = () => surface.state ?? initial
  const ref = state.ref
  ref.props = props
  // The mark has arrived: from here the prop rules, and unchecking from outside goes back to ○.
  if (props.checked) ref.waiting = false
  if (ref.pinWaiting && !!props.pinned === ref.pinShown) ref.pinWaiting = false

  // The Client mounts while the answer is still arriving: pulse can turn true after mounting.
  // The pulse belongs to the instance that draws the title; a buttons-only one never starts it.
  if (props.part !== 'buttons' && props.dot && props.pulse && !ref.pulsed) {
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

  // The wipe runs while the hook closes the box and the mark has not arrived; the mark ends it.
  const wiping = props.part !== 'buttons' && !!props.closing && !props.checked
  if (wiping && !ref.wipe && state.wipe === 0) {
    ref.wipe = surface.every(WIPE_STEP_MS, () => {
      const cur = current()
      const wipe = cur.wipe + 1
      if (wipe >= WIPE_STEPS) {
        ref.wipe?.()
        ref.wipe = undefined
      }
      surface.setState({ ...cur, wipe })
    })
  } else if (!wiping && (ref.wipe || state.wipe > 0)) {
    ref.wipe?.()
    ref.wipe = undefined
    state = { ...state, wipe: 0 }
    surface.setState(state)
  }

  // A Button, and not onPointer on the Text: that keeps the mouse arrow over the check.
  const press = () => {
    if (ref.check || ref.waiting) return
    // The requested state, not a toggle: "all" in the middle of the frames is not undone at their end.
    if (ref.props.checked) {
      surface.post({ checked: ref.props.boxKey, on: false })
      return
    }
    surface.post({ closing: ref.props.boxKey })
    ref.check = surface.every(FRAME_MS, () => {
      const cur = current()
      const frame = cur.frame + 1
      if (frame >= CHECK_FRAMES.length - 1) {
        ref.check?.()
        ref.check = undefined
        // Stays on ✓ until the prop arrives, so it does not flash back to ○.
        ref.waiting = true
        surface.post({ checked: ref.props.boxKey, on: true })
      }
      surface.setState({ ...cur, frame })
    })
    surface.setState({ ...current(), frame: 0 })
  }

  // The pin plays its frames, then shows the requested glyph until the pinned prop confirms it.
  const pressPin = () => {
    if (ref.pin || ref.pinWaiting) return
    const p = ref.props
    const on = !p.pinned
    const neon = p.skin === 'animated-ii'
    ref.pinFrames = neon ? PIN_SPARK_FRAMES : on ? PIN_FRAMES : [...PIN_FRAMES].reverse()
    if (neon) surface.post({ pinning: p.boxKey })
    ref.pin = surface.every(neon ? PIN_SPARK_MS : PIN_FRAME_MS, () => {
      const cur = current()
      const pinFrame = cur.pinFrame + 1
      if (pinFrame >= (ref.pinFrames?.length ?? 0)) {
        ref.pin?.()
        ref.pin = undefined
        ref.pinWaiting = true
        ref.pinShown = on
        surface.post({ pin: ref.props.boxKey, on })
      }
      surface.setState({ ...cur, pinFrame })
    })
    surface.setState({ ...current(), pinFrame: 0 })
  }

  const hot = state.hot
  const dot = ref.pulse && !props.checked ? DOT_FRAMES[state.step % DOT_FRAMES.length] : STILL_DOT
  const glyph = ref.check ? CHECK_FRAMES[state.frame] : props.checked || ref.waiting ? '✓' : '○'
  const pinOn = ref.pinWaiting ? !!ref.pinShown : !!props.pinned
  const pinGlyph = ref.pin ? ref.pinFrames?.[Math.min(state.pinFrame, (ref.pinFrames?.length ?? 1) - 1)] ?? PIN.unpinned : pinOn ? PIN.pinned : PIN.unpinned
  // Step k of the wipe strikes the first ceil(len * k / steps) characters.
  const struck = wiping ? Math.ceil(props.title.length * Math.min(state.wipe, WIPE_STEPS) / WIPE_STEPS) : 0
  const title = (
    <Box flexShrink={1} overflow="hidden" {...(props.part === 'title' ? { width: '100%' } : {})}>
      <Text>
        {props.dot ? <Text color={props.color}>{`${dot} `}</Text> : null}
        {struck > 0 ? <Text color={props.color} dimColor strikethrough>{props.title.slice(0, struck)}</Text> : null}
        {struck < props.title.length ? <Text color={props.color} bold={!props.dimmed} dimColor={props.dimmed}>{props.title.slice(struck)}</Text> : null}
      </Text>
    </Box>
  )
  // A dim label lights in the box colour while the pointer is on the line.
  const dim = (text: string) => hot ? <Text color={props.color}>{text}</Text> : <Text dimColor>{text}</Text>
  const buttons = (
    <Box flexDirection="row" gap={1} flexShrink={0} {...(props.part === 'buttons' ? { justifyContent: 'flex-end', width: '100%' } : {})}>
      <Button key={`pin-${props.boxKey}`} label={pinGlyph} onPress={pressPin}>
        {ref.pin ? <Text color={props.color}>{pinGlyph}</Text> : pinOn ? <Text>{pinGlyph}</Text> : dim(pinGlyph)}
      </Button>
      {props.all ? (
        <Button key={`all-${props.boxKey}`} label="all" onPress={() => surface.post({ all: true })}>
          {dim('all')}
        </Button>
      ) : null}
      <Button key={`check-${props.boxKey}`} label={glyph} onPress={press}>
        {ref.check ? <Text color={props.checkColor} dimColor={DIMMED_FRAMES.includes(state.frame)}>{glyph}</Text>
          : props.checked || ref.waiting ? <Text color={props.checkColor} bold>{glyph}</Text>
          : dim(glyph)}
      </Button>
    </Box>
  )
  if (props.part === 'title') return title
  if (props.part === 'buttons') return buttons
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" height={1}>
      {title}
      {buttons}
    </Box>
  )
}

export default Title
