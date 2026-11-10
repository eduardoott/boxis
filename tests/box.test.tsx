import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DEFAULTS, mix } from '../hooks/config'
import { CLOSE_MS, BLINKS, BLINK_MS } from '../hooks/register'
import { columnAt, glyph } from '../hooks/glow'
import { DOT_BEAT_MS, DOT_PULSES, CHECK_FRAMES, DOT_FRAMES, FRAME_MS } from '../hooks/title'

const ANSWER = { component: 'AssistantMessage', props: { text: 'hi', isFirstOfReply: true } } as const

test('the answer comes out inside the purple box, with the drawing below inside it', async ($, on) => {
  mock.store(on, {})
  // Whoever comes next in the chain (Skins, in a session) draws a marked text.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>drawing below</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, ...ANSWER })
    const box = await ui.find({ type: 'Box' })
    expect(box?.props.borderColor).toBe('#7F77DD')
    expect(box?.props.borderStyle).toBe('round')
    expect(await ui.find({ type: "Text", text: /drawing below/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an answer with slots is split: decision in blue with a thick border, about-you dimmed', async ($, on) => {
  mock.store(on, {})
  // The drawing below echoes the text it got, to show each box got only its own piece.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  // The drawing below is asked for only once, for the piece with a code block; the rest is drawn here.
  const text = 'Body.\n\n```bash\necho hi\n```\n\n❓ Do A?\n\n❓ About you: coffee?\n\n✅ Done: x. ➡️ Next: y.'
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
  expect(boxes.map(b => b.props.borderColor)).toEqual(['#7F77DD', '#4A90E2', '#6B6B6B', '#5CB85C'])
  expect(boxes[1].props.borderStyle).toBe('bold')
  expect(boxes[1].props.backgroundColor).toMatch(/^#[0-9A-F]{6}$/)
  expect(boxes[2].props.backgroundColor).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^below:Body\.[\s\S]*echo hi/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props.text)).toEqual(['Do A?', 'Done: x. ➡️ Next: y.'])
  expect(await ui.find({ type: 'Text', text: /^your call$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^coffee\?$/ })).toBeDefined()
  await ui.unmount()
})

// The legacy Portuguese slot labels must draw exactly the boxes the English ones draw.
test('the same answer with English and with Portuguese labels draws identical boxes', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  const answer = (test: string, about: string, done: string, next: string) =>
    `Body.\n\n🧪 ${test}\n1. Open it.\n2. Check it.\n\n⚠️ Risk.\n\n❓ A or B?\n\n❓ ${about} coffee?\n\n✅ ${done} x. ➡️ ${next} y.`
  const shape = async (text: string) => {
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
      .map(b => [b.props.borderColor, b.props.borderStyle, b.props.backgroundColor])
    const titles = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      .filter(t => ['your call', 'warning', 'test for you', 'about you', 'wrap-up'].includes(t))
    const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.key)
    await ui.unmount()
    return { boxes, titles, buttons }
  }
  const en = await shape(answer('Test:', 'About you:', 'Done:', 'Next:'))
  const pt = await shape(answer('Testar:', 'Sobre você:', 'Feito:', 'Planejado:'))
  expect(en.boxes.length).toBe(6)
  expect(en.titles).toEqual(['test for you', 'warning', 'your call', 'about you', 'wrap-up'])
  expect(pt).toEqual(en)
})

test('the check of a box dims only that box and is remembered on redraw', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  const text = 'Body.\n- item **one**\n\n⚠️ Careful with X.\n\n✅ Done: x. ➡️ Next: y.'
  const mount = () => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-1', props: { text, isFirstOfReply: true } } as never)
  const dimmed = async (ui: Awaited<ReturnType<typeof mount>>) =>
    (await ui.findAll({ type: 'Markdown' })).filter(m => m.props.dimColor).map(m => m.props.text)

  const ui = await mount()
  const color = (t: { props: Record<string, unknown> }) => t.props.color ?? (t.props.dimColor ? 'dim' : '?')
  const checks = async () => [
    ...(await ui.findAll({ type: 'Text', text: '○' })).map(t => `○:${color(t)}`),
    ...(await ui.findAll({ type: 'Text', text: '✓' })).map(t => `✓:${color(t)}`),
  ]
  expect(await checks()).toEqual(['○:dim', '○:dim', '○:dim'])
  expect(await dimmed(ui)).toEqual([])
  await ui.press({ key: 'check-1' })
  expect(await dimmed(ui)).toEqual(['~~Careful with X.~~'])
  const borders = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle).map(b => b.props.borderColor)
  expect(await borders()).toEqual(['#7F77DD', '#5CB85C', '#5CB85C'])
  expect(await checks()).toEqual(['○:dim', '○:dim', '✓:#5CB85C'])
  await ui.press({ key: 'check-0' })
  expect(await dimmed(ui)).toEqual(['~~Body.~~\n- ~~item **one**~~', '~~Careful with X.~~'])
  await ui.unmount()

  const again = await mount()
  expect(await dimmed(again)).toEqual(['~~Body.~~\n- ~~item **one**~~', '~~Careful with X.~~'])
  await again.press({ key: 'check-1' })
  expect(await dimmed(again)).toEqual(['~~Body.~~\n- ~~item **one**~~'])
  await again.unmount()
})

