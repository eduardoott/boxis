// Regressions from the 0.12.0 review findings: each test fails on the code from before the fix.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { split } from '../hooks/split'
import { splitTables } from '../hooks/table'
import { DEFAULTS, apply, readConfig } from '../hooks/config'
import { openFence, fenceOpenAtEnd, closesFence } from '../hooks/fence'
import { FRAME_MS, CHECK_FRAMES } from '../hooks/title'
import { MAX_TEXT, PANE_BUDGET, PINS_BUDGET, fitBudget, startClosing, register, pinText, titleFailed, type Pin } from '../hooks/register'

type Options = { failSet?: (key: string) => boolean; noSession?: boolean }
function world(on: On, start: Record<string, unknown> = {}, op: Options = {}) {
  const disk: Record<string, unknown> = JSON.parse(JSON.stringify(start))
  const session = { id: 's1' }
  const opened: string[] = []
  const toasts: string[] = []
  on('store.get', (_, e) => ({ value: disk[e.key] }) as never)
  on('store.set', (_, e) => {
    if (op.failSet?.(e.key)) throw new Error('store full')
    disk[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined } as never
  })
  on('session.id', () => {
    if (op.noSession) throw new Error('no session')
    return { value: session.id } as never
  })
  on('ui.open', (_, e) => { opened.push((e as any).id); return { value: { isPlaced: true, requestId: (e as any).id } } as never })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const pins = () => ((disk.pins ?? {}) as Record<string, Pin[]>)[session.id] ?? []
  return { disk, session, opened, toasts, pins, clock }
}
const msg = ($: any, text: string, requestId = 'm1', surface = 'desktop') =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
const pane = ($: any, requestId: string, surface = 'desktop') =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'Pane', requestId, props: {} } as never)
const turnEnd = (answer: string) => ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' }) as never
const pin = (id: string, created: number, text?: string): Pin => ({ id, type: 'warning', title: 'warning', excerpt: 'x', created, ...(text === undefined ? {} : { text }) })
const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

// 1. Engine limits.

test('pins: over the budget, the oldest of other sessions go before this one\'s', () => {
  const big = 'a'.repeat(1000)
  const all = {
    old: [pin('v0', 1, big), pin('v1', 5, big)],
    other: [pin('o0', 2, big)],
    current: [pin('a0', 0, big), pin('a1', 9, big)],
  }
  const budget = size(all) - 1500
  const r = fitBudget(all, 'current', budget)
  expect(size(r)).toBeLessThanOrEqual(budget)
  // v0 (1) and o0 (2) went, the oldest outside; a0 (0) of this session stayed, though older.
  expect(r).toEqual({ old: [all.old[1]], current: all.current })
  expect(fitBudget(all, 'current', size(all))).toBe(all)
})

