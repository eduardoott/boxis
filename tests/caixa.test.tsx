import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { TELA, lerConfig, misturar, visual } from '../hooks/config'
import { ACENDER, BATIDA_MS, CLAREAR, FECHAR_MS, PISCADAS, PISCA_MS, PULSOS } from '../hooks/register'
import { colunaDa, glifo } from '../hooks/brilho'
import { BATIDA_PONTO_MS, PULSOS as PULSOS_PONTO, QUADROS_CHECK, QUADROS_PONTO, QUADRO_MS } from '../hooks/titulo'

const RESPOSTA = { component: 'AssistantMessage', props: { text: 'oi', isFirstOfReply: true } } as const

test('a resposta sai dentro da caixa roxa, com o desenho de baixo por dentro', async ($, on) => {
  mock.store(on, {})
  // Quem vem depois na corrente (o Skins, numa sessão) desenha um texto marcado.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>desenho de baixo</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, ...RESPOSTA })
    const caixa = await ui.find({ type: 'Box' })
    expect(caixa?.props.borderColor).toBe('#7F77DD')
    expect(caixa?.props.borderStyle).toBe('round')
    expect(await ui.find({ type: "Text", text: /desenho de baixo/ })).toBeDefined()
    await ui.unmount()
  }
})

test('resposta com slots sai partida: decisão em azul de borda grossa, pergunta da lista apagada', async ($, on) => {
  mock.store(on, {})
  // O de baixo ecoa o texto que recebeu, para ver que cada caixa ganhou só o seu pedaço.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  // O de baixo só é pedido uma vez, para o pedaço com bloco de código; o resto sai aqui mesmo.
  const text = 'Corpo.\n\n```bash\necho oi\n```\n\n❓ Faço A?\n\n❓ Sobre você: café?\n\n✅ Feito: x. ➡️ Planejado: y.'
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  const caixas = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
  expect(caixas.map(b => b.props.borderColor)).toEqual(['#7F77DD', '#4A90E2', '#6B6B6B', '#5CB85C'])
  expect(caixas[1].props.borderStyle).toBe('bold')
  expect(caixas[1].props.backgroundColor).toMatch(/^#[0-9A-F]{6}$/)
  expect(caixas[2].props.backgroundColor).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^baixo:Corpo\.[\s\S]*echo oi/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props.text)).toEqual(['Faço A?', 'Feito: x. ➡️ Planejado: y.'])
  expect(await ui.find({ type: 'Text', text: /^your call$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^café\?$/ })).toBeDefined()
  await ui.unmount()
})

test('o check da caixa apaga só aquela caixa e fica lembrado ao redesenhar', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  const text = 'Corpo.\n- item **um**\n\n⚠️ Cuidado com X.\n\n✅ Feito: x. ➡️ Planejado: y.'
  const montar = () => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-1', props: { text, isFirstOfReply: true } } as never)
  const apagados = async (ui: Awaited<ReturnType<typeof montar>>) =>
    (await ui.findAll({ type: 'Markdown' })).filter(m => m.props.dimColor).map(m => m.props.text)

  const ui = await montar()
  const cor = (t: { props: Record<string, unknown> }) => t.props.color ?? (t.props.dimColor ? 'apagado' : '?')
  const checks = async () => [
    ...(await ui.findAll({ type: 'Text', text: '○' })).map(t => `○:${cor(t)}`),
    ...(await ui.findAll({ type: 'Text', text: '✓' })).map(t => `✓:${cor(t)}`),
  ]
  expect(await checks()).toEqual(['○:apagado', '○:apagado', '○:apagado'])
  expect(await apagados(ui)).toEqual([])
  await ui.press({ key: 'lida-1' })
  expect(await apagados(ui)).toEqual(['~~Cuidado com X.~~'])
  const bordas = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle).map(b => b.props.borderColor)
  expect(await bordas()).toEqual(['#7F77DD', '#5CB85C', '#5CB85C'])
  expect(await checks()).toEqual(['○:apagado', '○:apagado', '✓:#5CB85C'])
  await ui.press({ key: 'lida-0' })
  expect(await apagados(ui)).toEqual(['~~Corpo.~~\n- ~~item **um**~~', '~~Cuidado com X.~~'])
  await ui.unmount()

  const de_novo = await montar()
  expect(await apagados(de_novo)).toEqual(['~~Corpo.~~\n- ~~item **um**~~', '~~Cuidado com X.~~'])
  await de_novo.press({ key: 'lida-1' })
  expect(await apagados(de_novo)).toEqual(['~~Corpo.~~\n- ~~item **um**~~'])
  await de_novo.unmount()
})

