// Stores written by earlier versions use Portuguese keys and values. These tests seed those legacy
// shapes and check that reads return the current shape and that writes use only the current one.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DEFAULTS, readConfig } from '../hooks/config'
import { readAllPins, readPin, signature, type Pin } from '../hooks/register'

// The shape of a real store from before the translation.
const LEGACY_STORE = {
  config: { ligado: true, intensidade: 50, claro: false, check: true, animacao: 'client', tipos: {} },
  lidas: ['abc.1x:0'],
  pins: { s1: [{ id: 'abc.1x:1', tipo: 'aviso', titulo: 'warning', trecho: 'Careful.', requestId: 'r1', criado: 0, texto: 'Careful.' }] },
}

function world(on: On, start: Record<string, unknown>) {
  const disk: Record<string, unknown> = JSON.parse(JSON.stringify(start))
  on('store.get', (_, e) => ({ value: disk[e.key] }) as never)
  on('store.set', (_, e) => { disk[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } as never })
  on('session.id', () => ({ value: 's1' }) as never)
  on('ui.open', (_, e) => ({ value: { isPlaced: true, requestId: (e as any).id } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  mock.clock(on, { now: 5 })
  return disk
}

test('config: the real legacy store reads as the current shape', () => {
  expect(readConfig(LEGACY_STORE.config)).toEqual({ ...DEFAULTS, skin: 'animated-i' })
})

test('config: every legacy field, type key and value maps to the current one', () => {
  const legacy = {
    ligado: false, intensidade: 30, claro: true, check: false, animacao: 'relogio',
    tipos: { aviso: { cor: '#112233', fundo: 'nenhum' }, sobreVoce: { fundo: '#445566' }, fechamento: { cor: '#778899' }, banana: { cor: '#000000' } },
  }
  expect(readConfig(legacy)).toEqual({
    enabled: false, intensity: 30, light: true, check: false, skin: 'animated-i', buttons: 'top', maxPins: 5, unlimitedPins: false,
    types: { warning: { color: '#112233', background: 'none' }, 'about-you': { background: '#445566' }, 'wrap-up': { color: '#778899' } },
  })
  expect(readConfig({ animacao: 'nenhuma' }).skin).toBe('none')
  expect(readConfig({ animacao: 'relogio' }).skin).toBe('animated-i')
})

test('config: a current key wins over its legacy name, entry by entry', () => {
  const mixed = { ligado: false, enabled: true, intensidade: 10, intensity: 70, tipos: { aviso: { cor: '#111111' } }, types: { warning: { color: '#222222' } } }
  const cfg = readConfig(mixed)
  expect(cfg.enabled).toBe(true)
  expect(cfg.intensity).toBe(70)
  expect(cfg.types.warning).toEqual({ color: '#222222' })
})

test('config: the current shape reads back unchanged', () => {
  const current = { enabled: false, intensity: 20, light: true, check: true, skin: 'animated-ii', buttons: 'bottom', maxPins: 3, unlimitedPins: false, types: { decision: { color: '#ABCDEF', background: 'none' } } }
  expect(readConfig(current)).toEqual(current)
})

test('pins: a legacy pin reads as the current shape; malformed ones are dropped', () => {
  const legacy = LEGACY_STORE.pins.s1[0]
  const expected: Pin = { id: 'abc.1x:1', type: 'warning', title: 'warning', excerpt: 'Careful.', text: 'Careful.', requestId: 'r1', created: 0 }
  expect(readPin(legacy)).toEqual(expected)
  expect(readPin({ ...legacy, tipo: 'sobreVoce' })?.type).toBe('about-you')
  const { text: _, ...noText } = expected
  expect(readPin({ ...legacy, tipo: 'corpo', texto: undefined })).toEqual({ ...noText, type: 'body' })
  expect(readPin(expected)).toEqual(expected)
  expect(readPin({ ...legacy, tipo: 'banana' })).toBeNull()
  expect(readPin({ ...legacy, criado: 'x' })).toBeNull()
  expect(readAllPins({ s1: [legacy, { id: 1 }], s2: 'x', s3: [expected] })).toEqual({ s1: [expected], s3: [expected] })
})

test('store: a legacy store draws its check marks and pins, and the next writes use only the current shape', async ($, on) => {
  // The legacy 'nenhuma' animation keeps the static title line, whose buttons the test presses.
  const disk = world(on, { ...LEGACY_STORE, config: { ...LEGACY_STORE.config, animacao: 'nenhuma' } })
  const text = 'Body.\n\n⚠️ Careful.'
  const id = signature(text)

  // The marks only under the legacy key, the pin in the legacy shape, both with this answer's ids.
  disk.lidas = [`${id}:0`]
  disk.pins = { s1: [{ ...LEGACY_STORE.pins.s1[0], id: `${id}:1` }] }
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId: 'r1', props: { text, isFirstOfReply: true } } as never)
  expect((await ui.findAll({ type: 'Text', text: '✓' })).length).toBe(1)
  expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe('📌')

  await ui.press({ key: 'pin-0' })
  expect(disk.pins).toEqual({ s1: [
    { id: `${id}:1`, type: 'warning', title: 'warning', excerpt: 'Careful.', text: 'Careful.', requestId: 'r1', created: 0 },
    { id: `${id}:0`, type: 'body', title: 'answer', excerpt: 'Body.', text: 'Body.', requestId: 'r1', created: 5 },
  ] })
  // Checking a pinned box unpins it.
  await ui.press({ key: 'check-1' })
  expect(disk.checked).toEqual([`${id}:0`, `${id}:1`])
  expect(disk.pins).toEqual({ s1: [{ id: `${id}:0`, type: 'body', title: 'answer', excerpt: 'Body.', text: 'Body.', requestId: 'r1', created: 5 }] })
  await ui.unmount()

  const cfg = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'Pane', requestId: 'boxis-config', props: {} } as never)
  await cfg.press({ key: 'intensity-up' })
  expect(disk.config).toEqual({ enabled: true, intensity: 60, light: false, check: true, skin: 'none', buttons: 'top', maxPins: 5, unlimitedPins: false, types: {} })
  await cfg.unmount()
})