test('the check mark follows the answer text, not the id the screen gives the message', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  const text = 'Body.\n\n⚠️ Careful with X.'
  const mount = (requestId: string) => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
  const live = await mount('msg_011Cg-t0')
  await live.press({ key: 'check-1' })
  await live.unmount()
  const reopened = await mount('b755fbd8-448d-4f48-a2ec-d494ec24c7c8')
  expect(await reopened.find({ type: 'Text', text: '✓' })).toBeDefined()
  await reopened.unmount()
})

test('/boxis check off removes the ✓ button (the pin stays) and ignores what was checked', async ($, on) => {
  mock.store(on, { config: { check: false }, checked: ['msg-2:0'] })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>drawing below</Text>
  })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-2', props: { text: 'hi', isFirstOfReply: true } } as never)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['pin-0'])
  expect(await ui.find({ type: 'Text', text: /drawing below/ })).toBeDefined()
  await ui.unmount()
})

test('/boxis off gives back the drawing below with no box, and on brings it back', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>drawing below</Text>
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const boxes = async () => {
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'terminal', ...ANSWER })
    const n = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor).length
    await ui.unmount()
    return n
  }
  await $.command.run({ command: 'boxis', args: 'off' } as never)
  expect(await boxes()).toBe(0)
  await $.command.run({ command: 'boxis', args: 'on' } as never)
  expect(await boxes()).toBe(1)
})

test('pane: the buttons change intensity, colour, max pins and reset', async ($, on) => {
  mock.store(on, {})
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, component: 'Pane', requestId: 'boxis-config', props: {} } as never)
    expect(await ui.find({ type: 'Text', text: /^ 50$/ })).toBeDefined()
    await ui.press({ key: 'intensity-up' })
    expect(await ui.find({ type: 'Text', text: /^ 60$/ })).toBeDefined()
    await ui.press({ key: 'color-next-warning' })
    expect(await ui.find({ type: 'Text', text: '#F08A3C' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' 5' })).toBeDefined()
    await ui.press({ key: 'pins-up' })
    expect(await ui.find({ type: 'Text', text: ' 6' })).toBeDefined()
    for (let i = 0; i < 9; i++) await ui.press({ key: 'pins-down' })
    expect(await ui.find({ type: 'Text', text: ' 1' })).toBeDefined()
    await ui.press({ key: 'pins-up' })
    await ui.press({ key: 'reset-all' })
    expect(await ui.find({ type: 'Text', text: /^ 50$/ })).toBeDefined()
    // Reset restores colours and intensity; max pins stays, like on/off and check.
    expect(await ui.find({ type: 'Text', text: ' 2' })).toBeDefined()
    for (let i = 0; i < 3; i++) await ui.press({ key: 'pins-up' })
    await ui.unmount()
  }
})

test('if the drawing below fails, the whole answer still comes out in a single box', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async () => { throw new Error('skins fell over') })
  const text = 'Body.\n\n```bash\necho hi\n```\n\n❓ About you: coffee?\n\n✅ Done: x. ➡️ Next: y.\n\n📌 [queue.md](queue.md)'
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
    expect(boxes.map(b => b.props.borderColor)).toEqual(['#7F77DD'])
    expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props.text)).toEqual([text])
    await ui.unmount()
  }
})

// Only the answer that just arrived pulses (animated skins). The code block in the body makes the
// drawing below be asked for on each redraw, so it can be counted.
const PULSING = 'Body.\n\n```bash\necho hi\n```\n\n⚠️ Careful with X.\n\n❓ Do A?\n\n✅ Done: x. ➡️ Next: y.'
const NORMAL = ['#7F77DD', '#E0B040', '#4A90E2', '#5CB85C']
const turnEnd = (answer: string) => ({ answer, reason: 'answer' as const, durationMs: 10, isAborted: false, turnId: 't1' })