test('a marcação vale pelo texto da resposta, não pelo id que a tela dá à mensagem', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  const text = 'Corpo.\n\n⚠️ Cuidado com X.'
  const montar = (requestId: string) => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
  const ao_vivo = await montar('msg_011Cg-t0')
  await ao_vivo.press({ key: 'lida-1' })
  await ao_vivo.unmount()
  const reaberta = await montar('b755fbd8-448d-4f48-a2ec-d494ec24c7c8')
  expect(await reaberta.find({ type: 'Text', text: '✓' })).toBeDefined()
  await reaberta.unmount()
})

test('/boxis check off tira o botão e ignora o que estava marcado', async ($, on) => {
  mock.store(on, { config: { check: false }, lidas: ['msg-2:0'] })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>desenho de baixo</Text>
  })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-2', props: { text: 'oi', isFirstOfReply: true } } as never)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /desenho de baixo/ })).toBeDefined()
  await ui.unmount()
})

test('/boxis off devolve o desenho de baixo sem caixa, e on traz de volta', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>desenho de baixo</Text>
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const caixas = async () => {
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'terminal', ...RESPOSTA })
    const n = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor).length
    await ui.unmount()
    return n
  }
  await $.command.run({ command: 'boxis', args: 'off' } as never)
  expect(await caixas()).toBe(0)
  await $.command.run({ command: 'boxis', args: 'on' } as never)
  expect(await caixas()).toBe(1)
})

test('painel: botões mudam intensidade, cor e liga/desliga', async ($, on) => {
  mock.store(on, {})
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, component: 'Pane', requestId: 'boxis-config', props: {} } as never)
    expect(await ui.find({ type: 'Text', text: /^ 50$/ })).toBeDefined()
    await ui.press({ key: 'int-mais' })
    expect(await ui.find({ type: 'Text', text: /^ 60$/ })).toBeDefined()
    await ui.press({ key: 'cor-mais-aviso' })
    expect(await ui.find({ type: 'Text', text: '#F08A3C' })).toBeDefined()
    await ui.press({ key: 'tudo-padrao' })
    expect(await ui.find({ type: 'Text', text: /^ 50$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('se o desenho de baixo falhar, a resposta inteira ainda sai numa caixa só', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async () => { throw new Error('skins caiu') })
  const text = 'Corpo.\n\n```bash\necho oi\n```\n\n❓ Sobre você: café?\n\n✅ Feito: x. ➡️ Planejado: y.\n\n📌 [fila.md](fila.md)'
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    const caixas = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
    expect(caixas.map(b => b.props.borderColor)).toEqual(['#7F77DD'])
    expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props.text)).toEqual([text])
    await ui.unmount()
  }
})

// Animação "relógio": só a resposta que acabou de chegar pulsa as caixas de aviso e decisão.
// O bloco de código no corpo faz o desenho de baixo ser pedido a cada redesenho: assim dá para contar.
const PULSANDO = 'Corpo.\n\n```bash\necho oi\n```\n\n⚠️ Cuidado com X.\n\n❓ Faço A?\n\n✅ Feito: x. ➡️ Planejado: y.'
const acesa = (cor: string) => misturar(cor, '#FFFFFF', CLAREAR)
const NORMAIS = ['#7F77DD', '#E0B040', '#4A90E2', '#5CB85C']
const ACESAS = ['#7F77DD', acesa('#E0B040'), acesa('#4A90E2'), '#5CB85C']
const fimDoTurno = (answer: string) => ({ answer, reason: 'answer' as const, durationMs: 10, isAborted: false, turnId: 't1' })

function mundoDoPulso(on: On, config: Record<string, unknown>) {
  mock.store(on, { config })
  const contagem = { desenhos: 0 }
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    contagem.desenhos += 1
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return { clock: mock.clock(on, { now: 1_800_000_000_000 }), contagem }
}
type Montada = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const bordasDe = async (ui: Montada) => (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle).map(b => b.props.borderColor)

