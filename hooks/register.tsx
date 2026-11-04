import type { EngineInterface, Register, RenderSurface, UiScrollArgs } from 'claude-code'
import { cortar, type Tipo } from './cortar'
import { AJUDA, BASE, ROTULO_ANIMACAO, TELA, TIPOS, VERDE, aplicar, lerComando, lerConfig, misturar, nomeDoTipo, proximaAnimacao, proximaCor, resumo, visual, type Config, type Mudanca } from './config'
import { pesos, separarTabelas, temTabela } from './tabela'
import type { BrilhoProps } from './brilho'
import { PIN, type TituloProps } from './titulo'

const CERCA = /^\s*(```|~~~)/m

// Espaço das caixas, em células (fase 1 do plano-caixinhas.md).
const ESPACO_Y = 1
const ESPACO_X = 1

// O Skins desiste acima disto; o Caixinhas também: a resposta inteira vai numa caixa só.
const MAX_CORTE = 9000

// Animação "relógio" (exploração): os sliders do pulso das caixas quando a resposta chega.
// Cada batida acende e apaga a caixa inteira; depois de PULSOS acesas, a cadeia para.
// 0.8.0 só clareava a borda a 250 ms e quase não se via (anotação de tela de 28/10).
export const PULSOS = 3
export const BATIDA_MS = 400
// Quanto de branco entra na borda e no título da caixa acesa (0 nada, 1 branco).
export const CLAREAR = 0.35
// Quanto da cor do tipo entra no fundo da caixa acesa: é o que faz ela "acender".
export const ACENDER = 0.4
export const TIPOS_QUE_PULSAM: Tipo[] = ['aviso', 'decisao']
const BRANCO = '#FFFFFF'
// Quadros 0 a 2*PULSOS-1: par acende, ímpar apaga. Passou do último, a cadeia está terminada.
const QUADROS = 2 * PULSOS
const TERMINADA = -1
// Só as últimas respostas que pulsaram ficam no mapa, para ele não crescer sem fim.
const MAX_PULSOS = 50
// Reserva: até este tempo depois do fim do turno, um bloco que não bateu pela assinatura ainda adota o pulso.
const JANELA_MS = 1000
// Animação "client": até aqui o título ainda pode começar o pulso. Maior que a animação do ponto e
// que JANELA_MS; depois disso, redesenhar ou remontar nunca repete o pulso.
const JANELA_PULSO_MS = 3000
// Fechar a caixa: a própria borda pisca e o fundo pulsa junto, no redesenho do hook. É a única linha
// que cai em cima da borda fina do app; o ritmo é o que o redesenho aguenta (a 70 ms ele engolia metade).
export const PISCADAS = 6
export const PISCA_MS = 150
export const FECHAR_MS = 2 * PISCADAS * PISCA_MS
const FECHANDO_FUNDO = { aceso: 0.22, apagado: 0.1 }
const FECHANDO_BORDA = 0.35
export const BRILHO_CHEGADA_MS = 1400
// Quanto de branco cada célula da cauda do brilho leva, da cabeça para o fim.
const CAUDA = [0.85, 0.65, 0.45, 0.3, 0.15]
const MAX_VISTAS = 200

const CHAVE = 'config'
const CHAVE_LIDAS = 'lidas'
// Só as últimas marcadas ficam guardadas, para a lista não crescer sem fim.
const MAX_LIDAS = 500
// O Markdown não tem prop de tachado: cada linha ganha ~~ por dentro do marcador de lista ou título,
// senão a lista deixa de ser lista. Bloco de código e linha de tabela ficam como estão.
const MARCADOR = /^(\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)?(.*)$/
function tachar(texto: string): string {
  let naCerca = false
  return texto.split('\n').map(linha => {
    if (CERCA.test(linha)) { naCerca = !naCerca; return linha }
    if (naCerca || !linha.trim() || /^\s*\|/.test(linha)) return linha
    const [, marcador = '', resto] = linha.match(MARCADOR) ?? []
    return resto?.trim() ? `${marcador}~~${resto.trim()}~~` : linha
  }).join('\n')
}

const FERRAMENTA = 'mcp__boxis__design'
const PAINEL = 'boxis-config'

// Cópia da config guardada; lida no começo da sessão e trocada a cada mudança.
let config: Config | null = null
async function atual($: EngineInterface): Promise<Config> {
  if (!config) config = lerConfig(await $.store.get(CHAVE))
  return config
}
async function mudar($: EngineInterface, m: Mudanca): Promise<{ texto: string; erro?: boolean }> {
  const r = aplicar(await atual($), m)
  if ('erro' in r) return { texto: r.erro, erro: true }
  config = r.cfg
  await $.store.set(CHAVE, r.cfg)
  $.ui.invalidate('ui.render')
  return { texto: resumo(r.cfg) }
}

// Caixas marcadas como entendidas, por "assinatura do texto da resposta:posição da caixa".
// O id que a tela dá à mensagem não serve: ao vivo é o msg_ da API, reaberta é o uuid da linha.
let lidas: string[] | null = null
async function lerLidas($: EngineInterface, doDisco = false): Promise<string[]> {
  if (!lidas || doDisco) {
    const guardado = await $.store.get(CHAVE_LIDAS)
    lidas = Array.isArray(guardado) ? guardado.filter((x): x is string => typeof x === 'string') : []
  }
  return lidas
}
// FNV-1a de 32 bits mais o tamanho: curto para guardar e estável entre sessões.
function assinatura(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193)
  return `${(h >>> 0).toString(36)}.${texto.length.toString(36)}`
}

// "Marcar todas": toda resposta que a tela desenhou nesta sessão (o histórico ao abrir e as novas),
// por assinatura com a conta de caixas. Caixa que nunca foi desenhada não entra.
const desenhadas = new Map<string, number>()
const MAX_DESENHADAS = 1000
function verDesenhada(chave: string, caixas: number) {
  desenhadas.delete(chave)
  desenhadas.set(chave, caixas)
  for (const velha of desenhadas.keys()) {
    if (desenhadas.size <= MAX_DESENHADAS) break
    desenhadas.delete(velha)
  }
}
async function marcarTodas($: EngineInterface) {
  const todas = new Set(await lerLidas($, true))
  for (const [chave, n] of desenhadas) for (let i = 0; i < n; i++) todas.add(`${chave}:${i}`)
  lidas = [...todas].slice(-MAX_LIDAS)
  await $.store.set(CHAVE_LIDAS, lidas)
  $.ui.invalidate('ui.render')
}

// A última resposta da conversa, aparada: só ela ganha o botão "marcar todas". Ao abrir a sessão vem
// do transcript; depois, de cada fim de turno. O bloco que a tela desenha é o fim do texto dela.
let ultimaResposta = ''
function ehUltima(texto: string): boolean {
  const aparado = texto.trim()
  return !emTurno && aparado.length > 0 && ultimaResposta.endsWith(aparado)
}

// Pulso da resposta nova (animação "relógio"), por assinatura do texto aparado: o turn.complete
// entrega a resposta com trim() e a tela desenha o bloco sem as quebras de linha do começo.
// Só em memória: resposta reaberta de sessão antiga nunca está aqui, e por isso não pulsa.
type Cadeia = { quadro: number }
const pulsos = new Map<string, Cadeia>()
function guardarPulso(chave: string, cadeia: Cadeia) {
  pulsos.delete(chave)
  pulsos.set(chave, cadeia)
  for (const velha of pulsos.keys()) {
    if (pulsos.size <= MAX_PULSOS) break
    pulsos.delete(velha)
  }
}
const acesa = (quadro: number | undefined) => quadro !== undefined && quadro >= 0 && quadro < QUADROS && quadro % 2 === 0

// Uma batida por callback do relógio: o hook que começou a cadeia já voltou, nada espera por ela.
function bater($: EngineInterface, cadeia: Cadeia) {
  $.clock.after(BATIDA_MS, () => {
    try {
      cadeia.quadro += 1
      // O último quadro já é apagado, igual ao desenho parado: no fim não precisa redesenhar.
      if (cadeia.quadro >= QUADROS) { cadeia.quadro = TERMINADA; return }
      $.ui.invalidate('ui.render')
      bater($, cadeia)
    } catch {
      cadeia.quadro = TERMINADA
    }
  })
}

// Reserva para quando a assinatura não bate (o bloco que a tela desenha difere do texto do
// turn.complete, que junta os blocos da última mensagem): um bloco que a tela só desenhou dentro
// do turno e cabe inteiro na resposta adota a cadeia, até JANELA_MS depois do fim do turno.
let emTurno = false
let ultima: { texto: string; cadeia: Cadeia } | null = null
// Blocos já desenhados fora de turno (o histórico ao abrir a sessão): esses nunca adotam.
const vistasFora = new Set<string>()
function verFora(chave: string) {
  vistasFora.delete(chave)
  vistasFora.add(chave)
  for (const velha of vistasFora) {
    if (vistasFora.size <= MAX_VISTAS) break
    vistasFora.delete(velha)
  }
}
// Durante o turno só lê: o texto cresce a cada pedaço e nada entra no mapa nem pulsa antes do fim.
function pulsoDa(texto: string): Cadeia | undefined {
  const aparado = texto.trim()
  const chave = assinatura(aparado)
  const cadeia = pulsos.get(chave)
  if (cadeia || emTurno) return cadeia
  if (ultima && aparado && !vistasFora.has(chave) && ultima.texto.includes(aparado)) {
    guardarPulso(chave, ultima.cadeia)
    return ultima.cadeia
  }
  verFora(chave)
  return undefined
}

async function alternarLida($: EngineInterface, id: string) {
  // Relida do disco: o CLI e o app gravam no mesmo arquivo, e a cópia em memória pode estar velha.
  const atuais = await lerLidas($, true)
  lidas = atuais.includes(id) ? atuais.filter(x => x !== id) : [...atuais, id].slice(-MAX_LIDAS)
  await $.store.set(CHAVE_LIDAS, lidas)
  $.ui.invalidate('ui.render')
}

// Caixas fechando, pelo mesmo id da marcação, com a borda acesa ou não: um redesenho a cada PISCA_MS.
const fechando = new Map<string, boolean>()
function fechar($: EngineInterface, id: string) {
  if (fechando.has(id)) return
  fechando.set(id, true)
  $.ui.invalidate('ui.render')
  const tique = $.clock.every(PISCA_MS, () => {
    // O último tique pode cair junto com o fim: não ressuscitar a caixa.
    if (!fechando.has(id)) return
    fechando.set(id, !fechando.get(id))
    $.ui.invalidate('ui.render')
  })
  $.clock.after(FECHAR_MS, () => {
    tique.cancel()
    fechando.delete(id)
    $.ui.invalidate('ui.render')
  })
}

// Pins: caixas que a pessoa fixou para voltar a elas, por sessão. Guardadas como { [sessão]: Pin[] }.
const CHAVE_PINS = 'pins'
const PAINEL_PINS = 'boxis-pins'
const MAX_PINS = 100
const MAX_SESSOES_PINS = 50
const MAX_TRECHO = 60
// O markdown da caixa vai junto no pin para o painel redesenhá-la; o teto segura o tamanho do store.
export const MAX_TEXTO = 6000
// Pin antigo não tem texto: o painel cai na linha de título e trecho.
export type Pin = { id: string; tipo: Tipo; titulo: string; trecho: string; texto?: string; requestId?: string; criado: number }
type InfoCaixa = { tipo: Tipo; trecho: string; texto: string; requestId?: string }

// Primeira linha com texto da caixa, sem os marcadores do markdown, numa linha curta.
// O _ fica: some de nome de proc (usp_ww_x) se fosse tirado.
export function trechoDe(texto: string): string {
  const linha = texto.split('\n').map(l => l.trim()).find(l => l && !CERCA.test(l)) ?? ''
  const limpo = linha
    .replace(/^(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`|\*/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return limpo.length > MAX_TRECHO ? `${limpo.slice(0, MAX_TRECHO - 1).trimEnd()}…` : limpo
}

