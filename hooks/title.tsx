// Animated skins: the title line as a surface module, which the app animates without
// redrawing the rest of the screen. A dot that pulses on arrival, a check that turns into ✓, a pin
// that spins (or sparks, in Neon), buttons lit under the pointer, a title wiped on check and, in
// Neon, a shimmer across the title under the pointer.
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
  // The box is in this session's pin list: the button left of the check shows 📌.
  pinned?: boolean
  // The hook is closing the box (the border blinks): the title wipes out while the ✓ fills.
  closing?: boolean
  skin?: TitleSkin
  // Neon: the pointer on the row runs a shimmer across the title, head colour first, then the tail.
  shimmerColors?: string[]
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
export const PIN_FRAMES = ['◜', '◠', '◝', '◞', '◡', '◟']
export const PIN_FRAME_MS = 70
export const PIN_SPARK_FRAMES = ['✧', '✦', '✧', '✦']
export const PIN_SPARK_MS = 80
// After the pin posts, the pinned prop confirms it; past this the button falls back to the prop.
export const PIN_WAIT_MS = 1500
// The shimmer head moves one character per step; past the end it rests this many steps.
export const SHIMMER_STEP_MS = 60
export const SHIMMER_GAP_STEPS = 8
const SHIMMER_TAIL = 3
// Closing a box: the hook blinks (or ramps) the border this many beats; the title wipes over the
// same window. Shared with the hook, which re-exports them.
export const BLINKS = 6
export const BLINK_MS = 150
export const CLOSE_MS = 2 * BLINKS * BLINK_MS
export const WIPE_STEP_MS = 100
export const WIPE_STEPS = Math.ceil(CLOSE_MS / WIPE_STEP_MS)
// The pointer on the check shows "up to here" left of it, by two roads on one element: the CLI paints the
// hover but its region can be wider than what is drawn, so a column count never reaches the check; the
// desktop app does not paint a hover inside a Client, so there the column count reveals it.
export const UP_TO_LABEL = 'up to here'
export const UP_TO_HIDE_MS = 300
// The check is the last cell of the row; the one before it is the gap.
const CHECK_CELLS = 2

type Local = {
  step: number
  frame: number
  pinFrame: number
  wipe: number
  hot: boolean
  upTo: boolean
  // The column of the shimmer head; past the title and its tail, the rest of the gap.
  shimmer: number
  // What does not redraw: the timers, and the flags that stop a pulse restarting or a click repeating.
  ref: {
    pulse?: () => void; pulsed?: boolean
    check?: () => void; waiting?: boolean
    pin?: () => void; pinFrames?: string[]; pinWaiting?: boolean; pinShown?: boolean; pinWait?: () => void
    wipe?: () => void
    shimmer?: () => void
    hide?: () => void
    props: TitleProps
  }
}

// The shimmer runs on the title instance only, under the pointer, never over a closing or checked box.
const canShimmer = (p: TitleProps) => !!p.shimmerColors && p.part !== 'buttons' && !p.closing && !p.checked