test('relógio: a resposta que acabou de chegar pulsa aviso e decisão 3 vezes e para', async ($, on) => {
  const { clock, contagem } = mundoDoPulso(on, { animacao: 'relogio' })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSANDO, isFirstOfReply: true } })
  const bordas = () => bordasDe(ui)
  // Sem turn.complete é resposta reaberta: cores de sempre.
  expect(await bordas()).toEqual(NORMAIS)
  await clock.advance(10 * BATIDA_MS)
  expect(await bordas()).toEqual(NORMAIS)

  expect(await $.turn.complete(fimDoTurno(PULSANDO))).toEqual({ text: PULSANDO })
  expect(await bordas()).toEqual(ACESAS)
  // Acesa, a caixa inteira acende: fundo puxado para a cor do tipo e borda mais grossa.
  const caixaDe = async (cor: string) => (await ui.findAll({ type: 'Box' })).find(b => b.props.borderColor === cor)
  const aviso = visual(lerConfig({ animacao: 'relogio' }), 'aviso')
  const acesoAviso = await caixaDe(acesa('#E0B040'))
  expect(acesoAviso?.props.backgroundColor).toBe(misturar(aviso.fundo ?? TELA.escuro, aviso.cor, ACENDER))
  expect(acesoAviso?.props.borderStyle).toBe('bold')
  expect((await caixaDe(acesa('#4A90E2')))?.props.borderStyle).toBe('double')
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe(acesa('#E0B040'))
  expect((await ui.find({ type: 'Text', text: /^your call$/ }))?.props.color).toBe(acesa('#4A90E2'))
  expect((await ui.find({ type: 'Text', text: /^wrap-up$/ }))?.props.color).toBe('#5CB85C')
  // Quadro 1 apaga, 2 acende, ... 5 apaga: PULSOS acesos ao todo.
  for (let batida = 1; batida < 2 * PULSOS; batida++) {
    await clock.advance(BATIDA_MS)
    expect(await bordas()).toEqual(batida % 2 ? NORMAIS : ACESAS)
  }
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  expect((await caixaDe('#E0B040'))?.props.backgroundColor).toBe(aviso.fundo)
  expect((await caixaDe('#E0B040'))?.props.borderStyle).toBe('round')
  // Depois do último quadro a cadeia para: nem cor nova, nem redesenho.
  const antes = contagem.desenhos
  await clock.advance(BATIDA_MS)
  expect(await bordas()).toEqual(NORMAIS)
  await clock.advance(10 * BATIDA_MS)
  expect(await bordas()).toEqual(NORMAIS)
  expect(contagem.desenhos).toBe(antes)
  await ui.unmount()
})

test('relógio: caixa marcada como entendida fica verde e parada no meio do pulso', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'relogio' })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSANDO, isFirstOfReply: true } })
  await $.turn.complete(fimDoTurno(PULSANDO))
  expect(await bordasDe(ui)).toEqual(ACESAS)
  await ui.press({ key: 'lida-1' })
  expect(await bordasDe(ui)).toEqual(['#7F77DD', '#5CB85C', acesa('#4A90E2'), '#5CB85C'])
  await clock.advance(BATIDA_MS)
  expect(await bordasDe(ui)).toEqual(['#7F77DD', '#5CB85C', '#4A90E2', '#5CB85C'])
  await clock.advance(BATIDA_MS)
  expect(await bordasDe(ui)).toEqual(['#7F77DD', '#5CB85C', acesa('#4A90E2'), '#5CB85C'])
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#5CB85C')
  await ui.unmount()
})

for (const animacao of ['nenhuma', 'svg']) {
  test(`animação ${animacao}: o fim do turno só redesenha uma vez (o "marcar todas" muda de resposta), nada pulsa`, async ($, on) => {
    const { clock, contagem } = mundoDoPulso(on, { animacao })
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: PULSANDO, isFirstOfReply: true } })
    const antes = contagem.desenhos
    expect(await $.turn.complete(fimDoTurno(PULSANDO))).toEqual({ text: PULSANDO })
    expect(await bordasDe(ui)).toEqual(NORMAIS)
    for (let batida = 1; batida <= 2 * PULSOS; batida++) {
      await clock.advance(BATIDA_MS)
      expect(await bordasDe(ui)).toEqual(NORMAIS)
    }
    expect(contagem.desenhos).toBe(antes + 1)
    await ui.unmount()
  })
}