function lerTodosPins(v: unknown): Record<string, Pin[]> {
  const todos: Record<string, Pin[]> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return todos
  for (const [sessao, lista] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue
    const boas = lista.filter((p): p is Pin => !!p && typeof p === 'object' && typeof p.id === 'string' && TIPOS.includes(p.tipo)
      && typeof p.titulo === 'string' && typeof p.trecho === 'string' && typeof p.criado === 'number'
      && (p.texto === undefined || typeof p.texto === 'string'))
    if (boas.length) todos[sessao] = boas
  }
  return todos
}
async function sessaoAtual($: EngineInterface): Promise<string> {
  try { return String(await $.session.id()) } catch { return '' }
}
// Depois de um /clear o id muda sem session.start: a cópia em memória confere a sessão a cada leitura.
let pins: { sessao: string; lista: Pin[] } | null = null
async function lerPins($: EngineInterface): Promise<Pin[]> {
  const sessao = await sessaoAtual($)
  if (!pins || pins.sessao !== sessao) pins = { sessao, lista: lerTodosPins(await $.store.get(CHAVE_PINS))[sessao] ?? [] }
  return pins.lista
}
async function gravarPins($: EngineInterface, mudar: (lista: Pin[]) => Pin[]) {
  const sessao = await sessaoAtual($)
  // Relida do disco, como as lidas: o CLI e o app gravam no mesmo arquivo.
  const todos = lerTodosPins(await $.store.get(CHAVE_PINS))
  const lista = mudar(todos[sessao] ?? []).slice(-MAX_PINS)
  delete todos[sessao]
  if (lista.length) todos[sessao] = lista
  const sessoes = Object.keys(todos)
  for (const velha of sessoes.slice(0, Math.max(0, sessoes.length - MAX_SESSOES_PINS))) delete todos[velha]
  await $.store.set(CHAVE_PINS, todos)
  pins = { sessao, lista }
  $.ui.invalidate('ui.render')
}

