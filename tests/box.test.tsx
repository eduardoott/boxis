import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SCREEN, readConfig, mix, style } from '../hooks/config'
import { LIT_FILL, BEAT_MS, LIGHTEN, CLOSE_MS, BLINKS, BLINK_MS, PULSES } from '../hooks/register'
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

// "clock" animation: only the answer that just arrived pulses its warning and decision boxes.
// The code block in the body makes the drawing below be asked for on each redraw, so it can be counted.
const PULSING = 'Body.\n\n```bash\necho hi\n```\n\n⚠️ Careful with X.\n\n❓ Do A?\n\n✅ Done: x. ➡️ Next: y.'
const lit = (color: string) => mix(color, '#FFFFFF', LIGHTEN)
const NORMAL = ['#7F77DD', '#E0B040', '#4A90E2', '#5CB85C']
const LIT = ['#7F77DD', lit('#E0B040'), lit('#4A90E2'), '#5CB85C']
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

test('clock: the answer that just arrived pulses warning and decision 3 times and stops', async ($, on) => {
  const { clock, count } = pulseWorld(on, { animation: 'clock' })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSING, isFirstOfReply: true } })
  const borders = () => bordersOf(ui)
  // Without turn.complete it is a reopened answer: the usual colours.
  expect(await borders()).toEqual(NORMAL)
  await clock.advance(10 * BEAT_MS)
  expect(await borders()).toEqual(NORMAL)

  expect(await $.turn.complete(turnEnd(PULSING))).toEqual({ text: PULSING })
  expect(await borders()).toEqual(LIT)
  // Lit, the whole box lights up: background pulled to the type colour and a thicker border.
  const boxOf = async (color: string) => (await ui.findAll({ type: 'Box' })).find(b => b.props.borderColor === color)
  const warning = style(readConfig({ animation: 'clock' }), 'warning')
  const litWarning = await boxOf(lit('#E0B040'))
  expect(litWarning?.props.backgroundColor).toBe(mix(warning.background ?? SCREEN.dark, warning.color, LIT_FILL))
  expect(litWarning?.props.borderStyle).toBe('bold')
  expect((await boxOf(lit('#4A90E2')))?.props.borderStyle).toBe('double')
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe(lit('#E0B040'))
  expect((await ui.find({ type: 'Text', text: /^your call$/ }))?.props.color).toBe(lit('#4A90E2'))
  expect((await ui.find({ type: 'Text', text: /^wrap-up$/ }))?.props.color).toBe('#5CB85C')
  // Frame 1 dims, 2 lights, ... 5 dims: PULSES lit frames in all.
  for (let beat = 1; beat < 2 * PULSES; beat++) {
    await clock.advance(BEAT_MS)
    expect(await borders()).toEqual(beat % 2 ? NORMAL : LIT)
  }
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  expect((await boxOf('#E0B040'))?.props.backgroundColor).toBe(warning.background)
  expect((await boxOf('#E0B040'))?.props.borderStyle).toBe('round')
  // After the last frame the chain stops: no new colour, no redraw.
  const before = count.draws
  await clock.advance(BEAT_MS)
  expect(await borders()).toEqual(NORMAL)
  await clock.advance(10 * BEAT_MS)
  expect(await borders()).toEqual(NORMAL)
  expect(count.draws).toBe(before)
  await ui.unmount()
})

test('clock: a box checked as understood stays green and still in the middle of the pulse', async ($, on) => {
  const { clock } = pulseWorld(on, { animation: 'clock' })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSING, isFirstOfReply: true } })
  await $.turn.complete(turnEnd(PULSING))
  expect(await bordersOf(ui)).toEqual(LIT)
  await ui.press({ key: 'check-1' })
  expect(await bordersOf(ui)).toEqual(['#7F77DD', '#5CB85C', lit('#4A90E2'), '#5CB85C'])
  await clock.advance(BEAT_MS)
  expect(await bordersOf(ui)).toEqual(['#7F77DD', '#5CB85C', '#4A90E2', '#5CB85C'])
  await clock.advance(BEAT_MS)
  expect(await bordersOf(ui)).toEqual(['#7F77DD', '#5CB85C', lit('#4A90E2'), '#5CB85C'])
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#5CB85C')
  await ui.unmount()
})