test('relógio: o bloco com quebra de linha no fim ainda bate com a resposta do turno', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'relogio' })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text: `${PULSANDO}\n\n`, isFirstOfReply: true } })
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  await $.turn.complete(fimDoTurno(PULSANDO))
  expect(await bordasDe(ui)).toEqual(ACESAS)
  await clock.advance(BATIDA_MS)
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  await ui.unmount()
})

test('relógio, reserva: bloco novo que só cabe na resposta do turno adota o pulso; o histórico não', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'relogio' })
  const montar = (text: string) => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  const BLOCO = '⚠️ Cuidado com X.\n\n❓ Faço A?'
  // Histórico desenhado ao abrir a sessão, fora de turno: cabe na resposta nova, mas não pulsa.
  const antiga = await montar('❓ Faço A?')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  // O bloco novo é desenhado dentro do turno; a resposta do turn.complete junta outro bloco antes dele.
  const nova = await montar(BLOCO)
  expect(await bordasDe(nova)).toEqual(['#E0B040', '#4A90E2'])
  await $.turn.complete(fimDoTurno(`Texto antes.\n${BLOCO}`))
  expect(await bordasDe(nova)).toEqual([acesa('#E0B040'), acesa('#4A90E2')])
  expect(await bordasDe(antiga)).toEqual(['#4A90E2'])
  await clock.advance(BATIDA_MS)
  expect(await bordasDe(nova)).toEqual(['#E0B040', '#4A90E2'])
  // Passada a janela de 1 s, um bloco que nunca apareceu não adota mais, mesmo com a cadeia acesa.
  await clock.advance(3 * BATIDA_MS)
  expect(await bordasDe(nova)).toEqual([acesa('#E0B040'), acesa('#4A90E2')])
  const tarde = await montar('⚠️ Cuidado com X.')
  expect(await bordasDe(tarde)).toEqual(['#E0B040'])
  for (const ui of [antiga, nova, tarde]) await ui.unmount()
})

// Animação "client": a linha do título vira um módulo de superfície (hooks/titulo.tsx).
// Caixas de PULSANDO: 0 corpo, 1 aviso, 2 decisão, 3 fechamento.
const montarClient = ($: { ui: { mount: (a: never) => Promise<any> } }, text = PULSANDO, surface = 'desktop') =>
  $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } } as never)
const clientes = async (ui: any) => (await ui.findAll({ type: 'Client' })).filter((c: any) => c.key.startsWith('titulo-')).map((c: any) => c.props.props)
const brilhos = async (ui: any) => (await ui.findAll({ type: 'Client' })).map((c: any) => c.key).filter((k: string) => k.startsWith('brilho-'))
const pulsares = async (ui: any) => (await clientes(ui)).map((p: any) => p.pulsar)
// O glifo do fim da linha é o último Text do módulo; o do ponto é um Text aninhado à esquerda.
const checkDe = async (ui: any, chave: string) => (await ui.findAll({ type: 'Text', in: chave })).at(-1)
const pontoDe = async (ui: any, chave: string) => (await ui.find({ type: 'Text', text: /^[◦◉●] $/, in: chave }))?.text
const COLUNAS = 40

test('client: uma Client por caixa, com ponto só em aviso e decisão, e sem Button', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  const achados = await ui.findAll({ type: 'Client' })
  // Parada, nenhuma caixa tem brilho montado.
  expect(achados.map((c: any) => c.key)).toEqual(['titulo-0', 'titulo-1', 'titulo-2', 'titulo-3'])
  expect(achados.every((c: any) => c.props.height === 1 && c.props.width === '100%')).toBe(true)
  const props = await clientes(ui)
  expect(props.map((p: any) => p.ponto)).toEqual([false, true, true, false])
  expect(props.map((p: any) => p.marcada)).toEqual([false, false, false, false])
  expect(props.map((p: any) => p.titulo)).toEqual(['', 'warning', 'your call', 'wrap-up'])
  expect(props.map((p: any) => p.cor)).toEqual(NORMAIS)
  expect(new Set(props.map((p: any) => p.chave)).size).toBe(4)
  expect(props.every((p: any) => /:\d$/.test(p.chave))).toBe(true)
  await ui.unmount()
})