function pulseWorld(on: On, config: Record<string, unknown>) {
  mock.store(on, { config })
  const count = { draws: 0 }
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    count.draws += 1
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return { clock: mock.clock(on, { now: 1_800_000_000_000 }), count }
}
type Mounted = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const bordersOf = async (ui: Mounted) => (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle).map(b => b.props.borderColor)

// The retired 'svg' animation and the old key: a saved one reads as skin none.
for (const config of [{ skin: 'none' }, { animation: 'svg' }]) {
  test(`${'skin' in config ? 'skin none' : 'animation svg saved (reads as none)'}: the turn end redraws only once (the answer joins "up to here"), nothing pulses`, async ($, on) => {
    const { clock, count } = pulseWorld(on, config)
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSING, isFirstOfReply: true } })
    const before = count.draws
    expect(await $.turn.complete(turnEnd(PULSING))).toEqual({ text: PULSING })
    expect(await bordersOf(ui)).toEqual(NORMAL)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    for (let beat = 1; beat <= 6; beat++) {
      await clock.advance(400)
      expect(await bordersOf(ui)).toEqual(NORMAL)
    }
    expect(count.draws).toBe(before + 1)
    await ui.unmount()
  })
}

// Animated skins: the title line becomes a surface module (hooks/title.tsx).
// Boxes of PULSING: 0 body, 1 warning, 2 decision, 3 wrap-up.
const mountClient = ($: { ui: { mount: (a: never) => Promise<any> } }, text = PULSING, surface = 'desktop') =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } } as never)
const clients = async (ui: any) => (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('title-')).map((c: any) => c.props.props)
const glows = async (ui: any) => (await ui.findAll({ type: 'Client' })).map((c: any) => c.key).filter((k: string) => k.startsWith('glow-'))
const pulsing = async (ui: any) => (await clients(ui)).map((p: any) => p.pulse)
// The glyph at the end of the line is the module's last Text; the dot's is a nested Text on the left.
const checkOf = async (ui: any, key: string) => (await ui.findAll({ type: 'Text', in: key })).at(-1)
const dotOf = async (ui: any, key: string) => (await ui.find({ type: 'Text', text: /^[◦◉●] $/, in: key }))?.text
const COLUMNS = 40

// Both animated skins draw the Client title; animated-ii (Neon) hands it a title colour mixed toward white.
for (const skin of ['animated-i', 'animated-ii']) test(`${skin}: one Client per box, a dot only on warning and decision, and no Button`, async ($, on) => {
  pulseWorld(on, { skin })
  const ui = await mountClient($)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  const found = await ui.findAll({ type: 'Client' })
  // Still, no box has a glow mounted.
  expect(found.map((c: any) => c.key)).toEqual(['title-0', 'title-1', 'title-2', 'title-3'])
  expect(found.every((c: any) => c.props.height === 1 && c.props.width === '100%')).toBe(true)
  const props = await clients(ui)
  expect(props.every((p: any) => p.part === 'both')).toBe(true)
  expect(props.map((p: any) => p.dot)).toEqual([false, true, true, false])
  expect(props.map((p: any) => p.checked)).toEqual([false, false, false, false])
  expect(props.map((p: any) => p.title)).toEqual(['', 'warning', 'your call', 'wrap-up'])
  expect(props.map((p: any) => p.color)).toEqual(skin === 'animated-ii' ? NORMAL.map(c => mix(c, '#FFFFFF', 0.15)) : NORMAL)
  expect(props.map((p: any) => p.skin)).toEqual([skin, skin, skin, skin])
  expect(new Set(props.map((p: any) => p.boxKey)).size).toBe(4)
  expect(props.every((p: any) => /:\d$/.test(p.boxKey))).toBe(true)
  await ui.unmount()
})

