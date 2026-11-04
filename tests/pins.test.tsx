import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { MAX_TEXT, jumpTarget, excerptOf, type Pin } from '../hooks/register'
import { PIN } from '../hooks/title'

const TEXT = 'Body.\n\n⚠️ Careful with **X** in `usp_x_pick`.\n\n✅ Done: x. ➡️ Next: y.'
const FOOTER = { terminal: '↗ jumps to the box in the chat · × unpins · Esc closes', other: '× unpins · Esc closes' }

// An in-memory store the test reads, a switchable session, and what the mod opened and toasted.
function world(on: On, start: Record<string, unknown> = {}) {
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(start))
  const session = { id: 's1' }
  const opened: { id: string; title?: string; focus?: boolean }[] = []
  const toasts: string[] = []
  on('store.get', (_, e) => ({ value: stored[e.key] }) as never)
  on('store.set', (_, e) => { stored[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } as never })
  on('session.id', () => ({ value: session.id }) as never)
  on('ui.open', (_, e) => { opened.push(e as never); return { value: { isPlaced: true, requestId: e.id } } as never })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  mock.clock(on, { now: 1_800_000_000_000 })
  const pins = () => ((stored.pins ?? {}) as Record<string, Pin[]>)[session.id] ?? []
  return { stored, session, opened, toasts, pins }
}
const mount = ($: any, surface: string, requestId = 'msg-1', text = TEXT) =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
type WithHover = { props: Record<string, unknown>; hover: Record<string, unknown> }
function withHover(node: unknown, found: WithHover[] = []): WithHover[] {
  if (!node || typeof node !== 'object') return found
  const n = node as { hover?: Record<string, unknown>; props?: Record<string, unknown>; children?: unknown[] }
  if (n.hover) found.push({ props: n.props ?? {}, hover: n.hover })
  for (const child of n.children ?? []) withHover(child, found)
  return found
}
const PANE = { plugin: 'boxis', component: 'Pane', requestId: 'boxis-pins', props: {} }

test('excerpt: the first line with text, no markdown, cut at 60 with …', () => {
  expect(excerptOf('\n\n## **Title** with [link](x.md) and `code`\nrest')).toBe('Title with link and code')
  expect(excerptOf('- item usp_x_pick')).toBe('item usp_x_pick')
  const long = excerptOf('a'.repeat(100))
  expect(long.length).toBe(60)
  expect(long.endsWith('…')).toBe(true)
})

for (const check of [true, false]) {
  test(`check ${check ? 'on' : 'off'}: the pin sits left of the check, and without check only the pin`, async ($, on) => {
    world(on, { config: { check } })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key))
        .toEqual(check ? ['pin-0', 'check-0', 'pin-1', 'check-1', 'pin-2', 'check-2'] : ['pin-0', 'pin-1', 'pin-2'])
      expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.unpinned)
      await ui.unmount()
    }
  })
}

test('pin on and off: saved in the session, the pane opens only on pinning, and the button turns 📌', async ($, on) => {
  const { opened, pins } = world(on)
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'pin-1' })
  expect(pins().map(p => ({ ...p, id: p.id.replace(/^.*:/, '*:') }))).toEqual([
    { id: '*:1', type: 'warning', title: 'warning', excerpt: 'Careful with X in usp_x_pick.', text: 'Careful with **X** in `usp_x_pick`.', requestId: 'msg-1', created: 1_800_000_000_000 },
  ])
  expect(opened).toEqual([{ id: 'boxis-pins', title: 'Pins', closeOnEscape: true }])
  expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.pinned)
  await ui.press({ key: 'pin-0' })
  expect(pins().map(p => p.type)).toEqual(['warning', 'body'])
  await ui.press({ key: 'pin-1' })
  expect(pins().map(p => p.type)).toEqual(['body'])
  expect(opened.length).toBe(2)
  expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.unpinned)
  await ui.unmount()
})