test('client: parado, o módulo desenha o título e o ○ como hoje', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  await ui.resize({ columns: COLUNAS, rows: 1, in: 'titulo-1' })
  const titulo = await ui.find({ type: 'Text', text: /^warning$/, in: 'titulo-1' })
  expect(titulo?.props.color).toBe('#E0B040')
  expect(titulo?.props.bold).toBe(true)
  expect(await pontoDe(ui, 'titulo-1')).toBe('● ')
  // Corpo não tem ponto: o título não ganha coluna nenhuma.
  expect(await pontoDe(ui, 'titulo-0')).toBeUndefined()
  const check = await checkDe(ui, 'titulo-1')
  expect(check?.text).toBe('○')
  expect(check?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('client: só a resposta nova pulsa, só aviso e decisão, e a janela fecha sem redesenhar', async ($, on) => {
  const { clock, contagem } = mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  // Sem turn.complete é resposta reaberta.
  expect(await pulsares(ui)).toEqual([false, false, false, false])
  const antes = contagem.desenhos
  expect(await $.turn.complete(fimDoTurno(PULSANDO))).toEqual({ text: PULSANDO })
  expect(await pulsares(ui)).toEqual([false, true, true, false])
  // A caixa em si não muda: nem borda, nem cor, nem redesenho por batida.
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  const umaVez = contagem.desenhos
  expect(umaVez).toBe(antes + 1)
  await clock.advance(10_000)
  expect(contagem.desenhos).toBe(umaVez)
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  // Fechada a janela, um redesenho ou uma remontagem não pulsa de novo.
  await ui.redraw()
  expect(await pulsares(ui)).toEqual([false, false, false, false])
  await ui.unmount()
  const de_novo = await montarClient($)
  expect(await pulsares(de_novo)).toEqual([false, false, false, false])
  await de_novo.unmount()
})

test('client: o ponto toca os pulsos e para, mesmo que pulsar chegue depois de montar', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  await ui.resize({ columns: COLUNAS, rows: 1, in: 'titulo-1' })
  expect(await pontoDe(ui, 'titulo-1')).toBe('● ')
  await ui.advance(10 * BATIDA_PONTO_MS)
  expect(await pontoDe(ui, 'titulo-1')).toBe('● ')

  await $.turn.complete(fimDoTurno(PULSANDO))
  const vistos = [await pontoDe(ui, 'titulo-1')]
  for (let i = 1; i < PULSOS_PONTO * QUADROS_PONTO.length; i++) {
    await ui.advance(BATIDA_PONTO_MS)
    vistos.push(await pontoDe(ui, 'titulo-1'))
  }
  expect(vistos).toEqual(Array.from({ length: PULSOS_PONTO }, () => QUADROS_PONTO.map(g => `${g} `)).flat())
  // Acabou: fixo, ainda com a janela aberta, e redesenhar não recomeça.
  await ui.advance(BATIDA_PONTO_MS)
  expect((await clientes(ui))[1].pulsar).toBe(true)
  await ui.redraw()
  for (let i = 0; i < 3; i++) {
    await ui.advance(BATIDA_PONTO_MS)
    expect(await pontoDe(ui, 'titulo-1')).toBe('● ')
  }
  await clock.advance(10_000)
  await ui.unmount()
})

test('client: clique no ○ toca os quadros, marca uma vez e a caixa fica verde', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  await ui.resize({ columns: COLUNAS, rows: 1, in: 'titulo-1' })
  await ui.press({ key: `check-${(await clientes(ui))[1].chave}`, in: 'titulo-1' })
  const vistos = [(await checkDe(ui, 'titulo-1'))?.text]
  // Clique no meio dos quadros é ignorado: nem recomeça, nem posta de novo.
  await ui.advance(QUADRO_MS)
  vistos.push((await checkDe(ui, 'titulo-1'))?.text)
  await ui.press({ key: `check-${(await clientes(ui))[1].chave}`, in: 'titulo-1' })
  for (let i = 2; i < QUADROS_CHECK.length; i++) {
    expect((await checkDe(ui, 'titulo-1'))?.props.color).toBe('#5CB85C')
    await ui.advance(QUADRO_MS)
    vistos.push((await checkDe(ui, 'titulo-1'))?.text)
  }
  expect(vistos).toEqual(QUADROS_CHECK)
  expect((await checkDe(ui, 'titulo-1'))?.props.bold).toBe(true)
  await clock.advance(FECHAR_MS)
  expect(await bordasDe(ui)).toEqual(['#7F77DD', '#5CB85C', '#4A90E2', '#5CB85C'])
  expect((await clientes(ui))[1].marcada).toBe(true)
  // Um post só: mais tempo não desmarca.
  await ui.advance(10 * QUADRO_MS)
  expect((await clientes(ui))[1].marcada).toBe(true)
  await ui.unmount()
})