const Title: ClientModule<TitleProps, Local> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { step: 0, frame: 0, pinFrame: 0, wipe: 0, hot: false, upTo: false, shimmer: 0, ref: { props } }
    surface.setState(state)
    const initial = state
    const latest = () => surface.state ?? initial
    const r = state.ref
    // The pointer still on "up to here" keeps it: the grace counts only from leaving both, so the pointer can cross to it.
    const pointUpTo = (e: { type: string; x: number }) => {
      const cur = latest()
      const keep = CHECK_CELLS + (cur.upTo ? UP_TO_LABEL.length + 1 : 0)
      if (e.type !== 'enter' && e.type !== 'leave' && e.x >= surface.columns - keep) {
        r.hide?.()
        r.hide = undefined
        if (!cur.upTo) surface.setState({ ...cur, upTo: true })
      } else if (cur.upTo && !r.hide) {
        r.hide = surface.every(UP_TO_HIDE_MS, () => {
          r.hide?.()
          r.hide = undefined
          surface.setState({ ...latest(), upTo: false })
        })
      }
    }
    // Lit buttons while the pointer is on the line; in Neon the title instance also runs the shimmer.
    surface.onPointer(e => {
      if (r.props.part !== 'title') pointUpTo(e)
      if (e.type !== 'enter' && e.type !== 'leave') return
      const cur = latest()
      const hot = e.type === 'enter'
      if (cur.hot === hot) return
      if (hot && canShimmer(r.props) && !r.shimmer) {
        r.shimmer = surface.every(SHIMMER_STEP_MS, () => {
          const c = latest()
          const end = c.ref.props.title.length + SHIMMER_TAIL
          surface.setState({ ...c, shimmer: c.shimmer + 1 >= end + SHIMMER_GAP_STEPS ? 0 : c.shimmer + 1 })
        })
      } else if (!hot) {
        r.shimmer?.()
        r.shimmer = undefined
      }
      surface.setState({ ...cur, hot, shimmer: hot ? cur.shimmer : 0 })
    })
  }
  const initial = state
  const current = () => surface.state ?? initial
  const ref = state.ref
  ref.props = props
  // The mark has arrived: from here the prop rules, and unchecking from outside goes back to ○.
  if (props.checked) ref.waiting = false
  if (ref.pinWaiting && !!props.pinned === ref.pinShown) {
    ref.pinWaiting = false
    ref.pinWait?.()
    ref.pinWait = undefined
  }
  // Closing or checked mid-shimmer: the wipe wins, the title draws plain.
  if (ref.shimmer && !canShimmer(props)) {
    ref.shimmer()
    ref.shimmer = undefined
    state = { ...state, shimmer: 0 }
    surface.setState(state)
  }

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
    // The requested state, not a toggle: "up to here" in the middle of the frames is not undone at their end.
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
        // The hook may fail to save the pin: past the wait the glyph follows the prop again.
        ref.pinWait = surface.every(PIN_WAIT_MS, () => {
          ref.pinWait?.()
          ref.pinWait = undefined
          if (!ref.pinWaiting) return
          ref.pinWaiting = false
          ref.pinShown = undefined
          surface.setState({ ...current() })
        })
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
  // The shimmer head and its tail, over the un-struck part, as runs of one colour each.
  const head = ref.shimmer && state.shimmer < props.title.length + SHIMMER_TAIL ? state.shimmer : -1
  const shimmerAt = (j: number) => head - j >= 0 && head - j < (props.shimmerColors?.length ?? 0) ? props.shimmerColors?.[head - j] : undefined
  const rest = []
  for (let from = struck; from < props.title.length;) {
    const color = shimmerAt(from)
    let to = from + 1
    while (to < props.title.length && shimmerAt(to) === color) to++
    rest.push(<Text key={`t-${from}`} color={color ?? props.color} bold={!props.dimmed} dimColor={props.dimmed}>{props.title.slice(from, to)}</Text>)
    from = to
  }
  const title = (
    <Box flexShrink={1} overflow="hidden" {...(props.part === 'title' ? { width: '100%' } : {})}>
      <Text>
        {props.dot ? <Text color={props.color}>{`${dot} `}</Text> : null}
        {struck > 0 ? <Text color={props.color} dimColor strikethrough>{props.title.slice(0, struck)}</Text> : null}
        {rest}
      </Text>
    </Box>
  )
  const pressUpTo = () => {
    ref.hide?.()
    ref.hide = undefined
    surface.setState({ ...current(), upTo: false })
    surface.post({ upTo: ref.props.boxKey })
  }
  // A dim label lights in the box colour while the pointer is on the line.
  const dim = (text: string) => hot ? <Text color={props.color}>{text}</Text> : <Text dimColor>{text}</Text>
  const buttons = (
    <Box flexDirection="row" gap={1} flexShrink={0} {...(props.part === 'buttons' ? { justifyContent: 'flex-end', width: '100%' } : {})}>
      <Button key={`pin-${props.boxKey}`} label={pinGlyph} onPress={pressPin}>
        {ref.pin ? <Text color={props.color}>{pinGlyph}</Text> : pinOn ? <Text>{pinGlyph}</Text> : dim(pinGlyph)}
      </Button>
      <Box key={`upto-scope-${props.boxKey}`} flexDirection="row" gap={1}>
        <Box {...(state.upTo ? { display: 'flex' } : { display: 'none', hover: { display: 'flex' } })}>
          <Button key={`upto-${props.boxKey}`} label={UP_TO_LABEL} onPress={pressUpTo}>
            {dim(UP_TO_LABEL)}
          </Button>
        </Box>
        <Button key={`check-${props.boxKey}`} label={glyph} onPress={press}>
          {ref.check ? <Text color={props.checkColor} dimColor={DIMMED_FRAMES.includes(state.frame)}>{glyph}</Text>
            : props.checked || ref.waiting ? <Text color={props.checkColor} bold>{glyph}</Text>
            : dim(glyph)}
        </Button>
      </Box>
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
