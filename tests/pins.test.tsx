import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { MAX_TEXTO, destinoDo, trechoDe, type Pin } from '../hooks/register'
import { PIN } from '../hooks/titulo'

const TEXTO = 'Corpo.\n\n⚠️ Cuidado com **X** em `usp_ww_pick`.\n\n✅ Feito: x. ➡️ Planejado: y.'

// Store em memória que o teste lê, uma sessão trocável, e o que o mod abriu e avisou.
function mundo(on: On, inicio: Record<string, unknown> = {}) {
  const guardado: Record<string, unknown> = JSON.parse(JSON.stringify(inicio))
  const sessao = { id: 's1' }
  const abertos: { id: string; title?: string; focus?: boolean }[] = []
  const toasts: string[] = []
  on('store.get', (_, e) => ({ value: guardado[e.key] }) as never)
  on('store.set', (_, e) => { guardado[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } as never })
  on('session.id', () => ({ value: sessao.id }) as never)
  on('ui.open', (_, e) => { abertos.push(e as never); return { value: { isPlaced: true, requestId: e.id } } as never })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  mock.clock(on, { now: 1_800_000_000_000 })
  const pins = () => ((guardado.pins ?? {}) as Record<string, Pin[]>)[sessao.id] ?? []
  return { guardado, sessao, abertos, toasts, pins }
}
const montar = ($: any, surface: string, requestId = 'msg-1', text = TEXTO) =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
type ComHover = { props: Record<string, unknown>; hover: Record<string, unknown> }
function comHover(no: unknown, achados: ComHover[] = []): ComHover[] {
  if (!no || typeof no !== 'object') return achados
  const n = no as { hover?: Record<string, unknown>; props?: Record<string, unknown>; children?: unknown[] }
  if (n.hover) achados.push({ props: n.props ?? {}, hover: n.hover })
  for (const filho of n.children ?? []) comHover(filho, achados)
  return achados
}
const PAINEL = { plugin: 'boxis', component: 'Pane', requestId: 'boxis-pins', props: {} }

test('trecho: primeira linha com texto, sem markdown, cortada em 60 com …', () => {
  expect(trechoDe('\n\n## **Título** com [link](x.md) e `code`\nresto')).toBe('Título com link e code')
  expect(trechoDe('- item usp_ww_pick')).toBe('item usp_ww_pick')
  const longo = trechoDe('a'.repeat(100))
  expect(longo.length).toBe(60)
  expect(longo.endsWith('…')).toBe(true)
})

for (const check of [true, false]) {
  test(`check ${check ? 'on' : 'off'}: o pin fica à esquerda do check, e sem check fica só o pin`, async ($, on) => {
    mundo(on, { config: { check } })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await montar($, surface)
      expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key))
        .toEqual(check ? ['pin-0', 'lida-0', 'pin-1', 'lida-1', 'pin-2', 'lida-2'] : ['pin-0', 'pin-1', 'pin-2'])
      expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.solta)
      await ui.unmount()
    }
  })
}

test('pin liga e desliga: grava na sessão, abre o painel só ao fixar, e o botão vira 📌', async ($, on) => {
  const { abertos, pins } = mundo(on)
  const ui = await montar($, 'desktop')
  await ui.press({ key: 'pin-1' })
  expect(pins().map(p => ({ ...p, id: p.id.replace(/^.*:/, '*:') }))).toEqual([
    { id: '*:1', tipo: 'aviso', titulo: 'warning', trecho: 'Cuidado com X em usp_ww_pick.', texto: 'Cuidado com **X** em `usp_ww_pick`.', requestId: 'msg-1', criado: 1_800_000_000_000 },
  ])
  expect(abertos).toEqual([{ id: 'boxis-pins', title: 'Pins', closeOnEscape: true }])
  expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.fixada)
  await ui.press({ key: 'pin-0' })
  expect(pins().map(p => p.tipo)).toEqual(['aviso', 'corpo'])
  await ui.press({ key: 'pin-1' })
  expect(pins().map(p => p.tipo)).toEqual(['corpo'])
  expect(abertos.length).toBe(2)
  expect((await ui.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.solta)
  await ui.unmount()
})