// 'svg' was retired: a saved one reads as none.
for (const animation of ['none', 'svg']) {
  test(`animation ${animation === 'svg' ? 'svg saved (reads as none)' : animation}: the turn end redraws only once (the "check all" moves to the new answer), nothing pulses`, async ($, on) => {
    const { clock, count } = pulseWorld(on, { animation })
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSING, isFirstOfReply: true } })
    const before = count.draws
    expect(await $.turn.complete(turnEnd(PULSING))).toEqual({ text: PULSING })
    expect(await bordersOf(ui)).toEqual(NORMAL)
    for (let beat = 1; beat <= 2 * PULSES; beat++) {
      await clock.advance(BEAT_MS)
      expect(await bordersOf(ui)).toEqual(NORMAL)
    }
    expect(count.draws).toBe(before + 1)
    await ui.unmount()
  })
}

test('clock: a block with a trailing line break still matches the turn answer', async ($, on) => {
  const { clock } = pulseWorld(on, { animation: 'clock' })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: `${PULSING}\n\n`, isFirstOfReply: true } })
  expect(await bordersOf(ui)).toEqual(NORMAL)
  await $.turn.complete(turnEnd(PULSING))
  expect(await bordersOf(ui)).toEqual(LIT)
  await clock.advance(BEAT_MS)
  expect(await bordersOf(ui)).toEqual(NORMAL)
  await ui.unmount()
})

test('clock, fallback: a new block that only fits the turn answer adopts the pulse; the history does not', async ($, on) => {
  const { clock } = pulseWorld(on, { animation: 'clock' })
  const mount = (text: string) => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  const BLOCK = '⚠️ Careful with X.\n\n❓ Do A?'
  // History drawn on opening the session, outside a turn: it fits the new answer, but does not pulse.
  const old = await mount('❓ Do A?')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  // The new block is drawn inside the turn; the turn.complete answer joins another block before it.
  const fresh = await mount(BLOCK)
  expect(await bordersOf(fresh)).toEqual(['#E0B040', '#4A90E2'])
  await $.turn.complete(turnEnd(`Text before.\n${BLOCK}`))
  expect(await bordersOf(fresh)).toEqual([lit('#E0B040'), lit('#4A90E2')])
  expect(await bordersOf(old)).toEqual(['#4A90E2'])
  await clock.advance(BEAT_MS)
  expect(await bordersOf(fresh)).toEqual(['#E0B040', '#4A90E2'])
  // Past the 1 s window, a block that never showed no longer adopts, even with the chain lit.
  await clock.advance(3 * BEAT_MS)
  expect(await bordersOf(fresh)).toEqual([lit('#E0B040'), lit('#4A90E2')])
  const late = await mount('⚠️ Careful with X.')
  expect(await bordersOf(late)).toEqual(['#E0B040'])
  for (const ui of [old, fresh, late]) await ui.unmount()
})

// "client" animation: the title line becomes a surface module (hooks/title.tsx).
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

test('client: one Client per box, a dot only on warning and decision, and no Button', async ($, on) => {
  pulseWorld(on, { animation: 'client' })
  const ui = await mountClient($)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  const found = await ui.findAll({ type: 'Client' })
  // Still, no box has a glow mounted.
  expect(found.map((c: any) => c.key)).toEqual(['title-0', 'title-1', 'title-2', 'title-3'])
  expect(found.every((c: any) => c.props.height === 1 && c.props.width === '100%')).toBe(true)
  const props = await clients(ui)
  expect(props.map((p: any) => p.dot)).toEqual([false, true, true, false])
  expect(props.map((p: any) => p.checked)).toEqual([false, false, false, false])
  expect(props.map((p: any) => p.title)).toEqual(['', 'warning', 'your call', 'wrap-up'])
  expect(props.map((p: any) => p.color)).toEqual(NORMAL)
  expect(new Set(props.map((p: any) => p.boxKey)).size).toBe(4)
  expect(props.every((p: any) => /:\d$/.test(p.boxKey))).toBe(true)
  await ui.unmount()
})

