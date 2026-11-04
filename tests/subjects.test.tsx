// Subject boxes from headings, 30-day pin expiry and the legacy check-mark key cleanup.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PIN_TTL_MS, dropExpired, type Pin } from '../hooks/register'

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

function world(on: On, start: Record<string, unknown> = {}) {
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(start))
  const deleted: string[] = []
  on('store.get', (_, e) => ({ value: stored[e.key] }) as never)
  on('store.set', (_, e) => { stored[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } as never })
  on('store.delete', (_, e) => { deleted.push(e.key); delete stored[e.key]; return { value: undefined } as never })
  on('session.id', () => ({ value: 's1' }) as never)
  on('ui.open', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  mock.clock(on, { now: NOW })
  return { stored, deleted }
}
const mount = ($: any, text: string, surface = 'desktop') =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', requestId: 'm1', props: { text, isFirstOfReply: true } } as never)
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
const markdown = async (ui: any) => (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.props.text as string)
const pin = (id: string, created: number): Pin => ({ id, type: 'warning', title: 'warning', excerpt: 'x', text: 'x', created })

const TWO_SUBJECTS = '### Storage\nTen KB today.\n\n### Labels\nNeed a colon.\n\n⚠️ Careful.'

test('each heading becomes a body box titled with its subject; the warning keeps its own title', async ($, on) => {
  world(on, { config: { check: false } })
  const ui = await mount($, TWO_SUBJECTS)
  const text = [...await texts(ui), ...await markdown(ui)].join(' | ')
  expect(text).toContain('Storage')
  expect(text).toContain('Labels')
  expect(text).toContain('warning')
  expect(text).not.toContain('###')
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'pin-1', 'pin-2'])
  await ui.unmount()
})

const WARNED = 'Body.\n\n⚠️ Risky thing. Verdict: note only.\n\n| Option | What |\n|---|---|\n| Keep (recommended) | the test |\n| Revert | checkout |\n\nAfter the table.'

test('the alternatives table under a warning stays in the warning box, drawn as a table', async ($, on) => {
  world(on, { config: { check: false } })
  const ui = await mount($, WARNED)
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'pin-1', 'pin-2'])
  const shown = [...await texts(ui), ...await markdown(ui)].join(' | ')
  expect(shown).toContain('Keep (recommended)')
  expect(shown).toContain('After the table.')
  await ui.unmount()
})

test('a single heading still draws its title; an answer with no heading has no title', async ($, on) => {
  world(on, { config: { check: false } })
  const titled = await mount($, '### Only subject\nSome text.')
  expect(await texts(titled)).toContain('Only subject')
  await titled.unmount()
  const plain = await mount($, 'Some text.')
  expect(await texts(plain)).not.toContain('answer')
  await plain.unmount()
})

test('a pinned subject box keeps its subject as the pin title, and the pane shows it', async ($, on) => {
  const { stored } = world(on, { config: { check: false } })
  const ui = await mount($, TWO_SUBJECTS)
  await ui.press({ key: 'pin-1' })
  const pins = (stored.pins as Record<string, Pin[]>).s1
  expect(pins.map(p => [p.type, p.title])).toEqual([['body', 'Labels']])
  await ui.unmount()
  const pane = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'Pane', requestId: 'boxis-pins', props: {} } as never)
  expect(await texts(pane)).toContain('Labels')
  await pane.unmount()
})

test('pins older than 30 days go on the next write, from every session', async ($, on) => {
  const fresh = pin('f:0', NOW - DAY)
  const old = pin('o:0', NOW - PIN_TTL_MS - 1)
  expect(dropExpired({ a: [old, fresh], b: [old] }, NOW)).toEqual({ a: [fresh] })
  const { stored } = world(on, { config: { check: false }, pins: { s1: [old], gone: [old], alive: [fresh] } })
  const ui = await mount($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  const all = stored.pins as Record<string, Pin[]>
  expect(Object.keys(all).sort()).toEqual(['alive', 's1'])
  expect(all.s1.map(p => p.excerpt)).toEqual(['Careful.'])
  await ui.unmount()
})

test('the legacy "lidas" key is read once and deleted on the next check', async ($, on) => {
  const { stored, deleted } = world(on, { lidas: ['keep:0'] })
  const ui = await mount($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'check-1' })
  expect(deleted).toContain('lidas')
  expect(stored.lidas).toBeUndefined()
  expect((stored.checked as string[])[0]).toBe('keep:0')
  await ui.unmount()
})

test('a heading with nothing under it draws a title-only box that can be pinned and shown in the pane', async ($, on) => {
  const { stored } = world(on, { config: { check: false } })
  const ui = await mount($, '### Empty\n\n⚠️ Careful.')
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['pin-0', 'pin-1'])
  expect(await texts(ui)).toContain('Empty')
  await ui.press({ key: 'pin-0' })
  const pins = (stored.pins as Record<string, Pin[]>).s1
  expect(pins.map(p => [p.type, p.title, p.text])).toEqual([['body', 'Empty', '']])
  await ui.unmount()
  const pane = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'Pane', requestId: 'boxis-pins', props: {} } as never)
  expect(await texts(pane)).toContain('Empty')
  await pane.unmount()
})

test('a check click with "checked" already stored does not touch the legacy key', async ($, on) => {
  const { deleted, stored } = world(on, { checked: ['keep:0'] })
  const ui = await mount($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'check-1' })
  expect(deleted).toEqual([])
  expect((stored.checked as string[]).length).toBe(2)
  await ui.unmount()
})

test('pin expiry boundary: exactly PIN_TTL_MS old is dropped, one millisecond younger is kept', () => {
  const edge = pin('edge:0', NOW - PIN_TTL_MS)
  const inside = pin('in:0', NOW - PIN_TTL_MS + 1)
  expect(dropExpired({ a: [edge, inside] }, NOW)).toEqual({ a: [inside] })
})

test('the pins pane shows no "answer" title for a body pin without a heading', async ($, on) => {
  const { stored } = world(on, { config: { check: false } })
  const ui = await mount($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-0' })
  expect((stored.pins as Record<string, Pin[]>).s1.map(p => p.title)).toEqual(['answer'])
  await ui.unmount()
  const pane = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'Pane', requestId: 'boxis-pins', props: {} } as never)
  expect(await texts(pane)).not.toContain('answer')
  await pane.unmount()
})

test('pinning reads the pin limit from the store, not from a stale copy', async ($, on) => {
  const { stored } = world(on, { config: { check: false } })
  const ui = await mount($, TWO_SUBJECTS)
  // Another window lowered the limit after this one drew the answer.
  stored.config = { check: false, maxPins: 1 }
  await ui.press({ key: 'pin-0' })
  await ui.press({ key: 'pin-1' })
  expect((stored.pins as Record<string, Pin[]>).s1.map(p => p.title)).toEqual(['Labels'])
  await ui.unmount()
})

test('session start reads the config from the store again', async ($, on) => {
  const { stored } = world(on, { config: { check: false } })
  on('command.register', async ($, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  const borders = async () => {
    const ui = await mount($, 'Body.')
    const n = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor).length
    await ui.unmount()
    return n
  }
  expect(await borders()).toBe(1)
  // Another window turned the boxes off; this one picks it up on its next session start.
  stored.config = { enabled: false }
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(await borders()).toBe(0)
})