test('pane: empty says how to pin; with pins, title in the type colour, content and ×', async ($, on) => {
  const { session, pins } = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const empty = await $.ui.mount({ ...PANE, surface } as never)
    expect(await empty.find({ type: 'Text', text: `No pins yet. Use ${PIN.unpinned} on a box to pin it.` })).toBeDefined()
    expect(await empty.find({ type: 'Text', text: surface === 'terminal' ? FOOTER.terminal : FOOTER.other })).toBeDefined()
    await empty.unmount()
  }
  const msg = await mount($, 'desktop')
  await msg.press({ key: 'pin-1' })
  await msg.press({ key: 'pin-2' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const rows = (await pane.findAll({ type: 'Button' })).map((b: any) => b.key)
  expect(rows).toEqual(pins().flatMap(p => [`jump-${p.id}`, `unpin-${p.id}`]))
  expect((await pane.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  expect((await pane.find({ type: 'Text', text: /^wrap-up$/ }))?.props.color).toBe('#5CB85C')
  expect(await pane.find({ type: 'Markdown', text: /Careful with \*\*X\*\* in `usp_x_pick`\./ })).toBeDefined()
  // × unpins, and the box in the chat goes back to ⚲.
  await pane.press({ key: `unpin-${pins()[0]!.id}` })
  expect(pins().map(p => p.type)).toEqual(['wrap-up'])
  expect((await msg.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.unpinned)
  await pane.unmount()
  // Another session does not see this one's pins.
  session.id = 's2'
  const other = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect(await other.find({ type: 'Button' })).toBeUndefined()
  await other.unmount()
  await msg.unmount()
})

test('↗ is terminal only: desktop, vscode and mobile show the boxes with × alone', async ($, on) => {
  const { pins } = world(on)
  const msg = await mount($, 'desktop')
  await msg.press({ key: 'pin-1' })
  const id = pins()[0]!.id
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface } as never)
    expect((await pane.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual([`unpin-${id}`])
    expect(await pane.find({ type: 'Text', text: FOOTER.other })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /jumps/ })).toBeUndefined()
    await pane.unmount()
  }
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect((await terminal.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual([`jump-${id}`, `unpin-${id}`])
  await terminal.unmount()
  await msg.unmount()
})

test('a pin click tries to scroll to the box, and a refusal becomes a toast', async ($, on) => {
  const { toasts, pins } = world(on)
  const live = await mount($, 'terminal', 'msg_011Cg')
  await live.press({ key: 'pin-1' })
  await live.unmount()
  const pin = pins()[0]!
  expect(pin.requestId).toBe('msg_011Cg')
  // Reopened, the same answer gets another requestId; the box has no marker of its own to scroll to.
  const reopened = await mount($, 'terminal', 'b755fbd8-uuid')
  expect(await reopened.find({ type: 'Box', key: `target-${pin.id}` } as never)).toBeUndefined()
  // The test kit does not scroll the transcript: the refusal comes out in a toast, never a loose rejection.
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await pane.press({ key: `jump-${pin.id}` })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/^Could not jump to the box: /)
  await pane.unmount()
  await reopened.unmount()
})

test('client: the title carries the pin, the click posts { pin } and the hook pins and opens the pane', async ($, on) => {
  const { opened, pins } = world(on, { config: { animation: 'client' } })
  const ui = await mount($, 'desktop')
  const props = (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('title-')).map((c: any) => c.props.props)
  expect(props.map((p: any) => p.pinned)).toEqual([false, false, false])
  await ui.resize({ columns: 40, rows: 1, in: 'title-1' })
  const buttons = (await ui.findAll({ type: 'Button', in: 'title-1' } as never)).map((b: any) => b.key)
  expect(buttons).toEqual([`pin-${props[1].boxKey}`, `check-${props[1].boxKey}`])
  expect(withHover(await ui.drawn({ in: 'title-1' } as never))).toEqual([])
  await ui.press({ key: `pin-${props[1].boxKey}`, in: 'title-1' })
  expect(pins().map(p => [p.id, p.type, p.requestId])).toEqual([[props[1].boxKey, 'warning', 'msg-1']])
  expect(opened.map(a => a.id)).toEqual(['boxis-pins'])
  const after = (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('title-')).map((c: any) => c.props.props)
  expect(after.map((p: any) => p.pinned)).toEqual([false, true, false])
  // A post with on: false unpins; malformed data (no on, which would toggle) changes nothing.
  for (const data of [{ pin: 1, on: false }, { pin: props[1].boxKey }, { other: props[1].boxKey }, null]) await ui.post(data, { in: 'title-1' })
  expect(pins().length).toBe(1)
  await ui.post({ pin: props[1].boxKey, on: false }, { in: 'title-1' })
  expect(pins()).toEqual([])
  await ui.unmount()
})

test('/boxis pins opens the pins pane with focus', async ($, on) => {
  const { opened } = world(on)
  on('command.register', async ($, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'boxis', args: 'pins' } as never)
  expect(opened).toEqual([{ id: 'boxis-pins', title: 'Pins', closeOnEscape: true, focus: true }])
})

test('pinning keeps the box markdown in text, capped at 6000 with a visible … at the cut', async ($, on) => {
  const { pins } = world(on)
  const long = `Body.\n\n⚠️ ${'a'.repeat(7000)}\n\n✅ Done: x.`
  const ui = await mount($, 'desktop', 'msg-1', long)
  await ui.press({ key: 'pin-1' })
  expect(MAX_TEXT).toBe(6000)
  expect(pins()[0]!.text).toBe(`${'a'.repeat(5999)}…`)
  await ui.unmount()
})

test('the pane draws the pin as the box: border and type colour, title, content, ↗ and ×', async ($, on) => {
  const { pins } = world(on)
  const msg = await mount($, 'desktop')
  await msg.press({ key: 'pin-1' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface } as never)
    const boxes = (await pane.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor)
    expect(boxes.map((b: any) => [b.props.borderStyle, b.props.borderColor])).toEqual([['round', '#E0B040']])
    expect((await pane.find({ type: 'Text', text: /^warning$/ }))?.props.bold).toBe(true)
    expect(await pane.find({ type: 'Markdown', text: /Careful with \*\*X\*\*/ })).toBeDefined()
    const id = pins()[0]!.id
    expect((await pane.findAll({ type: 'Button' })).map((b: any) => [b.key, b.text]))
      .toEqual(surface === 'terminal' ? [[`jump-${id}`, '↗'], [`unpin-${id}`, '×']] : [[`unpin-${id}`, '×']])
    await pane.unmount()
  }
  await msg.unmount()
})

test('a table inside a pin comes out through the Boxis table drawing', async ($, on) => {
  const { pins } = world(on)
  const text = 'Body.\n\n⚠️ Look:\n\n| Item | Result |\n|---|---|\n| a | ❌ failed |\n\n✅ Done: x.'
  const msg = await mount($, 'desktop', 'msg-1', text)
  for (const b of await msg.findAll({ type: 'Button' })) if ((b as any).key.startsWith('pin-')) await msg.press({ key: (b as any).key })
  expect(pins().filter(p => /\| Item \| Result \|/.test(p.text ?? '')).length).toBe(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await pane.find({ type: 'Text', text: /^Result$/ }))?.props.wrap).toBe('wrap')
  expect(await pane.find({ type: 'Markdown', text: /❌ failed/ })).toBeDefined()
  // One frame per pinned box, plus the table's.
  const frames = (await pane.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor)
  expect(frames.length).toBe(pins().length + 1)
  await pane.unmount()
  await msg.unmount()
})