test('client: still, the module draws the title and the ○ as the static line does', async ($, on) => {
  pulseWorld(on, { animation: 'client' })
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
  const { clock, count } = pulseWorld(on, { animation: 'client' })
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
  const { clock } = pulseWorld(on, { animation: 'client' })
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
  const { clock } = pulseWorld(on, { animation: 'client' })
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
  pulseWorld(on, { animation: 'client' })
  const ui = await mountClient($)
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.pointer({ type: 'down', x: COLUMNS - 4, y: 0, button: 'left', in: 'title-1' })
  await ui.advance(10 * FRAME_MS)
  expect((await checkOf(ui, 'title-1'))?.text).toBe('○')
  expect((await clients(ui))[1].checked).toBe(false)
  await ui.unmount()
})

test('client: closing blinks the border 6 times through the hook, pulses the background, mounts the glow and goes back to normal', async ($, on) => {
  const { clock } = pulseWorld(on, { animation: 'client' })
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
  const { clock } = pulseWorld(on, { animation: 'client' })
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
  const { clock } = pulseWorld(on, { animation: 'client' })
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
  pulseWorld(on, { animation: 'client' })
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
  pulseWorld(on, { animation: 'client', check: false })
  const ui = await mountClient($)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'pin-1', 'pin-2', 'pin-3'])
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  await ui.unmount()
})

test('client on a surface without Client: the static Button', async ($, on) => {
  pulseWorld(on, { animation: 'client' })
  const ui = await mountClient($, PULSING, 'vscode')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'check-0', 'pin-1', 'check-1', 'pin-2', 'check-2', 'pin-3', 'check-3'])
  await ui.unmount()
})

test('client in the terminal: the module mounts and the check plays its frames', async ($, on) => {
  pulseWorld(on, { animation: 'client' })
  const ui = await mountClient($, PULSING, 'terminal')
  await ui.resize({ columns: COLUMNS, rows: 1, in: 'title-1' })
  await ui.press({ key: `check-${(await clients(ui))[1].boxKey}`, in: 'title-1' })
  await ui.advance(FRAME_MS)
  expect((await checkOf(ui, 'title-1'))?.text).toBe(CHECK_FRAMES[1])
  await ui.unmount()
})

test('"check all" shows only on the last box of the last answer and checks the whole conversation', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const older = 'First.\n\n⚠️ Risk A.'
  const newer = 'Second.\n\n❓ Do B?\n\n✅ Done: x. ➡️ Next: y.'
  const mount = (requestId: string, text: string) => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
  const dimmed = async (ui: Awaited<ReturnType<typeof mount>>) =>
    (await ui.findAll({ type: 'Markdown' })).filter(m => m.props.dimColor).map(m => m.props.text)

  // An older answer drawn, a new turn arrives: only the new one is the last.
  const a = await mount('msg-a', older)
  expect(await a.find({ type: 'Button', text: 'all'})).toBeUndefined()
  await $.turn.start({ turnId: 't1' } as never)
  await $.turn.complete(turnEnd(newer))
  const b = await mount('msg-b', newer)
  expect(await a.find({ type: 'Button', text: 'all'})).toBeUndefined()
  expect((await b.findAll({ type: 'Button', text: 'all'})).map(x => x.key)).toEqual(['all-2'])
  expect(await dimmed(a)).toEqual([])
  expect(await dimmed(b)).toEqual([])

  await b.press({ key: 'all-2' })
  expect(await dimmed(a)).toEqual(['~~First.~~', '~~Risk A.~~'])
  expect(await dimmed(b)).toEqual(['~~Second.~~', '~~Do B?~~', '~~Done: x. ➡️ Next: y.~~'])
  // The button stays and the check of one box still unchecks only that box.
  expect(await b.find({ type: 'Button', text: 'all'})).toBeDefined()
  await a.press({ key: 'check-1' })
  expect(await dimmed(a)).toEqual(['~~First.~~'])
  await a.unmount()
  await b.unmount()
})