test('client: clique fora do check não faz nada', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  await ui.resize({ columns: COLUNAS, rows: 1, in: 'titulo-1' })
  await ui.pointer({ type: 'down', x: COLUNAS - 4, y: 0, button: 'left', in: 'titulo-1' })
  await ui.advance(10 * QUADRO_MS)
  expect((await checkDe(ui, 'titulo-1'))?.text).toBe('○')
  expect((await clientes(ui))[1].marcada).toBe(false)
  await ui.unmount()
})

test('client: fechar pisca a própria borda 6 vezes pelo hook, pulsa o fundo, monta o brilho e volta ao normal', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  const fundo = async () => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle)[1].props.backgroundColor
  const parado = await fundo()
  await ui.press({ key: `check-${(await clientes(ui))[1].chave}`, in: 'titulo-1' })
  expect(await brilhos(ui)).toEqual(['brilho-fecha-cima-1', 'brilho-fecha-baixo-1'])
  // Acesa é a cor da caixa clareada (marcada ou não); apagada é a cor de sempre.
  const acesa = async () => ![NORMAIS[1], '#5CB85C'].includes((await bordasDe(ui))[1])
  const fundos = new Set<string>()
  let piscadas = 0, antes = false
  for (let t = 0; t < FECHAR_MS; t += PISCA_MS) {
    const agora = await acesa()
    if (agora && !antes) piscadas++
    antes = agora
    fundos.add(await fundo())
    await clock.advance(PISCA_MS)
  }
  expect(piscadas).toBe(PISCADAS)
  // O fundo pulsa entre dois tons, nenhum deles o de parada.
  expect(fundos.size).toBe(2)
  expect(fundos.has(parado)).toBe(false)
  expect(await brilhos(ui)).toEqual([])
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  expect(await fundo()).toBe(parado)
  // Mais tempo não ressuscita a caixa.
  await clock.advance(10 * PISCA_MS)
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  await ui.unmount()
})

test('client: a resposta nova dá uma volta de brilho só em aviso e decisão', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  expect(await brilhos(ui)).toEqual([])
  await $.turn.complete(fimDoTurno(PULSANDO))
  expect(await brilhos(ui)).toEqual(['brilho-chega-cima-1', 'brilho-chega-baixo-1', 'brilho-chega-cima-2', 'brilho-chega-baixo-2'])
  await clock.advance(10_000)
  await ui.redraw()
  expect(await brilhos(ui)).toEqual([])
  await ui.unmount()
})

test('brilho: a volta passa por cima e volta por baixo, com os cantos certos', () => {
  const l = 6
  const volta = Array.from({ length: 2 * l }, (_, p) => [colunaDa(p, 'cima', l), colunaDa(p, 'baixo', l)])
  expect(volta.map(([c]) => c)).toEqual([0, 1, 2, 3, 4, 5, null, null, null, null, null, null])
  expect(volta.map(([, b]) => b)).toEqual([null, null, null, null, null, null, 5, 4, 3, 2, 1, 0])
  const linha = (lado: 'cima' | 'baixo') => Array.from({ length: l }, (_, x) => glifo('round', lado, x, l)).join('')
  expect([linha('cima'), linha('baixo')]).toEqual(['╭────╮', '╰────╯'])
})