test('an old pin without text still comes out as a title and excerpt row', async ($, on) => {
  world(on, { pins: { s1: [{ id: 'old:0', type: 'warning', title: 'warning', excerpt: 'old excerpt', created: 1 }] } })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect((await pane.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor)).toEqual([])
  expect((await pane.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  expect(await pane.find({ type: 'Text', text: / old excerpt/ })).toBeDefined()
  expect((await pane.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['jump-old:0', 'unpin-old:0'])
  await pane.unmount()
})

test('↗ calls $.ui.scroll once, by the stored requestId, and × unpins', async ($, on) => {
  const { pins, toasts } = world(on)
  const msg = await mount($, 'terminal', 'msg_stored')
  await msg.press({ key: 'pin-1' })
  const pin = pins()[0]!
  // The target ↗ passes to scroll: the answer by the requestId the box had when pinned.
  expect(jumpTarget(pin)).toBe('msg_stored')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  // The kit neither implements the transcript scroll nor lets it be replaced: each call becomes a refusal toast.
  await pane.press({ key: `jump-${pin.id}` })
  expect(toasts).toEqual(['Could not jump to the box: no implementation for ui.scroll'])
  await pane.press({ key: `unpin-${pin.id}` })
  expect(pins()).toEqual([])
  expect(await pane.find({ type: 'Text', text: `No pins yet. Use ${PIN.unpinned} on a box to pin it.` })).toBeDefined()
  await pane.unmount()
  await msg.unmount()
})

const answerOf = (i: number) => `Body ${i}.\n\n⚠️ Warn ${i}.`

test('pin limit: 5 by default; the sixth pin drops the oldest of this session and says which in a toast', async ($, on) => {
  const { pins, toasts, session, stored } = world(on)
  stored.pins = { other: [{ id: 'o:0', type: 'body', title: 'answer', excerpt: 'o', created: 0 }] }
  for (let i = 0; i < 5; i++) await (async () => { const ui = await mount($, 'desktop', `m${i}`, answerOf(i)); await ui.press({ key: 'pin-1' }); await ui.unmount() })()
  expect(pins().map(p => p.excerpt)).toEqual(['Warn 0.', 'Warn 1.', 'Warn 2.', 'Warn 3.', 'Warn 4.'])
  expect(toasts).toEqual([])
  const ui = await mount($, 'desktop', 'm5', answerOf(5))
  await ui.press({ key: 'pin-1' })
  expect(pins().map(p => p.excerpt)).toEqual(['Warn 1.', 'Warn 2.', 'Warn 3.', 'Warn 4.', 'Warn 5.'])
  expect(toasts).toEqual(['Boxis: pin limit (5) reached, unpinned the oldest: warning "Warn 0."'])
  // Another session's pins never count toward this one's limit.
  expect((stored.pins as Record<string, Pin[]>).other!.length).toBe(1)
  expect(session.id).toBe('s1')
  await ui.unmount()
})

test('pin limit follows maxPins: 1 keeps only the newest; unpinning never drops anything', async ($, on) => {
  const { pins, toasts } = world(on, { config: { maxPins: 1 } })
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'pin-1' })
  await ui.press({ key: 'pin-2' })
  expect(pins().map(p => p.type)).toEqual(['wrap-up'])
  expect(toasts).toEqual(['Boxis: pin limit (1) reached, unpinned the oldest: warning "Careful with X in usp_x_pick."'])
  await ui.press({ key: 'pin-2' })
  expect(pins()).toEqual([])
  expect(toasts.length).toBe(1)
  await ui.unmount()
})

test('pin limit: a session already over the limit keeps its pins until a new pin trims it', async ($, on) => {
  const old = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}:0`, type: 'body', title: 'answer', excerpt: `h${i}`, created: i }))
  const { pins, toasts } = world(on, { pins: { s1: old } })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await pane.findAll({ type: 'Button' })).length).toBe(8)
  await pane.press({ key: 'unpin-h7:0' })
  expect(pins().length).toBe(7)
  await pane.unmount()
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'pin-1' })
  expect(pins().map(p => p.excerpt)).toEqual(['h3', 'h4', 'h5', 'h6', 'Careful with X in usp_x_pick.'])
  expect(toasts).toEqual(['Boxis: pin limit (5) reached, unpinned the oldest: answer "h0"; answer "h1"; answer "h2"'])
  await ui.unmount()
})
