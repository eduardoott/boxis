// Regressões dos achados da revisão do 0.12.0: cada teste falha no código de antes da correção.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { cortar } from '../hooks/cortar'
import { separarTabelas } from '../hooks/tabela'
import { PADRAO, aplicar, lerConfig } from '../hooks/config'
import { abreCerca, cercaAbertaNoFim, fechaCerca } from '../hooks/cerca'
import { QUADRO_MS, QUADROS_CHECK } from '../hooks/titulo'
import { MAX_TEXTO, ORCAMENTO_PAINEL, ORCAMENTO_PINS, caberNoOrcamento, fechar, register, textoDoPin, tituloFalhou, type Pin } from '../hooks/register'

type Opcoes = { falhaSet?: (key: string) => boolean; semSessao?: boolean }
function world(on: On, start: Record<string, unknown> = {}, op: Opcoes = {}) {
  const disk: Record<string, unknown> = JSON.parse(JSON.stringify(start))
  const session = { id: 's1' }
  const opened: string[] = []
  const toasts: string[] = []
  on('store.get', (_, e) => ({ value: disk[e.key] }) as never)
  on('store.set', (_, e) => {
    if (op.falhaSet?.(e.key)) throw new Error('store full')
    disk[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined } as never
  })
  on('session.id', () => {
    if (op.semSessao) throw new Error('no session')
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
const pane = ($: any, requestId: string) =>
  $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'Pane', requestId, props: {} } as never)
const fimDoTurno = (answer: string) => ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' }) as never
const pin = (id: string, criado: number, texto?: string): Pin => ({ id, tipo: 'aviso', titulo: 'warning', trecho: 'x', criado, ...(texto === undefined ? {} : { texto }) })
const tamanho = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

// 1. Limites do motor.

test('pins: passou do orçamento, saem os mais velhos das outras sessões antes dos desta', () => {
  const grande = 'a'.repeat(1000)
  const todos = {
    velha: [pin('v0', 1, grande), pin('v1', 5, grande)],
    outra: [pin('o0', 2, grande)],
    atual: [pin('a0', 0, grande), pin('a1', 9, grande)],
  }
  const orcamento = tamanho(todos) - 1500
  const r = caberNoOrcamento(todos, 'atual', orcamento)
  expect(tamanho(r)).toBeLessThanOrEqual(orcamento)
  // Saíram v0 (1) e o0 (2), os mais velhos de fora; o a0 (0) desta sessão ficou, apesar de mais velho.
  expect(r).toEqual({ velha: [todos.velha[1]], atual: todos.atual })
  expect(caberNoOrcamento(todos, 'atual', tamanho(todos))).toBe(todos)
})

test('pins: fixar com o store cheio de outras sessões mantém a chave pins abaixo de 1,5 MiB', async ($, on) => {
  const grande = 'é'.repeat(MAX_TEXTO)
  const outras: Record<string, Pin[]> = {}
  for (let s = 0; s < 3; s++) outras[`s${s + 2}`] = Array.from({ length: 100 }, (_, i) => pin(`x${s}-${i}:0`, s * 1000 + i, grande))
  expect(tamanho(outras)).toBeGreaterThan(ORCAMENTO_PINS)
  const { disk, pins } = world(on, { pins: outras })
  const ui = await msg($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  expect(tamanho(disk.pins)).toBeLessThanOrEqual(ORCAMENTO_PINS)
  expect(pins().map(p => p.tipo)).toEqual(['aviso'])
  // Quem sobrou das outras é o mais novo.
  const s4 = (disk.pins as Record<string, Pin[]>).s4
  expect(s4.at(-1)!.id).toBe('x2-99:0')
  expect(s4.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('painel de pins: caixas cheias do mais novo para trás até o orçamento, as velhas em linha, na mesma ordem', async ($, on) => {
  const lista = Array.from({ length: 17 }, (_, i) => pin(`h${i}:0`, i, 'a'.repeat(MAX_TEXTO)))
  world(on, { pins: { s1: lista } })
  const p = await pane($, 'boxis-pins')
  const markdown = (await p.findAll({ type: 'Markdown' })).reduce((n: number, m: any) => n + String(m.props.text).length, 0)
  expect(markdown).toBeLessThanOrEqual(ORCAMENTO_PAINEL)
  const cheias = Math.floor(ORCAMENTO_PAINEL / MAX_TEXTO)
  expect((await p.findAll({ type: 'Box' })).filter((b: any) => b.props.borderColor).length).toBe(cheias)
  expect((await p.findAll({ type: 'Box' })).filter((b: any) => b.key?.startsWith('pin-')).map((b: any) => b.key))
    .toEqual(lista.map(x => `pin-${x.id}`))
  // As mais velhas viram linha: título e trecho, sem moldura.
  expect((await p.findAll({ type: 'Text', text: ' x' })).length).toBe(17 - cheias)
  await p.unmount()
})

test('textoDoPin: corte com … visível, fechando a cerca aberta (de 3 ou 4) dentro do teto', () => {
  for (const cerca of ['```', '````', '~~~']) {
    const t = textoDoPin(`Olha:\n${cerca}js\n${'x'.repeat(7000)}\n${cerca}`)
    expect(t.length).toBeLessThanOrEqual(MAX_TEXTO)
    expect(t.endsWith(`…\n${cerca}`)).toBe(true)
    expect(cercaAbertaNoFim(t)).toBeNull()
  }
  const solto = textoDoPin('y'.repeat(7000))
  expect(solto).toBe(`${'y'.repeat(MAX_TEXTO - 1)}…`)
  expect(textoDoPin('curto')).toBe('curto')
})

// 2. Gravação que falha vira toast.

test('gravação que falha: pin, check, all e painel de config avisam num toast', async ($, on) => {
  const { toasts } = world(on, {}, { falhaSet: () => true })
  await $.turn.complete(fimDoTurno('Body.\n\n⚠️ Careful.'))
  const ui = await msg($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  await ui.press({ key: 'lida-1' })
  await ui.press({ key: 'todas-1' })
  const cfg = await pane($, 'boxis-config')
  await cfg.press({ key: 'int-mais' })
  expect(toasts).toEqual(['Boxis: could not save the pins', 'Boxis: could not save the check marks', 'Boxis: could not save the check marks', 'Boxis: could not save the config'])
  // Nada mudou na tela: a cópia em memória só troca depois de gravar.
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeUndefined()
  expect(await cfg.find({ type: 'Text', text: /^ 50$/ })).toBeDefined()
  await cfg.unmount()
  await ui.unmount()
})

test('ferramenta design: falha ao ler o store vira { deny }, e não um "feito"', async ($, on) => {
  on('store.get', () => { throw new Error('disk gone') })
  const r = await $.tool.call({ tool: 'mcp__boxis__design', input: { intensidade: 30 } } as never)
  expect(JSON.stringify(r)).toMatch(/deny/)
})

// 3. CLI e app no mesmo store.

test('config: a mudança relê o store e não apaga o que o outro processo gravou', async ($, on) => {
  const { disk } = world(on)
  const ui = await pane($, 'boxis-config')
  disk.config = { ...((disk.config as object) ?? {}), intensidade: 80 }
  await ui.press({ key: 'check' })
  expect(disk.config).toMatchObject({ intensidade: 80, check: false })
  await ui.unmount()
})

test('pin: × num pin que o outro processo já soltou não fixa de novo', async ($, on) => {
  const { disk, pins } = world(on)
  const m = await msg($, 'Body.\n\n⚠️ Careful.')
  await m.press({ key: 'pin-1' })
  const id = pins()[0]!.id
  const p = await pane($, 'boxis-pins')
  disk.pins = { s1: [] }
  await p.press({ key: `soltar-${id}` })
  expect(pins()).toEqual([])
  await p.unmount()
  await m.unmount()
})

test('check: clique sobre a cópia velha aplica o estado mostrado, e não alterna o do disco', async ($, on) => {
  const { disk } = world(on)
  const m = await msg($, 'Body.\n\n⚠️ Careful.')
  await m.press({ key: 'lida-1' })
  expect((disk.lidas as string[]).length).toBe(1)
  // O outro processo desmarcou; esta tela ainda mostra ✓ e o clique quer desmarcar.
  disk.lidas = []
  await m.press({ key: 'lida-1' })
  expect(disk.lidas).toEqual([])
  await m.unmount()
})

test('client: "all" no meio dos quadros do check não é desfeito no fim deles', async ($, on) => {
  const { clock } = world(on, { config: { animacao: 'client' } })
  const ui = await msg($, 'Body.\n\n⚠️ Careful.\n\n❓ A or B?')
  const props = async () => (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('titulo-')).map((c: any) => c.props.props)
  await ui.resize({ columns: 40, rows: 1, in: 'titulo-1' })
  const chave = (await props())[1].chave
  await ui.press({ key: `check-${chave}`, in: 'titulo-1' })
  await ui.advance(QUADRO_MS)
  await ui.post({ todas: true }, { in: 'titulo-2' })
  expect((await props())[1].marcada).toBe(true)
  await ui.advance(QUADRO_MS * QUADROS_CHECK.length)
  await clock.advance(2000)
  expect((await props())[1].marcada).toBe(true)
  // E o check continua vivo: o clique seguinte desmarca.
  await ui.press({ key: `check-${chave}`, in: 'titulo-1' })
  expect((await props())[1].marcada).toBe(false)
  expect(((await ui.findAll({ type: 'Text', in: 'titulo-1' } as never)).at(-1) as any)?.text).toBe('○')
  await ui.unmount()
})

// 4. "all" em conversa longa.

test('all: com mais de 500 caixas e a resposta chegando aos pedaços, marca a conversa inteira', async ($, on) => {
  const { disk } = world(on)
  const answer = (i: number) => `Body ${i}.\n\n⚠️ Warn ${i}.\n\n❓ Q ${i}?\n\n✅ Done ${i}.`
  const N = 130
  for (let i = 0; i < N; i++) await (await msg($, answer(i), `m${i}`)).unmount()
  await $.turn.start({ text: 'oi', turnId: 't' } as never)
  const last = answer(N)
  for (let k = 10; k < last.length; k += 10) await (await msg($, last.slice(0, k), `m${N}`)).unmount()
  await $.turn.complete(fimDoTurno(last))
  const ui = await msg($, last, `m${N}`)
  await ui.press({ key: 'todas-3' })
  await ui.unmount()
  // Só as caixas das respostas inteiras: os pedaços do streaming não entram.
  expect((disk.lidas as string[]).length).toBe((N + 1) * 4)
  const first = await msg($, answer(0), 'm0')
  expect((await first.findAll({ type: 'Text', text: '✓' })).length).toBe(4)
  await first.unmount()
})

test('lidas: no teto de 2000 ficam as marcadas por último, mesmo as que o "all" remarca', async ($, on) => {
  const { disk } = world(on)
  const texto = 'Body.\n\n⚠️ Careful.'
  await $.turn.complete(fimDoTurno(texto))
  const ui = await msg($, texto)
  await ui.press({ key: 'lida-0' })
  const x = (disk.lidas as string[])[0]!
  const lixo = Array.from({ length: 1999 }, (_, i) => `velha${i}:0`)
  disk.lidas = [x, ...lixo]
  await ui.press({ key: 'todas-1' })
  const lidas = disk.lidas as string[]
  expect(lidas.length).toBe(2000)
  expect(lidas.slice(-2)).toEqual([x, x.replace(/:0$/, ':1')])
  expect(lidas.includes('velha0:0')).toBe(false)
  await ui.unmount()
})

// 5. Cercas de 4 ou mais.

test('cerca: fecha só com o mesmo caractere, corrida pelo menos igual e sem info string', () => {
  const quatro = abreCerca('````md')!
  expect(quatro).toEqual({ char: '`', n: 4 })
  expect(fechaCerca('```', quatro)).toBe(false)
  expect(fechaCerca('~~~~', quatro)).toBe(false)
  expect(fechaCerca('````js', quatro)).toBe(false)
  expect(fechaCerca('`````', quatro)).toBe(true)
  expect(fechaCerca('  ````  ', quatro)).toBe(true)
  expect(abreCerca('```a`b')).toBeNull()
})

test('cerca de 4: cortar, tabela e o tachado não tratam a cerca de dentro como fim do bloco', async ($, on) => {
  const t = 'Example:\n\n````md\n```\n❓ inside the inner code block\n| a | b |\n|---|---|\n```\n````\n\nend'
  expect(cortar(t).map(p => p.tipo)).toEqual(['corpo'])
  expect(separarTabelas(t).some(x => x.tipo === 'tabela')).toBe(false)
  expect(separarTabelas('~~~~\n~~~\n| a | b |\n|---|---|\n~~~~\n| c | d |\n|---|---|').map(x => x.tipo)).toEqual(['texto', 'tabela'])
  world(on)
  const ui = await msg($, 'Corpo:\n````md\n```\nlinha\n```\n````\nfim')
  await ui.press({ key: 'lida-0' })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('~~Corpo:~~\n````md\n```\nlinha\n```\n````\n~~fim~~')
  await ui.unmount()
})

// 6. Código morto.

test('animação: a svg guardada lê como nenhuma, e o botão do painel roda só as três', async ($, on) => {
  expect(lerConfig({ animacao: 'svg' }).animacao).toBe('nenhuma')
  expect('erro' in aplicar(PADRAO, { animacao: 'svg' })).toBe(true)
  world(on)
  const ui = await pane($, 'boxis-config')
  const rotulos = []
  for (let i = 0; i < 4; i++) {
    rotulos.push((await ui.find({ type: 'Button', key: 'animacao' }))?.text)
    await ui.press({ key: 'animacao' })
  }
  expect(rotulos).toEqual(['animation: none', 'animation: clock', 'animation: client', 'animation: none'])
  await ui.unmount()
})

test('↗ de pin sem resposta conhecida avisa que não alcança, sem tentar rolar', async ($, on) => {
  const { toasts } = world(on, { pins: { s1: [pin('nunca:0', 1, 'texto')] } })
  const p = await pane($, 'boxis-pins')
  await p.press({ key: 'ir-nunca:0' })
  expect(toasts).toEqual(['Could not jump to the box: its answer was not drawn in this session'])
  await p.unmount()
})

// 7. Os pequenos.

test('config: chave do protótipo não é nome de tipo', () => {
  for (const nome of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    expect('erro' in aplicar(PADRAO, { tipos: { [nome]: { cor: '#000000' } } })).toBe(true)
  }
})

test('tabela: o separador precisa das mesmas colunas do cabeçalho', () => {
  expect(separarTabelas('Run cat x | grep y\n---\nmore').some(x => x.tipo === 'tabela')).toBe(false)
  expect(separarTabelas('| a | b |\n|---|---|\n| 1 | 2 |').map(x => x.tipo)).toEqual(['tabela'])
  expect(separarTabelas('a | b\n--- | ---\n1 | 2').map(x => x.tipo)).toEqual(['tabela'])
})

test('pins sem id de sessão: nada lido nem gravado sob a chave vazia, e um toast', async ($, on) => {
  const { disk, toasts } = world(on, { pins: { '': [pin('vazia:0', 1, 'de ninguém')] } }, { semSessao: true })
  const ui = await msg($, 'Body.\n\n⚠️ Careful.')
  await ui.press({ key: 'pin-1' })
  expect(toasts).toEqual(['Boxis: could not save the pins: no session id'])
  expect(disk.pins).toEqual({ '': [pin('vazia:0', 1, 'de ninguém')] })
  const p = await pane($, 'boxis-pins')
  expect(await p.find({ type: 'Button', key: 'ir-vazia:0' })).toBeUndefined()
  await p.unmount()
  await ui.unmount()
})

test('fechar: se o clock.after falha, o tique do every é cancelado', () => {
  let cancelado = 0
  const invalidados: string[] = []
  const $ = {
    clock: { every: () => ({ cancel: () => { cancelado++ } }), after: () => { throw new Error('no clock') } },
    ui: { invalidate: (h: string) => { invalidados.push(h) } },
  }
  fechar($ as never, 'k:0')
  expect(cancelado).toBe(1)
  // Saiu do mapa: um segundo pedido começa de novo, e não é ignorado como "já fechando".
  fechar($ as never, 'k:0')
  expect(cancelado).toBe(2)
})

// O kit não tem como fazer o titulo.tsx falhar nem levantar ui.fault: o hook é chamado direto,
// e o desenho de volta à linha comum é o mesmo da superfície sem Client (caixa.test).
test('ui.fault no título do Client: a caixa daquela resposta passa a desenhar a linha de título comum', async () => {
  const hooks: Record<string, Function> = {}
  const on = ((nome: string, a: unknown, b?: unknown) => {
    hooks[nome] = (typeof a === 'function' ? a : b) as Function
    return { catch: () => undefined }
  }) as never
  register(on, {} as never)
  const proximo = (e: unknown) => ({ visto: e })
  const falha = { surface: 'desktop', component: 'AssistantMessage', requestId: 'mf', element: 'titulo-1', module: 'hooks/titulo.tsx', phase: 'render', reason: 'boom' }
  expect(tituloFalhou('mf', 'titulo-1')).toBe(false)
  expect(await hooks['ui.fault']({}, falha, proximo)).toEqual({ visto: falha })
  expect(tituloFalhou('mf', 'titulo-1')).toBe(true)
  expect(tituloFalhou('mf', 'titulo-0')).toBe(false)
  expect(tituloFalhou('outra', 'titulo-1')).toBe(false)
  // O brilho que falha não conta: só o título tem linha comum para onde voltar.
  await hooks['ui.fault']({}, { ...falha, element: 'aro-cima-1' }, proximo)
  expect(tituloFalhou('mf', 'aro-cima-1')).toBe(false)
})