test('client: still, the module draws the title and the ○ as the static line does', async ($, on) => {
  pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  const title = await ui.find({ type: 'Text', text: /^warning$/, in: 'title-1' })
  expect(title?.props.color).toBe('#E0B040')
  expect(title?.props.bold).toBe(true)
  expect(await dotOf(ui, 'title-1')).toBe('● ')
  // The body has no dot: the title gains no column.
  expect(await dotOf(ui, 'title-0')).toBeUndefined()
  const check = await checkOf(ui, 'title-1')
  expect(check?.text).toBe('○')
  expect(check?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('client: only the new answer pulses, only warning and decision, and the window closes without a redraw', async ($, on) => {
  const { clock, count } = pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  // Without turn.complete it is a reopened answer.
  expect(await pulsing(ui)).toEqual([false, false, false, false])
  const before = count.draws
  expect(await $.turn.complete(turnEnd(PULSING))).toEqual({ text: PULSING })
  expect(await pulsing(ui)).toEqual([false, true, true, false])
  // The box itself does not change: no border, no colour, no redraw per beat.
  expect(await bordersOf(ui)).toEqual(NORMAL)
  const once = count.draws
  expect(once).toBe(before + 1)
  await clock.advance(10_000)
  expect(count.draws).toBe(once)
  expect(await bordersOf(ui)).toEqual(NORMAL)
  // With the window closed, a redraw or a remount does not pulse again.
  await ui.redraw()
  expect(await pulsing(ui)).toEqual([false, false, false, false])
  await ui.unmount()
  const again = await mountClient($)
  expect(await pulsing(again)).toEqual([false, false, false, false])
  await again.unmount()
})

test('client: the dot plays its pulses and stops, even when pulse arrives after mounting', async ($, on) => {
  const { clock } = pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  expect(await dotOf(ui, 'title-1')).toBe('● ')
  await ui.advance(10 * DOT_BEAT_MS)
  expect(await dotOf(ui, 'title-1')).toBe('● ')

  await $.turn.complete(turnEnd(PULSING))
  const seen = [await dotOf(ui, 'title-1')]
  for (let i = 1; i < DOT_PULSES * DOT_FRAMES.length; i++) {
    await ui.advance(DOT_BEAT_MS)
    seen.push(await dotOf(ui, 'title-1'))
  }
  expect(seen).toEqual(Array.from({ length: DOT_PULSES }, () => DOT_FRAMES.map(g => `${g} `)).flat())
  // Done: still, with the window open, and a redraw does not restart it.
  await ui.advance(DOT_BEAT_MS)
  expect((await clients(ui))[1].pulse).toBe(true)
  await ui.redraw()
  for (let i = 0; i < 3; i++) {
    await ui.advance(DOT_BEAT_MS)
    expect(await dotOf(ui, 'title-1')).toBe('● ')
  }
  await clock.advance(10_000)
  await ui.unmount()
})

test('client: a click on ○ plays the frames, checks once and the box turns green', async ($, on) => {
  const { clock } = pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  const seen = [(await checkOf(ui, 'title-1'))?.text]
  // A click in the middle of the frames is ignored: it neither restarts nor posts again.
  await ui.advance(FRAME_MS)
  seen.push((await checkOf(ui, 'title-1'))?.text)
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  for (let i = 2; i < CHECK_FRAMES.length; i++) {
    expect((await checkOf(ui, 'title-1'))?.props.color).toBe('#5CB85C')
    await ui.advance(FRAME_MS)
    seen.push((await checkOf(ui, 'title-1'))?.text)
  }
  expect(seen).toEqual(CHECK_FRAMES)
  expect((await checkOf(ui, 'title-1'))?.props.bold).toBe(true)
  await clock.advance(CLOSE_MS)
  expect(await bordersOf(ui)).toEqual(['#7F77DD', '#5CB85C', '#4A90E2', '#5CB85C'])
  expect((await clients(ui))[1].checked).toBe(true)
  // A single post: more time does not uncheck.
  await ui.advance(10 * FRAME_MS)
  expect((await clients(ui))[1].checked).toBe(true)
  await ui.unmount()
})

test('client: a click outside the check does nothing', async ($, on) => {
  pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.pointer({ type: 'down', x: COLUMNS - 4, y: 0, button: 'left', in: 'title-1' })
  await ui.advance(10 * FRAME_MS)
  expect((await checkOf(ui, 'title-1'))?.text).toBe('○')
  expect((await clients(ui))[1].checked).toBe(false)
  await ui.unmount()
})

test('client: closing blinks the border 6 times through the hook, pulses the background, mounts the glow and goes back to normal', async ($, on) => {
  const { clock } = pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  const background = async () => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle)[1].props.backgroundColor
  const still = await background()
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  expect(await glows(ui)).toEqual(['glow-close-top-1', 'glow-close-bottom-1'])
  // Lit is the box colour lightened (checked or not); dim is the usual colour.
  const isLit = async () => ![NORMAL[1], '#5CB85C'].includes((await bordersOf(ui))[1])
  const backgrounds = new Set<string>()
  let blinks = 0, before = false
  for (let t = 0; t < CLOSE_MS; t += BLINK_MS) {
    const now = await isLit()
    if (now && !before) blinks++
    before = now
    backgrounds.add(await background())
    await clock.advance(BLINK_MS)
  }
  expect(blinks).toBe(BLINKS)
  // The background pulses between two shades, neither of them the still one.
  expect(backgrounds.size).toBe(2)
  expect(backgrounds.has(still)).toBe(false)
  expect(await glows(ui)).toEqual([])
  expect(await bordersOf(ui)).toEqual(NORMAL)
  expect(await background()).toBe(still)
  // More time does not bring the box back.
  await clock.advance(10 * BLINK_MS)
  expect(await bordersOf(ui)).toEqual(NORMAL)
  await ui.unmount()
})

test('client: the new answer gets one glow lap, only on warning and decision', async ($, on) => {
  const { clock } = pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  expect(await glows(ui)).toEqual([])
  await $.turn.complete(turnEnd(PULSING))
  expect(await glows(ui)).toEqual(['glow-arrive-top-1', 'glow-arrive-bottom-1', 'glow-arrive-top-2', 'glow-arrive-bottom-2'])
  await clock.advance(10_000)
  await ui.redraw()
  expect(await glows(ui)).toEqual([])
  await ui.unmount()
})

test('glow: the lap runs along the top and back along the bottom, with the right corners', () => {
  const l = 6
  const lap = Array.from({ length: 2 * l }, (_, p) => [columnAt(p, 'top', l), columnAt(p, 'bottom', l)])
  expect(lap.map(([c]) => c)).toEqual([0, 1, 2, 3, 4, 5, null, null, null, null, null, null])
  expect(lap.map(([, b]) => b)).toEqual([null, null, null, null, null, null, 5, 4, 3, 2, 1, 0])
  const line = (side: 'top' | 'bottom') => Array.from({ length: l }, (_, x) => glyph('round', side, x, l)).join('')
  expect([line('top'), line('bottom')]).toEqual(['╭────╮', '╰────╯'])
})

test('client: a click on a checked box unchecks with no frames, and the old ✓ does not come back', async ($, on) => {
  const { clock } = pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  await ui.advance(FRAME_MS * CHECK_FRAMES.length)
  await clock.advance(CLOSE_MS)
  expect((await clients(ui))[1].checked).toBe(true)
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  expect((await clients(ui))[1].checked).toBe(false)
  expect((await checkOf(ui, 'title-1'))?.text).toBe('○')
  expect(await bordersOf(ui)).toEqual(NORMAL)
  await ui.unmount()
})

test('client: ui.message with checked and on marks and it persists; malformed data changes nothing', async ($, on) => {
  pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($)
  const key = (await clients(ui))[2].boxKey
  await ui.post({ checked: key, on: true }, { in: 'title-2' })
  expect((await clients(ui))[2].checked).toBe(true)
  expect(await bordersOf(ui)).toEqual(['#7F77DD', '#E0B040', '#5CB85C', '#5CB85C'])
  await ui.unmount()
  const reopened = await mountClient($)
  expect((await clients(reopened))[2].checked).toBe(true)
  // Without the requested state (on) it is malformed: no toggling.
  for (const data of [{ checked: 1, on: false }, { checked: key }, { checked: key, on: 'no' }, { other: key }, 'checked', null]) await reopened.post(data, { in: 'title-2' })
  expect((await clients(reopened))[2].checked).toBe(true)
  await reopened.unmount()
})

test('client with check off: the static title, no Client, only the pin', async ($, on) => {
  pulseWorld(on, { skin: 'animated-i', check: false })
  const ui = await mountClient($)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'pin-1', 'pin-2', 'pin-3'])
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  await ui.unmount()
})