// O que o pin precisa de cada caixa desenhada: o título do Client só posta o id dela.
const caixasVistas = new Map<string, InfoCaixa>()
// O requestId muda entre ao vivo e reaberta: o último que a tela usou para cada resposta é o que rola.
const pedidos = new Map<string, string>()
function lembrar<V>(mapa: Map<string, V>, chave: string, valor: V) {
  mapa.delete(chave)
  mapa.set(chave, valor)
  for (const velha of mapa.keys()) {
    if (mapa.size <= MAX_DESENHADAS * 2) break
    mapa.delete(velha)
  }
}

async function abrirPins($: EngineInterface, focus: boolean) {
  await $.ui.open({ id: PAINEL_PINS, title: 'Pins', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
}
async function alternarPin($: EngineInterface, id: string, info?: InfoCaixa) {
  let fixou = false
  const criado = await $.clock.now()
  await gravarPins($, lista => {
    if (lista.some(p => p.id === id)) return lista.filter(p => p.id !== id)
    const c = info ?? caixasVistas.get(id)
    if (!c) return lista
    fixou = true
    return [...lista, { id, tipo: c.tipo, titulo: BASE[c.tipo].titulo ?? 'answer', trecho: c.trecho, texto: c.texto.slice(0, MAX_TEXTO), ...(c.requestId ? { requestId: c.requestId } : {}), criado }]
  })
  if (fixou) await abrirPins($, false)
}
const alvoDa = (id: string) => `alvo-${id}`
// Para onde o clique no pin rola: a marca da caixa e, de reserva, a resposta pelo último requestId visto.
export function destinoDo(p: Pin): { key: string; requestId?: string } {
  const requestId = pedidos.get(p.id.slice(0, p.id.lastIndexOf(':'))) ?? p.requestId
  return requestId ? { key: alvoDa(p.id), requestId } : { key: alvoDa(p.id) }
}
// O motor pode recusar ({ deny }) ou rejeitar (sem superfície que role): os dois viram o motivo.
async function rolar($: EngineInterface, args: UiScrollArgs): Promise<string | undefined> {
  try { return (await $.ui.scroll(args)).deny } catch (erro) { return erro instanceof Error ? erro.message : String(erro) }
}
async function irPara($: EngineInterface, p: Pin) {
  const { key, requestId } = destinoDo(p)
  // Uma chamada só por clique: a segunda, depois do await, já não conta como gesto da pessoa
  // ("not person-initiated"). A marca da caixa não é alvo no transcript; a resposta pelo requestId é.
  const deny = await rolar($, requestId ? { to: { requestId }, block: 'start' } : { to: { key }, block: 'center' })
  if (deny) $.ui.toast(`Could not jump to the box: ${deny}`)
}

// O que o desenho do conteúdo precisa, no chat e no painel de pins.
// Os elementos vêm do $.ui.resolve de cada hook, e a tabela de cada superfície tem tipo próprio.
// O $ vai à parte: o motor recusa o $ guardado dentro de um objeto.
type Pintura = {
  cfg: Config; surface: RenderSurface; colunas: number
  Box: any; Text: any; Markdown: any
}
const colunasDe = (viewport?: { columns?: number }) => Math.max(20, (viewport?.columns ?? 100) - 2 * ESPACO_X - 2)

async function solto($: EngineInterface, p: Pintura, texto: string) {
  const { Markdown } = p
  let feito
  // Sem o Skins o $.skins não existe e a chamada joga; o motor recusa $.skins?. então o catch é o caminho normal.
  try { feito = await $.skins.markdown({ surface: p.surface, text: texto, columns: p.colunas }) } catch {}
  return feito ?? <Markdown text={texto} />
}

// Tabela desenhada aqui, e não pelo Skins: a célula longa quebra linha em vez de virar "…".
function tabela(p: Pintura, t: { cabecalho: string[]; linhas: string[][] }, tipo: Tipo, key: string) {
  const { Box, Text, Markdown, cfg } = p
  const c = visual(cfg, tipo)
  const zebra = misturar(c.fundo ?? (cfg.claro ? TELA.claro : TELA.escuro), c.cor, 0.14)
  const w = pesos(t.cabecalho, t.linhas)
  const celula = (texto: string, k: number, cab: boolean) => (
    <Box key={`c-${k}`} width={0} flexGrow={w[k]} flexShrink={1} paddingX={1}>
      {cab ? <Text color={c.cor} bold wrap="wrap">{texto.replace(/\*\*/g, '')}</Text> : <Markdown text={texto || ' '} />}
    </Box>
  )
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={c.cor} width="100%">
      <Box key="cab" flexDirection="row" backgroundColor={zebra}>{t.cabecalho.map((x, k) => celula(x, k, true))}</Box>
      {t.linhas.map((l, i) => (
        <Box key={`l-${i}`} flexDirection="row" backgroundColor={i % 2 ? zebra : undefined}>{l.map((x, k) => celula(x, k, false))}</Box>
      ))}
    </Box>
  )
}

// trecho desenha o texto fora das tabelas: no chat ele ainda pode pedir o desenho de baixo.
async function desenhar($: EngineInterface, p: Pintura, texto: string, tipo: Tipo, trecho: (texto: string) => Promise<unknown> = t => solto($, p, t)) {
  const { Box } = p
  const trechos = separarTabelas(texto)
  if (!trechos.some(t => t.tipo === 'tabela')) return trecho(texto)
  const partes = []
  for (const [k, t] of trechos.entries()) {
    partes.push(t.tipo === 'tabela' ? tabela(p, t, tipo, `tab-${k}`) : <Box key={`txt-${k}`} flexDirection="column">{await trecho(t.texto)}</Box>)
  }
  return <Box flexDirection="column" rowGap={1}>{partes}</Box>
}

const TIPOS_DESC = TIPOS.map(nomeDoTipo).join(', ')

// Rótulo do botão de animação no painel.
const ROTULO = ROTULO_ANIMACAO

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'boxis', description: 'Boxis: opens the colour panel, or on/off, intensity, animation and colour per type', argumentHint: '[status | pins | on | off | check on|off | animation none|clock|client|svg | screen light|dark | intensity N | color <type> #hex | background <type> #hex | default]' })
    await $.tool.register({
      name: 'design',
      description: `Changes the look of the Boxis mod (the coloured boxes around the answers): on/off (ligado), the ✓ button that marks a box as understood (check), the animation of the boxes on arrival (animacao: none (nenhuma), clock (relogio), client, svg), background intensity (intensidade, 0 to 100) and, per type, the border and title colour (cor) and the background colour (fundo). Types: ${TIPOS_DESC}. A colour is #RRGGBB; "default" restores the original; background "none" removes the background. Returns the full config after the change. Call with no fields to only read it.`,
      inputSchema: {
        type: 'object',
        properties: {
          ligado: { type: 'boolean', description: 'Boxes on (true) or off (false).' },
          check: { type: 'boolean', description: 'Shows the ✓ button that marks a box as understood.' },
          animacao: { type: 'string', enum: ['nenhuma', 'relogio', 'client', 'svg'], description: 'Animation of the warning and decision boxes when the answer arrives: none (nenhuma), clock (relogio), client, svg.' },
          intensidade: { type: 'number', minimum: 0, maximum: 100, description: 'Background intensity, 0 (no background) to 100 (strong background).' },
          tipos: {
            type: 'object',
            description: `Key is the type (${TIPOS_DESC}). cor is the border and title colour, fundo the background colour.`,
            additionalProperties: {
              type: 'object',
              properties: { cor: { type: 'string' }, fundo: { type: 'string' } },
              additionalProperties: false,
            },
          },
          claro: { type: 'boolean', description: 'true when the screen is light: backgrounds get lighter instead of darker.' },
          restaurar: { type: 'boolean', description: 'Restores every colour and the intensity to the original.' },
        },
        additionalProperties: false,
      },
    })
    await atual($)
    try {
      const mensagens = await $.session.messages()
      if (Array.isArray(mensagens)) {
        const u = [...mensagens].reverse().find(m => m.role === 'assistant' && m.text.trim())
        ultimaResposta = u?.text.trim() ?? ''
      }
    } catch {}
    return r
  })

  on('command.run', { command: 'boxis' }, async ($, e) => {
    const pedido = lerComando(e.args)
    if (pedido === 'painel') {
      await $.ui.open({ id: PAINEL, title: 'Boxis', focus: true, closeOnEscape: true })
      return {}
    }
    if (pedido === 'pins') {
      await abrirPins($, true)
      return {}
    }
    if (pedido === 'mostrar') return { text: `${resumo(await atual($))}\n\n${AJUDA}` }
    if ('erro' in pedido) return { text: pedido.erro }
    return { text: (await mudar($, pedido)).texto }
  })

  on('tool.call', { tool: FERRAMENTA }, async ($, e) => {
    const r = await mudar($, (e.input ?? {}) as Mudanca)
    return r.erro ? { deny: r.texto } : { result: r.texto }
  })

  // O turno do loop principal: o que a tela desenha dentro dele é a resposta chegando.
  on('turn.start', ($, e, next) => {
    if (!e.agentId) emTurno = true
    return next(e)
  })

  // Resposta nova: na animação "relógio", as caixas de aviso e decisão dela pulsam e param.
  // Na "client" quem pulsa é o título: aqui só abre a janela, com um redesenho e sem batidas.
  // O mod só observa: devolve sempre o next(e), e cada batida é um callback do relógio.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    emTurno = false
    try {
      const texto = e.reason === 'answer' && typeof e.answer === 'string' ? e.answer.trim() : ''
      if (texto) {
        ultimaResposta = texto
        $.ui.invalidate('ui.render')
      }
      const animacao = (await atual($)).animacao
      if (texto && (animacao === 'relogio' || animacao === 'client')) {
        const cadeia: Cadeia = { quadro: 0 }
        guardarPulso(assinatura(texto), cadeia)
        ultima = { texto, cadeia }
        $.clock.after(JANELA_MS, () => { if (ultima?.cadeia === cadeia) ultima = null })
        $.ui.invalidate('ui.render')
        if (animacao === 'relogio') bater($, cadeia)
        else $.clock.after(JANELA_PULSO_MS, () => { cadeia.quadro = TERMINADA })
      }
    } catch {}
    return next(e)
  })

  // O check do título (animação "client") posta "fechar" no clique e "lida" ao fim dos quadros.
  on('ui.message', async ($, e, next) => {
    const dados = e.data as { lida?: unknown; fechar?: unknown; todas?: unknown; pin?: unknown } | null
    if (!e.element.startsWith('titulo-') || !dados || typeof dados !== 'object') return next(e)
    if (dados.todas === true) { await marcarTodas($); return {} }
    if (typeof dados.pin === 'string') {
      const c = caixasVistas.get(dados.pin)
      await alternarPin($, dados.pin, c && { ...c, requestId: e.requestId })
      return {}
    }
    if (typeof dados.fechar === 'string') { fechar($, dados.fechar); return {} }
    if (typeof dados.lida !== 'string') return next(e)
    await alternarLida($, dados.lida)
    return {}
  })

  // O painel de config: uma linha por tipo, com a amostra e os botões de cor e fundo.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cfg = await atual($)
    const ir = (m: Mudanca) => () => void mudar($, m)
    const linha = (t: Tipo) => {
      const v = visual(cfg, t)
      const nome = nomeDoTipo(t)
      const aj = cfg.tipos[t] ?? {}
      // A chave dos elementos é o id interno do tipo; o nome em inglês só aparece na tela.
      return (
        <Box key={`linha-${t}`} flexDirection="row" gap={1}>
          <Text>{nome.padEnd(11)}</Text>
          <Text color={v.cor} backgroundColor={v.fundo} bold>{` ${BASE[t].titulo ?? 'answer'} `.padEnd(16)}</Text>
          <Button key={`cor-menos-${t}`} label="◀" onPress={ir({ tipos: { [t]: { cor: proximaCor(v.cor, -1) } } })} />
          <Text color={v.cor}>{v.cor}</Text>
          <Button key={`cor-mais-${t}`} label="▶" onPress={ir({ tipos: { [t]: { cor: proximaCor(v.cor, 1) } } })} />
          <Button key={`fundo-${t}`} label={aj.fundo === 'nenhum' ? 'no background' : 'with background'}
            onPress={ir({ tipos: { [t]: { fundo: aj.fundo === 'nenhum' ? 'default' : 'none' } } })} />
          {aj.cor || aj.fundo ? <Button key={`padrao-${t}`} label="default" onPress={ir({ tipos: { [t]: { cor: 'default', fundo: 'default' } } })} /> : null}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={e.surface === 'terminal' ? 0 : 1}>
        <Box flexDirection="row" gap={1}>
          <Button key="ligado" label={cfg.ligado ? 'on' : 'off'} variant="primary" onPress={ir({ ligado: !cfg.ligado })} />
          <Text dimColor>background intensity</Text>
          <Button key="int-menos" label="−" onPress={ir({ intensidade: Math.max(0, cfg.intensidade - 10) })} />
          <Text>{String(cfg.intensidade).padStart(3)}</Text>
          <Button key="int-mais" label="+" onPress={ir({ intensidade: Math.min(100, cfg.intensidade + 10) })} />
          <Button key="tela" label={cfg.claro ? 'light screen' : 'dark screen'} onPress={ir({ claro: !cfg.claro })} />
          <Button key="check" label={cfg.check ? 'check on' : 'check off'} onPress={ir({ check: !cfg.check })} />
          <Button key="animacao" label={`animation: ${ROTULO[cfg.animacao]}`} onPress={ir({ animacao: proximaAnimacao(cfg.animacao) })} />
        </Box>
        {TIPOS.map(linha)}
        <Box flexDirection="row" gap={1}>
          <Button key="tudo-padrao" label="reset all to default" onPress={ir({ restaurar: true })} />
          <Text dimColor>Esc closes · changes here apply to every session</Text>
        </Box>
      </Box>
    )
  })

  // Os pins da sessão, o mais novo por último, cada um redesenhado como a caixa do chat.
  // Sem animação aqui: pulso, brilho e o check só existem na conversa.
  on('ui.render', { component: 'Pane', requestId: PAINEL_PINS }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const cfg = await atual($)
    const lista = await lerPins($)
    const marcadas = await lerLidas($)
    const pintura: Pintura = { cfg, surface: e.surface, colunas: colunasDe(e.viewport), Box, Text, Markdown }
    const ir = (p: Pin) => (
      <Button key={`ir-${p.id}`} label="↗" onPress={() => void irPara($, p)}>
        <Text dimColor>↗</Text>
      </Button>
    )
    const soltar = (p: Pin) => (
      <Button key={`soltar-${p.id}`} label="×" onPress={() => void alternarPin($, p.id)}>
        <Text dimColor>×</Text>
      </Button>
    )
    // Pin de antes do texto guardado: a linha de título e trecho, com o mesmo par de botões.
    const linha = (p: Pin) => (
      <Box key={`pin-${p.id}`} flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate">
            <Text color={visual(cfg, p.tipo).cor} bold>{p.titulo}</Text>
            {` ${p.trecho}`}
          </Text>
        </Box>
        {ir(p)}
        {soltar(p)}
      </Box>
    )
    const caixa = async (p: Pin & { texto: string }) => {
      const v = visual(cfg, p.tipo)
      const marcada = cfg.check && marcadas.includes(p.id)
      const c = marcada ? { ...v, cor: VERDE, fundo: misturar(cfg.claro ? TELA.claro : TELA.escuro, VERDE, 0.2) } : v
      const leve = p.tipo === 'sobreVoce'
      const apagada = marcada || leve
      const dentro = leve ? <Text dimColor>{p.texto}</Text>
        : marcada ? <Markdown text={tachar(p.texto)} dimColor />
        : await desenhar($, pintura, p.texto, p.tipo)
      return (
        <Box key={`pin-${p.id}`} flexDirection="column" borderStyle={c.borda} borderColor={c.cor} backgroundColor={c.fundo}
          paddingX={ESPACO_X} paddingY={leve ? 0 : ESPACO_Y}>
          <Box key={`topo-${p.id}`} flexDirection="row" justifyContent="space-between">
            <Text color={c.cor} bold={!apagada} dimColor={apagada}>{c.titulo ?? ''}</Text>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              {ir(p)}
              {soltar(p)}
            </Box>
          </Box>
          {dentro}
        </Box>
      )
    }
    const desenhos = []
    for (const p of lista) desenhos.push(typeof p.texto === 'string' ? await caixa(p as Pin & { texto: string }) : linha(p))
    return (
      <Box flexDirection="column" rowGap={e.surface === 'terminal' ? 0 : 1}>
        {lista.length === 0 ? <Text dimColor>{`No pins yet. Use ${PIN.solta} on a box to pin it.`}</Text> : desenhos}
        <Text dimColor>↗ jumps to the box in the chat · × unpins · Esc closes</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const cfg = await atual($)
    if (!cfg.ligado) return next(e)

    const elementos = $.ui.resolve(e)
    const { Box, Text, Markdown, Button } = elementos
    // vscode e mobile não têm Client: lá o título segue o desenho de hoje.
    const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in elementos ? elementos.Client : undefined
    const marcadas = await lerLidas($)
    // O resumo entre duas ferramentas não é a resposta: nunca pulsa.
    const pulso = e.props.isSummary ? undefined : pulsoDa(e.props.text)
    const quadro = cfg.animacao === 'relogio' ? pulso?.quadro : undefined
    const id = assinatura(e.props.text)
    const idDa = (i: number) => `${id}:${i}`
    const lida = (i: number) => cfg.check && marcadas.includes(idDa(i))
    const pedacos = e.props.text.length > MAX_CORTE ? null : cortar(e.props.text)
    const caixasDesta = pedacos === null || pedacos.length <= 1 && (pedacos[0]?.tipo ?? 'corpo') === 'corpo' ? 1 : pedacos.length
    verDesenhada(id, caixasDesta)
    lembrar(pedidos, id, e.requestId)
    const fixadas = new Set((await lerPins($)).map(p => p.id))
    // O botão "marcar todas" fica na última caixa da última resposta, ao lado do check dela.
    const ultima = cfg.check && !e.props.isSummary && ehUltima(e.props.text)
    const todas = (i: number) => ultima && i === caixasDesta - 1
    const colunas = colunasDe(e.viewport)

    const caixa = (tipo: Tipo, dentro: unknown, i: number, texto: string) => {
      const v = visual(cfg, tipo)
      const info: InfoCaixa = { tipo, trecho: trechoDe(texto), texto, requestId: e.requestId }
      lembrar(caixasVistas, idDa(i), info)
      const fixada = fixadas.has(idDa(i))
      const pin = (
        <Button key={`pin-${i}`} label={fixada ? PIN.fixada : PIN.solta} onPress={() => void alternarPin($, idDa(i), info)}>
          {fixada ? <Text>{PIN.fixada}</Text> : <Text dimColor>{PIN.solta}</Text>}
        </Button>
      )
      const marcada = lida(i)
      const pulsa = !marcada && acesa(quadro) && TIPOS_QUE_PULSAM.includes(tipo)
      const base = marcada ? { ...v, cor: VERDE, fundo: misturar(cfg.claro ? TELA.claro : TELA.escuro, VERDE, 0.2) }
        : pulsa ? {
          ...v,
          cor: misturar(v.cor, BRANCO, CLAREAR),
          fundo: misturar(v.fundo ?? (cfg.claro ? TELA.claro : TELA.escuro), v.cor, ACENDER),
          // A borda engrossa sem mudar de tamanho; a que já é grossa vira dupla.
          borda: v.borda === 'bold' ? 'double' : 'bold',
        } : v
      const noCliente = cfg.check && cfg.animacao === 'client' && Client
      const fecha = noCliente && fechando.has(idDa(i))
      const aceso = fecha && fechando.get(idDa(i)) === true
      const c = fecha ? {
        ...base,
        fundo: misturar(base.fundo ?? (cfg.claro ? TELA.claro : TELA.escuro), base.cor, aceso ? FECHANDO_FUNDO.aceso : FECHANDO_FUNDO.apagado),
      } : base
      const bordaCor = aceso ? misturar(base.cor, BRANCO, FECHANDO_BORDA) : c.cor
      const pulsar = TIPOS_QUE_PULSAM.includes(tipo) && !marcada && pulso?.quadro === 0
      const volta = fecha ? 'fecha' : pulsar ? 'chega' : null
      // No terminal a borda é de células e o brilho corre em cima dela. No app a borda é fina, entre
      // duas células: o brilho corre na linha de dentro, colado na borda (a de fora, em cima, nem aparece).
      const fino = e.surface !== 'terminal'
      const fora = fino ? 0 : -1
      const leve = tipo === 'sobreVoce'
      // Sem linha de respiro, o brilho de dentro passaria por cima do texto.
      const brilha = volta && !(fino && leve)
      const apagada = marcada || leve
      const titulo = <Text color={c.cor} bold={!apagada} dimColor={apagada}>{c.titulo ?? ''}</Text>
      return (
        <Box key={`caixa-${i}`} flexDirection="column" borderStyle={c.borda} borderColor={bordaCor} backgroundColor={c.fundo}
          paddingX={ESPACO_X} paddingY={leve ? 0 : ESPACO_Y}>
          {/* Marca vazia para o painel de pins rolar até esta caixa, e não só até o topo da resposta. */}
          <Box key={alvoDa(idDa(i))} height={0} />
          {noCliente ? (
            <Client key={`titulo-${i}`} module="./titulo.tsx" width="100%" height={1} props={{
              titulo: c.titulo ?? '',
              cor: c.cor,
              apagada,
              marcada,
              corCheck: VERDE,
              // Mesmo parada ou reaberta a caixa guarda o lugar do ponto: o título não anda.
              ponto: TIPOS_QUE_PULSAM.includes(tipo),
              pulsar,
              chave: idDa(i),
              todas: todas(i),
              fixada,
            } satisfies TituloProps} />
          ) : (
            <Box key={`topo-${i}`} flexDirection="row" justifyContent="space-between">
              {titulo}
              <Box flexDirection="row" gap={1} flexShrink={0}>
                {pin}
                {todas(i) ? (
                  <Button key={`todas-${i}`} label="all" onPress={() => void marcarTodas($)}>
                    <Text dimColor>all</Text>
                  </Button>
                ) : null}
                {cfg.check ? (
                  <Button key={`lida-${i}`} label={marcada ? '✓' : '○'} onPress={() => void alternarLida($, idDa(i))}>
                    <Text color={marcada ? VERDE : undefined} bold={marcada} dimColor={!marcada}>{marcada ? '✓' : '○'}</Text>
                  </Button>
                ) : null}
              </Box>
            </Box>
          )}
          {dentro}
          {/* Por último: pinta por cima da borda e do conteúdo. */}
          {noCliente && brilha ? (['cima', 'baixo'] as const).map(lado => (
            <Box key={`aro-${lado}-${i}`} position="absolute" left={fora} right={fora} height={1} {...(lado === 'cima' ? { top: fora } : { bottom: fora })}>
              <Client key={`brilho-${volta}-${lado}-${i}`} module="./brilho.tsx" width="100%" height={1} props={{
                lado,
                fino,
                cores: CAUDA.map(k => misturar(volta === 'fecha' ? VERDE : v.cor, BRANCO, k)),
                borda: c.borda,
                duracaoMs: volta === 'fecha' ? FECHAR_MS : BRILHO_CHEGADA_MS,
              } satisfies BrilhoProps} />
            </Box>
          )) : null}
        </Box>
      )
    }

    const pintura: Pintura = { cfg, surface: e.surface, colunas, Box, Text, Markdown }

    // O desenho de baixo só pode ser pedido uma vez por resposta: vai para o primeiro trecho
    // com bloco de código, que assim mantém os botões Run e copiar. O resto é desenhado aqui,
    // no tema do Skins quando ele está ligado.
    let baixoLivre = true
    const trecho = async (texto: string) => {
      if (!baixoLivre || !CERCA.test(texto)) return solto($, pintura, texto)
      baixoLivre = false
      return (await next({ ...e, props: { ...e.props, text: texto } })) ?? solto($, pintura, texto)
    }
    const desenharAqui = (texto: string, tipo: Tipo) => desenhar($, pintura, texto, tipo, trecho)

    // Sem slot nenhum (ou grande demais): uma caixa do corpo só, como na fase 1.
    // Caixa marcada como entendida: o texto sai apagado e tachado, com a formatação inteira.
    if (pedacos === null || pedacos.length <= 1 && (pedacos[0]?.tipo ?? 'corpo') === 'corpo') {
      if (lida(0)) return caixa('corpo', <Markdown text={tachar(e.props.text)} dimColor />, 0, e.props.text)
      if (pedacos && temTabela(e.props.text)) return caixa('corpo', await desenharAqui(e.props.text, 'corpo'), 0, e.props.text)
      const dentro = await next(e)
      if (dentro === undefined || dentro === null) return dentro
      return caixa('corpo', dentro, 0, e.props.text)
    }

    const caixas = []
    for (const [i, p] of pedacos.entries()) {
      const dentro = p.tipo === 'sobreVoce' ? <Text dimColor>{p.texto}</Text>
        : lida(i) ? <Markdown text={tachar(p.texto)} dimColor />
        : await desenharAqui(p.texto, p.tipo)
      caixas.push(caixa(p.tipo, dentro, i, p.texto))
    }
    return <Box flexDirection="column" rowGap={e.surface === 'terminal' ? 0 : 1}>{caixas}</Box>
  })
    // Se o desenho acima falhar (erro, estouro de tempo), a resposta ainda sai numa caixa só,
    // com o markdown cru por dentro. Numa reentrada o `$` não responde: passa adiante.
    .catch(async ($, e, next) => {
      if (next.error.kind === 're-entry') return next(e)
      try {
        const cfg = await atual($)
        const { Box, Markdown } = $.ui.resolve(e)
        const c = visual(cfg, 'corpo')
        return (
          <Box flexDirection="column" borderStyle={c.borda} borderColor={c.cor} backgroundColor={c.fundo} paddingX={ESPACO_X} paddingY={ESPACO_Y}>
            <Markdown text={e.props.text} />
          </Box>
        )
      } catch {
        return undefined
      }
    })
}