test('client: clique na caixa marcada desmarca sem quadros, e o ✓ velho não volta', async ($, on) => {
  const { clock } = mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  await ui.resize({ columns: COLUNAS, rows: 1, in: 'titulo-1' })
  await ui.press({ key: `check-${(await clientes(ui))[1].chave}`, in: 'titulo-1' })
  await ui.advance(QUADRO_MS * QUADROS_CHECK.length)
  await clock.advance(FECHAR_MS)
  expect((await clientes(ui))[1].marcada).toBe(true)
  await ui.press({ key: `check-${(await clientes(ui))[1].chave}`, in: 'titulo-1' })
  expect((await clientes(ui))[1].marcada).toBe(false)
  expect((await checkDe(ui, 'titulo-1'))?.text).toBe('○')
  expect(await bordasDe(ui)).toEqual(NORMAIS)
  await ui.unmount()
})

test('client: ui.message com lida alterna a marca e ela persiste; dado torto não mexe em nada', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($)
  const chave = (await clientes(ui))[2].chave
  await ui.post({ lida: chave }, { in: 'titulo-2' })
  expect((await clientes(ui))[2].marcada).toBe(true)
  expect(await bordasDe(ui)).toEqual(['#7F77DD', '#E0B040', '#5CB85C', '#5CB85C'])
  await ui.unmount()
  const reaberta = await montarClient($)
  expect((await clientes(reaberta))[2].marcada).toBe(true)
  for (const data of [{ lida: 1 }, { outra: chave }, 'lida', null]) await reaberta.post(data, { in: 'titulo-2' })
  expect((await clientes(reaberta))[2].marcada).toBe(true)
  await reaberta.unmount()
})

test('client com check off: o título estático de hoje, sem Client', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client', check: false })
  const ui = await montarClient($)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe('#E0B040')
  await ui.unmount()
})

test('client em superfície sem Client: o Button de hoje', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($, PULSANDO, 'vscode')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).length).toBe(4)
  await ui.unmount()
})

test('client no terminal: o módulo monta e o check toca os quadros', async ($, on) => {
  mundoDoPulso(on, { animacao: 'client' })
  const ui = await montarClient($, PULSANDO, 'terminal')
  await ui.resize({ columns: COLUNAS, rows: 1, in: 'titulo-1' })
  await ui.press({ key: `check-${(await clientes(ui))[1].chave}`, in: 'titulo-1' })
  await ui.advance(QUADRO_MS)
  expect((await checkDe(ui, 'titulo-1'))?.text).toBe(QUADROS_CHECK[1])
  await ui.unmount()
})

test('"marcar todas" só aparece na última caixa da última resposta e marca a conversa inteira', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const antiga = 'Primeira.\n\n⚠️ Risco A.'
  const nova = 'Segunda.\n\n❓ Faço B?\n\n✅ Feito: x. ➡️ Planejado: y.'
  const montar = (requestId: string, text: string) => $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } } as never)
  const apagados = async (ui: Awaited<ReturnType<typeof montar>>) =>
    (await ui.findAll({ type: 'Markdown' })).filter(m => m.props.dimColor).map(m => m.props.text)

  // Resposta antiga desenhada, turno novo chega: só a nova é a última.
  const a = await montar('msg-a', antiga)
  expect(await a.find({ type: 'Button', text: 'all'})).toBeUndefined()
  await $.turn.start({ turnId: 't1' } as never)
  await $.turn.complete(fimDoTurno(nova))
  const b = await montar('msg-b', nova)
  expect(await a.find({ type: 'Button', text: 'all'})).toBeUndefined()
  expect((await b.findAll({ type: 'Button', text: 'all'})).map(x => x.key)).toEqual(['todas-2'])
  expect(await apagados(a)).toEqual([])
  expect(await apagados(b)).toEqual([])

  await b.press({ key: 'todas-2' })
  expect(await apagados(a)).toEqual(['~~Primeira.~~', '~~Risco A.~~'])
  expect(await apagados(b)).toEqual(['~~Segunda.~~', '~~Faço B?~~', '~~Feito: x. ➡️ Planejado: y.~~'])
  // O botão continua lá e o check de uma caixa ainda desmarca só ela.
  expect(await b.find({ type: 'Button', text: 'all'})).toBeDefined()
  await a.press({ key: 'lida-1' })
  expect(await apagados(a)).toEqual(['~~Primeira.~~'])
  await a.unmount()
  await b.unmount()
})