test('client on a surface without Client: the static Button', async ($, on) => {
  pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($, PULSING, 'vscode')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'check-0', 'pin-1', 'check-1', 'pin-2', 'check-2', 'pin-3', 'check-3'])
  await ui.unmount()
})

test('client in the terminal: the module mounts and the check plays its frames', async ($, on) => {
  pulseWorld(on, { skin: 'animated-i' })
  const ui = await mountClient($, PULSING, 'terminal')
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  await ui.advance(FRAME_MS)
  expect((await checkOf(ui, 'title-1'))?.text).toBe(CHECK_FRAMES[1])
  await ui.unmount()
})

// buttons: bottom. The title row keeps only the title; the pin and check go in a row after the content.
const PLAIN = 'Body.\n\n⚠️ Careful with X.\n\n✅ Done: x. ➡️ Next: y.'
// A found Box carries its children: the kinds of the direct children of the box with that key.
const kindsIn = async (ui: any, key: string) => ((await ui.find({ type: 'Box', key }))?.children ?? []).map((c: any) => c.props?.key ?? c.type)
const rowsOf = async (ui: any, i: number) => (await ui.find({ type: 'Box', key: `box-${i}` }))?.children ?? []

test('buttons bottom, static: the title row has no Button; the pin and check come after the content', async ($, on) => {
  pulseWorld(on, { buttons: 'bottom' })
  expect(DEFAULTS.buttons).toBe('top')
  const ui = await mountClient($, PLAIN)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  // The title row holds only the title; the buttons row comes after the content, right aligned.
  // The two rows carry no key: the nearest keyed Box, whose hover lights the buttons, is the box.
  for (const i of [0, 1, 2]) {
    expect(await kindsIn(ui, `box-${i}`)).toEqual(['Box', 'Markdown', 'Box'])
    const [top, , buttons] = await rowsOf(ui, i)
    expect(top.children.map((c: any) => c.type)).toEqual(['Text'])
    expect(buttons.children.filter((c: any) => c.type === 'Button').map((c: any) => c.props.key)).toEqual([`pin-${i}`, `check-${i}`])
  }
  const [top1, , buttons1] = await rowsOf(ui, 1)
  expect(top1.children[0].children).toEqual(['warning'])
  expect(buttons1.props.justifyContent).toBe('flex-end')
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'check-0', 'pin-1', 'check-1', 'pin-2', 'check-2'])
  // The check still works from the bottom row.
  await ui.press({ key: 'check-1' })
  expect((await ui.findAll({ type: 'Markdown' })).filter((m: any) => m.props.dimColor).map((m: any) => m.props.text)).toEqual(['~~Careful with X.~~'])
  await ui.unmount()
})

