// The two animated skins: hover, the pin frames, the title wipe (Animated I) and, in Neon
// (Animated II), the bold look, the arrival draw-in, the shimmer, the closing ramp and the spark.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { GREEN, WHITE, mix } from '../hooks/config'
import { ARRIVAL_GLOW_MS, BLINK_MS, BLINKS, CLOSE_MS, PIN_GLOW_MS, type Pin } from '../hooks/register'
import { UP_TO_LABEL, UP_TO_HIDE_MS, CHECK_FRAMES, FRAME_MS, PIN_FRAMES, PIN_FRAME_MS, PIN_SPARK_FRAMES, PIN_SPARK_MS, PIN_WAIT_MS, SHIMMER_GAP_STEPS, SHIMMER_STEP_MS, WIPE_STEPS } from '../hooks/title'

const PULSING = 'Body.\n\n```bash\necho hi\n```\n\n⚠️ Careful with X.\n\n❓ Do A?\n\n✅ Done: x. ➡️ Next: y.'
const NORMAL = ['#7F77DD', '#E0B040', '#4A90E2', '#5CB85C']
const COLUMNS = 40
const turnEnd = (answer: string) => ({ answer, reason: 'answer' as const, durationMs: 10, isAborted: false, turnId: 't1' })

// failPins: every write of the pins is refused, and counted in posted.
function world(on: On, config: Record<string, unknown>, opts: { failPins?: boolean } = {}) {
  const disk: Record<string, unknown> = { config }
  const posted: unknown[] = []
  on('store.get', (_, e) => ({ value: disk[e.key] }) as never)
  on('store.set', (_, e) => {
    if (opts.failPins && e.key === 'pins') { posted.push(e.value); throw new Error('disk full') }
    disk[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 's1' }) as never)
  on('ui.open', (_, e) => ({ value: { isPlaced: true, requestId: (e as any).id } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const pins = () => ((disk.pins ?? {}) as Record<string, Pin[]>).s1 ?? []
  return { disk, clock, pins, posted }
}
const mountClient = ($: any, surface = 'desktop', text = PULSING) =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', requestId: 'm1', props: { text, isFirstOfReply: true } } as never)
const boxes = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle)
const clients = async (ui: any) => (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('title-')).map((c: any) => c.props.props)
const glows = async (ui: any) => (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('glow-'))
const glowKeys = async (ui: any) => (await glows(ui)).map((c: any) => c.key)
const pinOf = async (ui: any, key: string) => (await ui.find({ type: 'Button', key: `pin-${key}`, in: 'title-1' }))?.text
const checkOf = async (ui: any) => (await ui.findAll({ type: 'Text', in: 'title-1' })).at(-1)
// The hover travels beside the props in the drawn tree, not inside them: by key, from ui.drawn().
function hoverOf(node: unknown, key: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined
  const n = node as { hover?: Record<string, unknown>; props?: Record<string, unknown>; children?: unknown[] }
  if (n.props?.key === key) return n.hover ?? undefined
  for (const child of n.children ?? []) {
    const found = hoverOf(child, key)
    if (found) return found
  }
  return undefined
}

// (a) Box hover: thicker and brighter in the animated skins, never in none nor on a checked box.
for (const skin of ['none', 'animated-i', 'animated-ii']) test(`${skin}: box hover ${skin === 'none' ? 'absent' : 'present, and gone on a checked box'}`, async ($, on) => {
  world(on, { skin })
  const ui = await mountClient($)
  const hovers = async () => { const tree = await ui.drawn(); return [0, 1, 2, 3].map(i => hoverOf(tree, `box-${i}`)) }
  if (skin === 'none') {
    expect(await hovers()).toEqual([undefined, undefined, undefined, undefined])
    expect(hoverOf(await ui.drawn(), 'pin-1')).toBeUndefined()
  } else {
    const neon = skin === 'animated-ii'
    expect((await hovers()).map((h: any) => h.borderStyle)).toEqual(neon ? ['double', 'double', 'double', 'double'] : ['bold', 'bold', 'double', 'bold'])
    expect((await hovers()).map((h: any) => h.borderColor)).toEqual(NORMAL.map(c => mix(c, WHITE, 0.35)))
    await ui.post({ checked: (await clients(ui))[1].boxKey, on: true }, { in: 'title-1' })
    expect((await hovers())[1]).toBeUndefined()
    expect((await boxes(ui))[1].props.borderColor).toBe(GREEN)
  }
  await ui.unmount()
})

test('animated-i, static drawing: the pin and ○ buttons light under the pointer by hover', async ($, on) => {
  world(on, { skin: 'animated-i' })
  await $.turn.complete(turnEnd(PULSING))
  const ui = await mountClient($, 'vscode')
  const hover = async (key: string) => hoverOf(await ui.drawn(), key)
  expect(await hover('pin-1')).toEqual({ color: '#E0B040', dimColor: false })
  expect(await hover('check-1')).toEqual({ color: '#E0B040', dimColor: false })
  await ui.press({ key: 'check-1' })
  expect(await hover('check-1')).toBeUndefined()
  await ui.unmount()
})

// (b) The pin spins, lands on 📌 and posts once; a press in the middle of the frames is ignored.
test('animated-i: the pin plays its spin, shows 📌, posts the pin once, and spins back on unpin', async ($, on) => {
  const { pins } = world(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const key = (await clients(ui))[1].boxKey
  expect(await pinOf(ui, key)).toBe('⚲')
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  const seen = [await pinOf(ui, key)]
  await ui.advance(PIN_FRAME_MS)
  seen.push(await pinOf(ui, key))
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  for (let i = 2; i < PIN_FRAMES.length; i++) {
    await ui.advance(PIN_FRAME_MS)
    seen.push(await pinOf(ui, key))
  }
  expect(seen).toEqual(PIN_FRAMES)
  expect(pins()).toEqual([])
  await ui.advance(PIN_FRAME_MS)
  expect(await pinOf(ui, key)).toBe('📌')
  expect(pins().map(p => p.id)).toEqual([key])
  expect((await clients(ui))[1].pinned).toBe(true)
  await ui.advance(10 * PIN_FRAME_MS)
  expect(await pinOf(ui, key)).toBe('📌')
  expect(pins().length).toBe(1)
  // Unpin: the frames in reverse, then ⚲ and the post with on: false.
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  const back = [await pinOf(ui, key)]
  for (let i = 1; i < PIN_FRAMES.length; i++) {
    await ui.advance(PIN_FRAME_MS)
    back.push(await pinOf(ui, key))
  }
  expect(back).toEqual([...PIN_FRAMES].reverse())
  await ui.advance(PIN_FRAME_MS)
  expect(await pinOf(ui, key)).toBe('⚲')
  expect(pins()).toEqual([])
  await ui.unmount()
})

// (c) The title wipe: while the hook closes the box, the title is struck from the left.
test('animated-i: with closing on, half of CLOSE_MS strikes half the title; the mark ends the wipe', async ($, on) => {
  world(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const key = (await clients(ui))[1].boxKey
  const struck = async () => (await ui.findAll({ type: 'Text', in: 'title-1' })).filter((t: any) => t.props.strikethrough).map((t: any) => t.text)
  expect(await struck()).toEqual([])
  await ui.post({ closing: key }, { in: 'title-1' })
  expect((await clients(ui))[1].closing).toBe(true)
  await ui.advance(CLOSE_MS / 2)
  const half = Math.ceil('warning'.length * (WIPE_STEPS / 2) / WIPE_STEPS)
  expect(await struck()).toEqual(['warning'.slice(0, half)])
  const rest = (await ui.findAll({ type: 'Text', in: 'title-1' })).find((t: any) => t.text === 'warning'.slice(half))
  expect(rest?.props.bold).toBe(true)
  expect(rest?.props.strikethrough).toBeUndefined()
  await ui.advance(CLOSE_MS / 2)
  expect(await struck()).toEqual(['warning'])
  // The mark arrives: the whole title dimmed, no strikethrough.
  await ui.post({ checked: key, on: true }, { in: 'title-1' })
  expect(await struck()).toEqual([])
  expect((await ui.findAll({ type: 'Text', in: 'title-1' })).find((t: any) => t.text === 'warning')?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('buttons bottom: the title instance wipes while the buttons instance plays the ✓ frames', async ($, on) => {
  world(on, { skin: 'animated-i', buttons: 'bottom' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-b-1' })
  const key = (await clients(ui))[2].boxKey
  await ui.press({ key: `check-${key}`, in: 'title-b-1' })
  await ui.advance(2 * FRAME_MS)
  expect((await ui.findAll({ type: 'Text', in: 'title-b-1' })).at(-1)?.text).toBe(CHECK_FRAMES[2])
  const struck = (await ui.findAll({ type: 'Text', in: 'title-1' })).filter((t: any) => t.props.strikethrough)
  expect(struck.length).toBe(1)
  expect(struck[0].text.length).toBeGreaterThan(0)
  await ui.unmount()
})

// (d) Neon: bold borders, the border dim while the glow paints it, full after the arrived post.
test('animated-ii: every border bold (the thick one double), dim during the draw-in, full after the post', async ($, on) => {
  const { clock } = world(on, { skin: 'animated-ii' })
  const ui = await mountClient($, 'terminal')
  expect((await boxes(ui)).map((b: any) => b.props.borderStyle)).toEqual(['bold', 'bold', 'double', 'bold'])
  expect((await boxes(ui)).map((b: any) => b.props.borderColor)).toEqual(NORMAL)
  expect((await clients(ui)).map((p: any) => p.color)).toEqual(NORMAL.map(c => mix(c, WHITE, 0.15)))
  const dim = async () => (await boxes(ui)).map((b: any) => b.props.borderDimColor === true)
  expect(await dim()).toEqual([false, false, false, false])
  await $.turn.complete(turnEnd(PULSING))
  expect(await dim()).toEqual([false, true, true, false])
  expect(await glowKeys(ui)).toEqual(['glow-arrive-top-1', 'glow-arrive-bottom-1', 'glow-arrive-top-2', 'glow-arrive-bottom-2'])
  const g = (await glows(ui))[0].props.props
  expect(g).toMatchObject({ paint: true, paintColor: '#E0B040', boxKey: (await clients(ui))[1].boxKey, border: 'bold' })
  // Mid lap: the cells the head has passed stay drawn in the type colour, under the tail.
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'glow-arrive-top-1' })
  await ui.advance(ARRIVAL_GLOW_MS / 4)
  const texts = (await ui.findAll({ type: 'Text', in: 'glow-arrive-top-1' })) as any[]
  const painted = texts.find(t => t.props.color === '#E0B040' && !t.props.bold)
  expect(painted?.text.length).toBeGreaterThan(1)
  expect(painted?.text.length).toBeLessThan(COLUMNS)
  expect(painted?.text.startsWith('┏')).toBe(true)
  expect(texts.some(t => t.props.bold && t.props.color === mix('#E0B040', WHITE, 0.85))).toBe(true)
  // The laps end (the frame clock moves every rim): each module posts arrived and the hook draws the full border.
  await ui.advance(ARRIVAL_GLOW_MS)
  expect(await dim()).toEqual([false, false, false, false])
  expect((await boxes(ui)).map((b: any) => b.props.borderColor)).toEqual(NORMAL)
  // Nothing comes back later.
  await clock.advance(ARRIVAL_GLOW_MS + 500)
  expect(await dim()).toEqual([false, false, false, false])
  await ui.unmount()
})

test('animated-ii: without the arrived post, the grace timer draws the full border', async ($, on) => {
  const { clock } = world(on, { skin: 'animated-ii' })
  const ui = await mountClient($, 'terminal')
  const dim = async () => (await boxes(ui)).map((b: any) => b.props.borderDimColor === true)
  await $.turn.complete(turnEnd(PULSING))
  expect(await dim()).toEqual([false, true, true, false])
  await clock.advance(ARRIVAL_GLOW_MS)
  expect(await dim()).toEqual([false, true, true, false])
  await clock.advance(500)
  expect(await dim()).toEqual([false, false, false, false])
  await ui.unmount()
})

test('animated-ii: the draw-in flashes ✦ at the corner the head crosses, for two frames', async ($, on) => {
  world(on, { skin: 'animated-ii' })
  const ui = await mountClient($, 'terminal')
  await $.turn.complete(turnEnd(PULSING))
  await ui.resize({ columns: 10, rows: 1, in: 'glow-arrive-top-1' })
  const spark = async () => (await ui.find({ type: 'Text', text: '✦', in: 'glow-arrive-top-1' }))?.props.color
  await ui.advance(35)
  expect(await spark()).toBe(WHITE)
  await ui.advance(35)
  expect(await spark()).toBe(WHITE)
  await ui.advance(35)
  expect(await spark()).toBeUndefined()
  await ui.unmount()
})

// (e) Neon: the pointer on the title row runs a shimmer across the title, drawn by the title
// Client itself; Animated I only lights the buttons.
for (const skin of ['animated-i', 'animated-ii']) test(`${skin}: the pointer on the title lights the buttons${skin === 'animated-ii' ? ' and runs the shimmer across the title' : ', no shimmer'}`, async ($, on) => {
  world(on, { skin })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  expect((await checkOf(ui))?.props.dimColor).toBe(true)
  const color = skin === 'animated-ii' ? mix('#E0B040', WHITE, 0.15) : '#E0B040'
  const shimmer = [0.85, 0.6, 0.4, 0.2].map(k => mix(color, WHITE, k))
  expect((await clients(ui))[1].shimmerColors).toEqual(skin === 'animated-ii' ? shimmer : undefined)
  // The title's texts in order, without the dot: the shimmer splits the title into runs of one colour.
  const runs = async () => (await ui.findAll({ type: 'Text', in: 'title-1' })).filter((t: any) => 'warning'.includes(t.text) && t.text !== '').map((t: any) => [t.text, t.props.color])
  expect(await runs()).toEqual([['warning', color]])
  await ui.pointer({ type: 'enter', x: 1, y: 0, in: 'title-1' })
  expect((await checkOf(ui))?.props.color).toBe(color)
  expect((await ui.find({ type: 'Button', key: `pin-${(await clients(ui))[1].boxKey}`, in: 'title-1' }))?.children.some((c: any) => c.props?.color === color)).toBe(true)
  expect(await glowKeys(ui)).toEqual([])
  if (skin === 'animated-ii') {
    // On enter the head sits on the first character; each step moves it one to the right.
    expect(await runs()).toEqual([['w', shimmer[0]], ['arning', color]])
    await ui.advance(SHIMMER_STEP_MS)
    expect(await runs()).toEqual([['w', shimmer[1]], ['a', shimmer[0]], ['rning', color]])
    await ui.advance(3 * SHIMMER_STEP_MS)
    expect(await runs()).toEqual([['w', color], ['a', shimmer[3]], ['r', shimmer[2]], ['n', shimmer[1]], ['i', shimmer[0]], ['ng', color]])
    // Past the last character plus the tail the title rests plain, then the head starts over.
    await ui.advance(('warning'.length + 3 - 4) * SHIMMER_STEP_MS)
    expect(await runs()).toEqual([['warning', color]])
    await ui.advance((SHIMMER_GAP_STEPS - 1) * SHIMMER_STEP_MS)
    expect(await runs()).toEqual([['warning', color]])
    await ui.advance(SHIMMER_STEP_MS)
    expect(await runs()).toEqual([['w', shimmer[0]], ['arning', color]])
    expect((await runs()).every(([, c]) => c !== undefined)).toBe(true)
  } else {
    await ui.advance(4 * SHIMMER_STEP_MS)
    expect(await runs()).toEqual([['warning', color]])
  }
  await ui.pointer({ type: 'leave', x: 1, y: 0, in: 'title-1' })
  expect((await checkOf(ui))?.props.dimColor).toBe(true)
  expect(await runs()).toEqual([['warning', color]])
  await ui.advance(4 * SHIMMER_STEP_MS)
  expect(await runs()).toEqual([['warning', color]])
  await ui.unmount()
})

test('animated-ii: the shimmer stops when the box starts closing, and does not start on a checked box', async ($, on) => {
  world(on, { skin: 'animated-ii' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const key = (await clients(ui))[1].boxKey
  const color = mix('#E0B040', WHITE, 0.15)
  const lit = async () => (await ui.findAll({ type: 'Text', in: 'title-1' })).some((t: any) => t.props.color === mix(color, WHITE, 0.85))
  await ui.pointer({ type: 'enter', x: 1, y: 0, in: 'title-1' })
  await ui.advance(SHIMMER_STEP_MS)
  expect(await lit()).toBe(true)
  await ui.post({ closing: key }, { in: 'title-1' })
  expect(await lit()).toBe(false)
  await ui.advance(4 * SHIMMER_STEP_MS)
  expect(await lit()).toBe(false)
  await ui.post({ checked: key, on: true }, { in: 'title-1' })
  await ui.pointer({ type: 'leave', x: 1, y: 0, in: 'title-1' })
  await ui.pointer({ type: 'enter', x: 1, y: 0, in: 'title-1' })
  await ui.advance(4 * SHIMMER_STEP_MS)
  expect(await lit()).toBe(false)
  await ui.unmount()
})

// The hook could not save the pin: past PIN_WAIT_MS the glyph follows the prop and the button is live again.
test('animated-ii: a pin the hook cannot save falls back to ⚲ after the wait, and a new press posts again', async ($, on) => {
  const { pins, posted } = world(on, { skin: 'animated-ii' }, { failPins: true })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const key = (await clients(ui))[1].boxKey
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  await ui.advance(PIN_SPARK_FRAMES.length * PIN_SPARK_MS)
  expect(posted.length).toBe(1)
  expect(pins()).toEqual([])
  expect(await pinOf(ui, key)).toBe('📌')
  // Pressing while the pin waits does nothing.
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  expect(posted.length).toBe(1)
  await ui.advance(PIN_WAIT_MS)
  expect(await pinOf(ui, key)).toBe('⚲')
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  await ui.advance(PIN_SPARK_FRAMES.length * PIN_SPARK_MS)
  expect(posted.length).toBe(2)
  await ui.unmount()
})

// A closing box carries no hover: the override would hide the blink or the ramp of its border.
for (const skin of ['animated-i', 'animated-ii']) test(`${skin}: no box hover while closing, back once closed and unchecked`, async ($, on) => {
  const { clock } = world(on, { skin })
  const ui = await mountClient($)
  const hover = async () => hoverOf(await ui.drawn(), 'box-1')
  const key = (await clients(ui))[1].boxKey
  expect(await hover()).toBeDefined()
  await ui.post({ closing: key }, { in: 'title-1' })
  expect(await hover()).toBeUndefined()
  await clock.advance(CLOSE_MS / 2)
  expect(await hover()).toBeUndefined()
  await clock.advance(CLOSE_MS)
  expect(await hover()).toBeDefined()
  // Checked after closing: still none, until unchecked.
  await ui.post({ closing: key }, { in: 'title-1' })
  await ui.post({ checked: key, on: true }, { in: 'title-1' })
  expect(await hover()).toBeUndefined()
  await clock.advance(2 * CLOSE_MS)
  expect(await hover()).toBeUndefined()
  await ui.post({ checked: key, on: false }, { in: 'title-1' })
  expect(await hover()).toBeDefined()
  await ui.unmount()
})

test('animated-ii: no box hover while the border draws in', async ($, on) => {
  const { clock } = world(on, { skin: 'animated-ii' })
  const ui = await mountClient($, 'terminal')
  const hover = async () => hoverOf(await ui.drawn(), 'box-1')
  expect(await hover()).toBeDefined()
  await $.turn.complete(turnEnd(PULSING))
  expect(await hover()).toBeUndefined()
  await clock.advance(ARRIVAL_GLOW_MS + 500)
  expect(await hover()).toBeDefined()
  await ui.unmount()
})

// (f) Closing: Neon ramps the background and the border with the step; Animated I blinks.
test('animated-ii: closing ramps the background toward green and the border toward white, two laps on the rim', async ($, on) => {
  const { clock } = world(on, { skin: 'animated-ii' })
  const ui = await mountClient($)
  const still = (await boxes(ui))[1].props.backgroundColor
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  expect((await glows(ui)).map((c: any) => c.props.props.laps)).toEqual([2, 2])
  const backgrounds: string[] = []
  const borders: string[] = []
  for (let step = 0; step < 2 * BLINKS; step++) {
    backgrounds.push((await boxes(ui))[1].props.backgroundColor)
    borders.push((await boxes(ui))[1].props.borderColor)
    await clock.advance(BLINK_MS)
  }
  expect(backgrounds).toEqual(Array.from({ length: 2 * BLINKS }, (_, s) => mix(still, GREEN, Math.min(0.4, 0.08 + s * 0.04))))
  expect(borders).toEqual(Array.from({ length: 2 * BLINKS }, (_, s) => mix(GREEN, WHITE, Math.min(0.5, s * 0.06))))
  expect(new Set(backgrounds).size).toBeGreaterThan(2)
  expect(await glowKeys(ui)).toEqual([])
  expect((await boxes(ui))[1].props.borderColor).toBe('#E0B040')
  await ui.unmount()
})

test('animated-i: closing still blinks between two shades, one lap on the rim', async ($, on) => {
  const { clock } = world(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  expect((await glows(ui)).map((c: any) => c.props.props.laps)).toEqual([undefined, undefined])
  const backgrounds = new Set<string>()
  const lit: boolean[] = []
  for (let step = 0; step < 2 * BLINKS; step++) {
    backgrounds.add((await boxes(ui))[1].props.backgroundColor)
    lit.push((await boxes(ui))[1].props.borderColor !== '#E0B040')
    await clock.advance(BLINK_MS)
  }
  expect(backgrounds.size).toBe(2)
  expect(lit).toEqual(Array.from({ length: 2 * BLINKS }, (_, s) => s % 2 === 0))
  await ui.unmount()
})

// (g) Neon: the pin sparks, the press posts pinning and the top rim runs a lap in the type colour.
test('animated-ii: the pin plays the spark burst, posts pinning on the press and the pin after the frames', async ($, on) => {
  const { clock, pins } = world(on, { skin: 'animated-ii' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const key = (await clients(ui))[1].boxKey
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  expect(await glowKeys(ui)).toEqual(['glow-pin-top-1'])
  expect((await glows(ui))[0].props.props).toMatchObject({ line: true, durationMs: PIN_GLOW_MS })
  expect((await glows(ui))[0].props.props.colors[0]).toBe(mix('#E0B040', WHITE, 0.85))
  const seen = [await pinOf(ui, key)]
  for (let i = 1; i < PIN_SPARK_FRAMES.length; i++) {
    await ui.advance(PIN_SPARK_MS)
    seen.push(await pinOf(ui, key))
  }
  expect(seen).toEqual(PIN_SPARK_FRAMES)
  expect(pins()).toEqual([])
  await ui.advance(PIN_SPARK_MS)
  expect(await pinOf(ui, key)).toBe('📌')
  expect(pins().map(p => p.id)).toEqual([key])
  await clock.advance(PIN_GLOW_MS)
  expect(await glowKeys(ui)).toEqual([])
  await ui.unmount()
})

// Neon: the pulse window outlasts the draw-in; once the box has arrived a pin press gets its lap.
test('animated-ii: a pin pressed after the draw-in, still inside the pulse window, runs the pin lap', async ($, on) => {
  world(on, { skin: 'animated-ii' })
  const ui = await mountClient($, 'terminal')
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await $.turn.complete(turnEnd(PULSING))
  expect(await glowKeys(ui)).toEqual(['glow-arrive-top-1', 'glow-arrive-bottom-1', 'glow-arrive-top-2', 'glow-arrive-bottom-2'])
  await ui.advance(ARRIVAL_GLOW_MS)
  expect(await glowKeys(ui)).toEqual([])
  const key = (await clients(ui))[1].boxKey
  await ui.press({ key: `pin-${key}`, in: 'title-1' })
  expect(await glowKeys(ui)).toEqual(['glow-pin-top-1'])
  await ui.unmount()
})


// (f) The pointer on the check reveals "up to here" through the surface's hover, with no column count:
// in the CLI the region's columns can be wider than what is drawn, and a count never reaches the check.
test('animated-i: "up to here" hides until the pointer is on ○ or on itself, and a press checks up to the box', async ($, on) => {
  const { disk } = world(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  const key = (await clients(ui))[1].boxKey
  const scope = await ui.find({ type: 'Box', key: `upto-scope-${key}`, in: 'title-1' })
  const label = scope?.children?.[0]
  expect(label?.props?.display).toBe('none')
  expect(label?.hover).toEqual({ display: 'flex' })
  expect(label?.children?.[0]?.props?.key).toBe(`upto-${key}`)
  expect(label?.children?.[0]?.props?.label).toBe(UP_TO_LABEL)
  expect(scope?.children?.[1]?.props?.key).toBe(`check-${key}`)
  await ui.press({ key: `upto-${key}`, in: 'title-1' })
  expect(disk.checked).toEqual([`${key.slice(0, key.lastIndexOf(':'))}:0`, key])
  await ui.unmount()
})

// (g) The desktop app paints no hover inside a Client: there the pointer on the check reveals the same
// element by state, and leaving hides it after the grace.
test('animated-i: the pointer on the last cells shows "up to here" by state, and it hides after leaving', async ($, on) => {
  world(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  const key = (await clients(ui))[1].boxKey
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const shown = async () => (await ui.find({ type: 'Box', key: `upto-scope-${key}`, in: 'title-1' }))?.children?.[0]?.props?.display
  expect(await shown()).toBe('none')
  await ui.pointer({ type: 'move', x: COLUMNS - 1, y: 0, in: 'title-1' })
  expect(await shown()).toBe('flex')
  await ui.pointer({ type: 'move', x: COLUMNS - 1 - UP_TO_LABEL.length, y: 0, in: 'title-1' })
  await ui.advance(UP_TO_HIDE_MS)
  expect(await shown()).toBe('flex')
  await ui.pointer({ type: 'move', x: 1, y: 0, in: 'title-1' })
  await ui.advance(UP_TO_HIDE_MS)
  expect(await shown()).toBe('none')
  await ui.unmount()
})