test('pins: pinning with the store full of other sessions keeps the pins key under 1.5 MiB', async ($, on) => {
  // Two UTF-8 bytes per character: the budget counts bytes, not characters.
  const big = 'é'.repeat(MAX_TEXT)
  const others: Record<string, Pin[]> = {}
  for (let s = 0; s < 3; s++) others[`s${s + 2}`] = Array.from({ length: 100 }, (_, i) => pin(`x${s}-${i}:0`, s * 1000 + i, big))
  expect(size(others)).toBeGreaterThan(PINS_BUDGET)
  const { disk, pins } = world(on, { pins: others })
  const ui = await msg($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  expect(size(disk.pins)).toBeLessThanOrEqual(PINS_BUDGET)
  expect(pins().map(p => p.type)).toEqual(['warning'])
  // What is left of the others is the newest.
  const s4 = (disk.pins as Record<string, Pin[]>).s4
  expect(s4.at(-1)!.id).toBe('x2-99:0')
  expect(s4.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('pins pane: full boxes from the newest back up to the budget, the old ones as rows, in the same order', async ($, on) => {
  const list = Array.from({ length: 17 }, (_, i) => pin(`h${i}:0`, i, 'a'.repeat(MAX_TEXT)))
  world(on, { pins: { s1: list } })
  const p = await pane($, 'boxis-pins')
  const markdown = (await p.findAll({ type: 'Markdown' })).reduce((n: number, m: any) => n + String(m.props.text).length, 0)
  expect(markdown).toBeLessThanOrEqual(PANE_BUDGET)
  const full = Math.floor(PANE_BUDGET / MAX_TEXT)
  expect((await p.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor).length).toBe(full)
  expect((await p.findAll({ type: 'Box' })).filter((b: any) => b.key?.startsWith('pin-')).map((b: any) => b.key))
    .toEqual(list.map(x => `pin-${x.id}`))
  // The oldest become rows: title and excerpt, no frame.
  expect((await p.findAll({ type: 'Text', text: ' x' })).length).toBe(17 - full)
  await p.unmount()
})

test('pinText: cut with a visible …, closing the open fence (of 3 or 4) within the cap', () => {
  for (const fence of ['```', '````', '~~~']) {
    const t = pinText(`Look:\n${fence}js\n${'x'.repeat(7000)}\n${fence}`)
    expect(t.length).toBeLessThanOrEqual(MAX_TEXT)
    expect(t.endsWith(`…\n${fence}`)).toBe(true)
    expect(fenceOpenAtEnd(t)).toBeNull()
  }
  const loose = pinText('y'.repeat(7000))
  expect(loose).toBe(`${'y'.repeat(MAX_TEXT - 1)}…`)
  expect(pinText('short')).toBe('short')
})

// 2. A failed write becomes a toast.

test('failed writes: pin, check, all and the config pane warn in a toast', async ($, on) => {
  const { toasts } = world(on, {}, { failSet: () => true })
  await $.turn.complete(turnEnd('Body.\n\n⚠️ Careful.'))
  const ui = await msg($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  await ui.press({ key: 'check-1' })
  await ui.press({ key: 'all-1' })
  const cfg = await pane($, 'boxis-config')
  await cfg.press({ key: 'intensity-up' })
  expect(toasts).toEqual(['Boxis: could not save the pins', 'Boxis: could not save the check marks', 'Boxis: could not save the check marks', 'Boxis: could not save the config'])
  // Nothing changed on screen: the memory copy only changes after the write.
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeUndefined()
  expect(await cfg.find({ type: 'Text', text: /^ 50$/ })).toBeDefined()
  await cfg.unmount()
  await ui.unmount()
})

test('design tool: a failed store read becomes { deny }, not a "done"', async ($, on) => {
  on('store.get', () => { throw new Error('disk gone') })
  const r = await $.tool.call({ tool: 'mcp__boxis__design', input: { intensity: 30 } } as never)
  expect(JSON.stringify(r)).toMatch(/deny/)
})

// 3. CLI and app on the same store.

test('config: a change reads the store again and keeps what the other process wrote', async ($, on) => {
  const { disk } = world(on)
  const ui = await pane($, 'boxis-config')
  disk.config = { ...((disk.config as object) ?? {}), intensity: 80 }
  await ui.press({ key: 'check' })
  expect(disk.config).toMatchObject({ intensity: 80, check: false })
  await ui.unmount()
})

test('pin: × on a pin the other process already unpinned does not pin it again', async ($, on) => {
  const { disk, pins } = world(on)
  const m = await msg($, 'Body.\n\n⚠️ Careful.')
  await m.press({ key: 'pin-1' })
  const id = pins()[0]!.id
  const p = await pane($, 'boxis-pins')
  disk.pins = { s1: [] }
  await p.press({ key: `unpin-${id}` })
  expect(pins()).toEqual([])
  await p.unmount()
  await m.unmount()
})

test('check: a click on the stale copy applies the state shown, and does not toggle the disk one', async ($, on) => {
  const { disk } = world(on)
  const m = await msg($, 'Body.\n\n⚠️ Careful.')
  await m.press({ key: 'check-1' })
  expect((disk.checked as string[]).length).toBe(1)
  // The other process unchecked; this screen still shows ✓ and the click wants to uncheck.
  disk.checked = []
  await m.press({ key: 'check-1' })
  expect(disk.checked).toEqual([])
  await m.unmount()
})

test('client: "all" in the middle of the check frames is not undone at their end', async ($, on) => {
  const { clock } = world(on, { config: { animation: 'client' } })
  const ui = await msg($, 'Body.\n\n⚠️ Careful.\n\n❓ A or B?')
  const props = async () => (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('title-')).map((c: any) => c.props.props)
  await ui.resize({ columns: 40, rows: 1, in: 'title-1' })
  const key = (await props())[1].boxKey
  await ui.press({ key: `check-${key}`, in: 'title-1' })
  await ui.advance(FRAME_MS)
  await ui.post({ all: true }, { in: 'title-2' })
  expect((await props())[1].checked).toBe(true)
  await ui.advance(FRAME_MS * CHECK_FRAMES.length)
  await clock.advance(2000)
  expect((await props())[1].checked).toBe(true)
  // And the check is still alive: the next click unchecks.
  await ui.press({ key: `check-${key}`, in: 'title-1' })
  expect((await props())[1].checked).toBe(false)
  expect(((await ui.findAll({ type: 'Text', in: 'title-1' } as never)).at(-1) as any)?.text).toBe('○')
  await ui.unmount()
})

// 4. "all" in a long conversation.

test('all: with over 500 boxes and the answer arriving in chunks, checks the whole conversation', async ($, on) => {
  const { disk } = world(on)
  const answer = (i: number) => `Body ${i}.\n\n⚠️ Warn ${i}.\n\n❓ Q ${i}?\n\n✅ Done ${i}.`
  const N = 130
  for (let i = 0; i < N; i++) await (await msg($, answer(i), `m${i}`)).unmount()
  await $.turn.start({ text: 'hi', turnId: 't' } as never)
  const last = answer(N)
  for (let k = 10; k < last.length; k += 10) await (await msg($, last.slice(0, k), `m${N}`)).unmount()
  await $.turn.complete(turnEnd(last))
  const ui = await msg($, last, `m${N}`)
  await ui.press({ key: 'all-3' })
  await ui.unmount()
  // Only the boxes of whole answers: the streaming chunks are left out.
  expect((disk.checked as string[]).length).toBe((N + 1) * 4)
  const first = await msg($, answer(0), 'm0')
  expect((await first.findAll({ type: 'Text', text: '✓' })).length).toBe(4)
  await first.unmount()
})

test('check marks: at the 2000 cap the latest checked stay, even those "all" checks again', async ($, on) => {
  const { disk } = world(on)
  const text = 'Body.\n\n⚠️ Careful.'
  await $.turn.complete(turnEnd(text))
  const ui = await msg($, text)
  await ui.press({ key: 'check-0' })
  const x = (disk.checked as string[])[0]!
  const junk = Array.from({ length: 1999 }, (_, i) => `old${i}:0`)
  disk.checked = [x, ...junk]
  await ui.press({ key: 'all-1' })
  const checked = disk.checked as string[]
  expect(checked.length).toBe(2000)
  expect(checked.slice(-2)).toEqual([x, x.replace(/:0$/, ':1')])
  expect(checked.includes('old0:0')).toBe(false)
  await ui.unmount()
})

// 5. Fences of 4 or more.

test('fence: closes only with the same character, a run at least as long and no info string', () => {
  const four = openFence('````md')!
  expect(four).toEqual({ char: '`', n: 4 })
  expect(closesFence('```', four)).toBe(false)
  expect(closesFence('~~~~', four)).toBe(false)
  expect(closesFence('````js', four)).toBe(false)
  expect(closesFence('`````', four)).toBe(true)
  expect(closesFence('  ````  ', four)).toBe(true)
  expect(openFence('```a`b')).toBeNull()
})

test('fence of 4: split, table and strikethrough do not treat the inner fence as the end of the block', async ($, on) => {
  const t = 'Example:\n\n````md\n```\n❓ inside the inner code block\n| a | b |\n|---|---|\n```\n````\n\nend'
  expect(split(t).map(p => p.type)).toEqual(['body'])
  expect(splitTables(t).some(x => x.kind === 'table')).toBe(false)
  expect(splitTables('~~~~\n~~~\n| a | b |\n|---|---|\n~~~~\n| c | d |\n|---|---|').map(x => x.kind)).toEqual(['text', 'table'])
  world(on)
  const ui = await msg($, 'Body:\n````md\n```\nline\n```\n````\nend')
  await ui.press({ key: 'check-0' })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('~~Body:~~\n````md\n```\nline\n```\n````\n~~end~~')
  await ui.unmount()
})

// 6. Dead code.

test('animation: a saved svg reads as none, and the pane button cycles only the three', async ($, on) => {
  expect(readConfig({ animation: 'svg' }).animation).toBe('none')
  expect('error' in apply(DEFAULTS, { animation: 'svg' })).toBe(true)
  world(on)
  const ui = await pane($, 'boxis-config')
  const labels = []
  for (let i = 0; i < 4; i++) {
    labels.push((await ui.find({ type: 'Button', key: 'animation' }))?.text)
    await ui.press({ key: 'animation' })
  }
  expect(labels).toEqual(['animation: none', 'animation: clock', 'animation: client', 'animation: none'])
  await ui.unmount()
})

test('↗ on a pin with no known answer says it cannot reach it, without trying to scroll', async ($, on) => {
  const { toasts } = world(on, { pins: { s1: [pin('never:0', 1, 'text')] } })
  const p = await pane($, 'boxis-pins', 'terminal')
  await p.press({ key: 'jump-never:0' })
  expect(toasts).toEqual(['Could not jump to the box: its answer was not drawn in this session'])
  await p.unmount()
})

// 7. The small ones.

test('config: a prototype key is not a type name', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    expect('error' in apply(DEFAULTS, { types: { [name]: { color: '#000000' } } })).toBe(true)
  }
})

test('table: the separator needs the header\'s column count', () => {
  expect(splitTables('Run cat x | grep y\n---\nmore').some(x => x.kind === 'table')).toBe(false)
  expect(splitTables('| a | b |\n|---|---|\n| 1 | 2 |').map(x => x.kind)).toEqual(['table'])
  expect(splitTables('a | b\n--- | ---\n1 | 2').map(x => x.kind)).toEqual(['table'])
})

test('pins without a session id: nothing read or written under the empty key, and a toast', async ($, on) => {
  const { disk, toasts } = world(on, { pins: { '': [pin('empty:0', 1, 'nobody\'s')] } }, { noSession: true })
  const ui = await msg($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  expect(toasts).toEqual(['Boxis: could not save the pins: no session id'])
  expect(disk.pins).toEqual({ '': [pin('empty:0', 1, 'nobody\'s')] })
  const p = await pane($, 'boxis-pins', 'terminal')
  expect(await p.find({ type: 'Button', key: 'jump-empty:0' })).toBeUndefined()
  await p.unmount()
  await ui.unmount()
})

test('closing: when clock.after fails, the every tick is cancelled', () => {
  let cancelled = 0
  const invalidated: string[] = []
  const $ = {
    clock: { every: () => ({ cancel: () => { cancelled++ } }), after: () => { throw new Error('no clock') } },
    ui: { invalidate: (h: string) => { invalidated.push(h) } },
  }
  startClosing($ as never, 'k:0')
  expect(cancelled).toBe(1)
  // Out of the map: a second request starts over, and is not ignored as "already closing".
  startClosing($ as never, 'k:0')
  expect(cancelled).toBe(2)
})

// The kit cannot make title.tsx fail nor raise ui.fault: the hook is called directly, and the
// fallback title line is the same one a surface without Client draws (box.test).
test('ui.fault on the Client title: that answer\'s box falls back to the plain title line', async () => {
  const hooks: Record<string, Function> = {}
  const on = ((name: string, a: unknown, b?: unknown) => {
    hooks[name] = (typeof a === 'function' ? a : b) as Function
    return { catch: () => undefined }
  }) as never
  register(on, {} as never)
  const next = (e: unknown) => ({ seen: e })
  const fault = { surface: 'desktop', component: 'AssistantMessage', requestId: 'mf', element: 'title-1', module: 'hooks/title.tsx', phase: 'render', reason: 'boom' }
  expect(titleFailed('mf', 'title-1')).toBe(false)
  expect(await hooks['ui.fault']({}, fault, next)).toEqual({ seen: fault })
  expect(titleFailed('mf', 'title-1')).toBe(true)
  expect(titleFailed('mf', 'title-0')).toBe(false)
  expect(titleFailed('other', 'title-1')).toBe(false)
  // A failing glow does not count: only the title has a plain line to fall back to.
  await hooks['ui.fault']({}, { ...fault, element: 'rim-top-1' }, next)
  expect(titleFailed('mf', 'rim-top-1')).toBe(false)
})