test('buttons bottom, animated skin: two Clients per box, the title on top and the buttons after the content', async ($, on) => {
  const { clock } = pulseWorld(on, { skin: 'animated-i', buttons: 'bottom' })
  const ui = await mountClient($, PLAIN)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  const found = await ui.findAll({ type: 'Client' })
  expect(found.map((c: any) => c.key)).toEqual(['title-0', 'title-b-0', 'title-1', 'title-b-1', 'title-2', 'title-b-2'])
  expect(found.every((c: any) => c.props.height === 1 && c.props.width === '100%')).toBe(true)
  expect(found.map((c: any) => c.props.props.part)).toEqual(['title', 'buttons', 'title', 'buttons', 'title', 'buttons'])
  for (const i of [0, 1, 2]) expect(await kindsIn(ui, `box-${i}`)).toEqual([`title-${i}`, 'Markdown', `title-b-${i}`])
  // The pair shares the box key and the dot.
  const pair = found.filter((c: any) => c.key.endsWith('-1')).map((c: any) => c.props.props)
  expect(pair[0].boxKey).toBe(pair[1].boxKey)
  expect(pair.map((p: any) => p.dot)).toEqual([true, true])
  // Each part draws only its half: the dot and title on top, the buttons at the bottom.
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-b-1' })
  expect(await dotOf(ui, 'title-1')).toBe('● ')
  expect(await ui.find({ type: 'Button', in: 'title-1' })).toBeUndefined()
  expect(await dotOf(ui, 'title-b-1')).toBeUndefined()
  expect((await ui.findAll({ type: 'Button', in: 'title-b-1' })).map((b: any) => b.key)).toEqual([`pin-${pair[1].boxKey}`, `upto-${pair[1].boxKey}`, `check-${pair[1].boxKey}`])
  // The check plays its frames in the buttons instance and the box turns green.
  await ui.press({ key: `check-${pair[1].boxKey}`, in: 'title-b-1' })
  await ui.advance(FRAME_MS * CHECK_FRAMES.length)
  await clock.advance(CLOSE_MS)
  expect((await clients(ui))[2].checked).toBe(true)
  expect((await clients(ui))[3].checked).toBe(true)
  expect(await bordersOf(ui)).toEqual(['#7F77DD', '#5CB85C', '#5CB85C'])
  await ui.unmount()
})