test('painel: vazio diz como fixar; com pins, título na cor do tipo, trecho e ×', async ($, on) => {
  const { sessao, pins } = mundo(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const vazio = await $.ui.mount({ ...PAINEL, surface } as never)
    expect(await vazio.find({ type: 'Text', text: `No pins yet. Use ${PIN.solta} on a box to pin it.` })).toBeDefined()
    expect(await vazio.find({ type: 'Text', text: '↗ jumps to the box in the chat · × unpins · Esc closes' })).toBeDefined()
    await vazio.unmount()
  }
  const msg = await montar($, 'desktop')
  await msg.press({ key: 'pin-1' })
  await msg.press({ key: 'pin-2' })
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  const linhas = (await painel.findAll({ type: 'Button' })).map((b: any) => b.key)
  expect(linhas).toEqual(pins().flatMap(p => [`ir-${p.id}`, `soltar-${p.id}`]))
  expect((await painel.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  expect((await painel.find({ type: 'Text', text: /^wrap-up$/ }))?.props.color).toBe('#5CB85C')
  expect(await painel.find({ type: 'Markdown', text: /Cuidado com \*\*X\*\* em `usp_ww_pick`\./ })).toBeDefined()
  // O × solta o pin, e a caixa no chat volta ao ⚲.
  await painel.press({ key: `soltar-${pins()[0]!.id}` })
  expect(pins().map(p => p.tipo)).toEqual(['fechamento'])
  expect((await msg.find({ type: 'Button', key: 'pin-1' }))?.text).toBe(PIN.solta)
  await painel.unmount()
  // Outra sessão não vê os pins desta.
  sessao.id = 's2'
  const outra = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  expect(await outra.find({ type: 'Button' })).toBeUndefined()
  await outra.unmount()
  await msg.unmount()
})

test('clique no pin tenta rolar até a caixa marcada, e a recusa vira toast', async ($, on) => {
  const { toasts, pins } = mundo(on)
  const ao_vivo = await montar($, 'desktop', 'msg_011Cg')
  await ao_vivo.press({ key: 'pin-1' })
  await ao_vivo.unmount()
  const pin = pins()[0]!
  expect(pin.requestId).toBe('msg_011Cg')
  // Reaberta, a mesma resposta ganha outro requestId; a caixa não tem mais marca própria para rolar.
  const reaberta = await montar($, 'desktop', 'b755fbd8-uuid')
  expect(await reaberta.find({ type: 'Box', key: `alvo-${pin.id}` } as never)).toBeUndefined()
  // O kit de teste não rola o transcript: a recusa sai num toast, sem rejeição solta.
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  await painel.press({ key: `ir-${pin.id}` })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/^Could not jump to the box: /)
  await painel.unmount()
  await reaberta.unmount()
})

test('client: o título traz o pin, o clique posta { pin } e o hook fixa e abre o painel', async ($, on) => {
  const { abertos, pins } = mundo(on, { config: { animacao: 'client' } })
  const ui = await montar($, 'desktop')
  const props = (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('titulo-')).map((c: any) => c.props.props)
  expect(props.map((p: any) => p.fixada)).toEqual([false, false, false])
  await ui.resize({ columns: 40, rows: 1, in: 'titulo-1' })
  const botoes = (await ui.findAll({ type: 'Button', in: 'titulo-1' } as never)).map((b: any) => b.key)
  expect(botoes).toEqual([`pin-${props[1].chave}`, `check-${props[1].chave}`])
  expect(comHover(await ui.drawn({ in: 'titulo-1' } as never))).toEqual([])
  await ui.press({ key: `pin-${props[1].chave}`, in: 'titulo-1' })
  expect(pins().map(p => [p.id, p.tipo, p.requestId])).toEqual([[props[1].chave, 'aviso', 'msg-1']])
  expect(abertos.map(a => a.id)).toEqual(['boxis-pins'])
  const depois = (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('titulo-')).map((c: any) => c.props.props)
  expect(depois.map((p: any) => p.fixada)).toEqual([false, true, false])
  // Post com on: false solta; dado torto (sem on, que alternaria) não mexe.
  for (const data of [{ pin: 1, on: false }, { pin: props[1].chave }, { outra: props[1].chave }, null]) await ui.post(data, { in: 'titulo-1' })
  expect(pins().length).toBe(1)
  await ui.post({ pin: props[1].chave, on: false }, { in: 'titulo-1' })
  expect(pins()).toEqual([])
  await ui.unmount()
})

test('/boxis pins abre o painel de pins com o foco', async ($, on) => {
  const { abertos } = mundo(on)
  on('command.register', async ($, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'boxis', args: 'pins' } as never)
  expect(abertos).toEqual([{ id: 'boxis-pins', title: 'Pins', closeOnEscape: true, focus: true }])
})

test('fixar guarda o markdown da caixa em texto, com teto de 6000 e um … visível no corte', async ($, on) => {
  const { pins } = mundo(on)
  const longo = `Corpo.\n\n⚠️ ${'a'.repeat(7000)}\n\n✅ Feito: x.`
  const ui = await montar($, 'desktop', 'msg-1', longo)
  await ui.press({ key: 'pin-1' })
  expect(MAX_TEXTO).toBe(6000)
  expect(pins()[0]!.texto).toBe(`${'a'.repeat(5999)}…`)
  await ui.unmount()
})

test('painel desenha o pin como a caixa: borda e cor do tipo, título, conteúdo, ↗ e ×', async ($, on) => {
  const { pins } = mundo(on)
  const msg = await montar($, 'desktop')
  await msg.press({ key: 'pin-1' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const painel = await $.ui.mount({ ...PAINEL, surface } as never)
    const caixas = (await painel.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor)
    expect(caixas.map((b: any) => [b.props.borderStyle, b.props.borderColor])).toEqual([['round', '#E0B040']])
    expect((await painel.find({ type: 'Text', text: /^warning$/ }))?.props.bold).toBe(true)
    expect(await painel.find({ type: 'Markdown', text: /Cuidado com \*\*X\*\*/ })).toBeDefined()
    expect((await painel.findAll({ type: 'Button' })).map((b: any) => [b.key, b.text]))
      .toEqual([[`ir-${pins()[0]!.id}`, '↗'], [`soltar-${pins()[0]!.id}`, '×']])
    await painel.unmount()
  }
  await msg.unmount()
})

test('tabela dentro do pin sai pelo desenho de tabela do Boxis', async ($, on) => {
  const { pins } = mundo(on)
  const texto = 'Corpo.\n\n⚠️ Olha:\n\n| Item | Situação |\n|---|---|\n| a | ❌ falhou |\n\n✅ Feito: x.'
  const msg = await montar($, 'desktop', 'msg-1', texto)
  for (const b of await msg.findAll({ type: 'Button' })) if ((b as any).key.startsWith('pin-')) await msg.press({ key: (b as any).key })
  expect(pins().filter(p => /\| Item \| Situação \|/.test(p.texto ?? '')).length).toBe(1)
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  expect((await painel.find({ type: 'Text', text: /^Situação$/ }))?.props.wrap).toBe('wrap')
  expect(await painel.find({ type: 'Markdown', text: /❌ falhou/ })).toBeDefined()
  // Uma moldura por caixa fixada, mais a da tabela.
  const molduras = (await painel.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor)
  expect(molduras.length).toBe(pins().length + 1)
  await painel.unmount()
  await msg.unmount()
})

test('pin antigo sem texto ainda sai como linha de título e trecho', async ($, on) => {
  mundo(on, { pins: { s1: [{ id: 'velho:0', tipo: 'aviso', titulo: 'warning', trecho: 'trecho antigo', criado: 1 }] } })
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  expect((await painel.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor)).toEqual([])
  expect((await painel.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  expect(await painel.find({ type: 'Text', text: / trecho antigo/ })).toBeDefined()
  expect((await painel.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['ir-velho:0', 'soltar-velho:0'])
  await painel.unmount()
})

test('↗ chama o $.ui.scroll uma vez, pelo requestId guardado, e × solta o pin', async ($, on) => {
  const { pins, toasts } = mundo(on)
  const msg = await montar($, 'desktop', 'msg_guardado')
  await msg.press({ key: 'pin-1' })
  const pin = pins()[0]!
  // O alvo que o ↗ passa ao scroll: a resposta pelo requestId que a caixa tinha ao ser fixada.
  expect(destinoDo(pin)).toBe('msg_guardado')
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  // O kit não implementa o scroll do transcript nem deixa trocá-lo: cada chamada vira um toast de recusa.
  await painel.press({ key: `ir-${pin.id}` })
  expect(toasts).toEqual(['Could not jump to the box: no implementation for ui.scroll'])
  await painel.press({ key: `soltar-${pin.id}` })
  expect(pins()).toEqual([])
  expect(await painel.find({ type: 'Text', text: `No pins yet. Use ${PIN.solta} on a box to pin it.` })).toBeDefined()
  await painel.unmount()
  await msg.unmount()
})
