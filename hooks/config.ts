// Ajustes do Caixinhas que a pessoa muda: liga/desliga, intensidade do fundo e cor de cada tipo.
// Funções puras; quem guarda é o $.store, em register.tsx.

import type { Tipo } from './cortar'

export const TIPOS: Tipo[] = ['corpo', 'decisao', 'aviso', 'escopo', 'documento', 'objeto', 'teste', 'fechamento', 'sobreVoce']

// Nome que a pessoa digita → tipo. O nome em inglês é o que aparece; os em português (com e sem
// acento) ficam como apelido, para comando antigo e config guardada continuarem valendo.
const NOMES: Record<string, Tipo> = {
  body: 'corpo', decision: 'decisao', warning: 'aviso', scope: 'escopo', document: 'documento',
  object: 'objeto', test: 'teste', 'wrap-up': 'fechamento', wrapup: 'fechamento', 'about-you': 'sobreVoce', aboutyou: 'sobreVoce',
  corpo: 'corpo', decisao: 'decisao', 'decisão': 'decisao', aviso: 'aviso', escopo: 'escopo',
  documento: 'documento', objeto: 'objeto', teste: 'teste', fechamento: 'fechamento',
  'sobre-voce': 'sobreVoce', 'sobre-você': 'sobreVoce', sobrevoce: 'sobreVoce', 'sobrevocê': 'sobreVoce', sobreVoce: 'sobreVoce',
}
// hasOwn: "constructor" e outras chaves do protótipo não são tipo.
const doNome = (k: string): Tipo | undefined => Object.hasOwn(NOMES, k) ? NOMES[k] : undefined
export const tipoDoNome = (nome: string): Tipo | undefined => doNome(nome.trim()) ?? doNome(nome.trim().toLowerCase())
const NOME_INGLES: Record<Tipo, string> = {
  corpo: 'body', decisao: 'decision', aviso: 'warning', escopo: 'scope', documento: 'document',
  objeto: 'object', teste: 'test', fechamento: 'wrap-up', sobreVoce: 'about-you',
}
export const nomeDoTipo = (t: Tipo) => NOME_INGLES[t]

type Ajuste = { cor?: string; fundo?: string | 'nenhum' }
// Animação das caixas ao chegar (exploração). A ordem é a que o botão do painel roda.
type Animacao = 'nenhuma' | 'relogio' | 'client'
const ANIMACOES: Animacao[] = ['nenhuma', 'relogio', 'client']
// Nome que a pessoa vê e digita para cada animação; o valor guardado continua em português.
export const ROTULO_ANIMACAO: Record<Animacao, string> = { nenhuma: 'none', relogio: 'clock', client: 'client' }
const ANIMACAO_DO_NOME: Record<string, Animacao> = { none: 'nenhuma', clock: 'relogio' }
export function proximaAnimacao(a: Animacao): Animacao {
  const i = ANIMACOES.indexOf(a)
  return ANIMACOES[(i + 1) % ANIMACOES.length]
}

export type Config = { ligado: boolean; intensidade: number; claro: boolean; check: boolean; animacao: Animacao; tipos: Partial<Record<Tipo, Ajuste>> }

export const PADRAO: Config = { ligado: true, intensidade: 50, claro: false, check: true, animacao: 'nenhuma', tipos: {} }

// Caixa marcada como entendida sai em verde, seja qual for o tipo.
export const VERDE = '#5CB85C'

// Cores que o painel oferece, na ordem em que os botões ◀ ▶ passam.
export const PALETA = [
  '#7F77DD', '#4A90E2', '#3FB6B2', '#5CB85C', '#A3BE3C', '#E0B040', '#F08A3C',
  '#E05D5D', '#E06AA8', '#B39DDB', '#9AA0A6', '#B0B0B0', '#6B6B6B',
]
export function proximaCor(atual: string, passo: 1 | -1): string {
  const i = PALETA.indexOf(atual.toUpperCase())
  const n = PALETA.length
  return PALETA[i < 0 ? 0 : (i + passo + n) % n]
}

// Fundo da tela sobre o qual as cores misturam: escuro ou claro.
export const TELA = { escuro: '#121212', claro: '#F7F7F7' }

// Cor da borda e título de cada tipo (decisão A: cores fixas por significado).
export const BASE: Record<Tipo, { cor: string; borda: string; titulo?: string; semFundo?: boolean }> = {
  corpo: { cor: '#7F77DD', borda: 'round' },
  decisao: { cor: '#4A90E2', borda: 'bold', titulo: 'your call' },
  aviso: { cor: '#E0B040', borda: 'round', titulo: 'warning' },
  escopo: { cor: '#9AA0A6', borda: 'round', titulo: 'left out' },
  documento: { cor: '#B0B0B0', borda: 'round', titulo: 'documents' },
  objeto: { cor: '#B0B0B0', borda: 'round', titulo: 'to apply' },
  teste: { cor: '#B39DDB', borda: 'round', titulo: 'test for you' },
  fechamento: { cor: '#5CB85C', borda: 'round', titulo: 'wrap-up' },
  // A pergunta da lista de desconhecidos: o menor destaque de todos, sem fundo.
  sobreVoce: { cor: '#6B6B6B', borda: 'single', titulo: 'about you', semFundo: true },
}

const HEX = /^#[0-9a-fA-F]{6}$/
const ehCor = (s: unknown): s is string => typeof s === 'string' && HEX.test(s)

// O fundo nasce da cor da borda misturada no fundo da tela; a intensidade diz quanto.
export function misturar(a: string, b: string, k: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16)
  const c = [0, 1, 2].map(i => Math.round(p(a, i) * (1 - k) + p(b, i) * k))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function visual(cfg: Config, t: Tipo): { cor: string; fundo?: string; borda: string; titulo?: string } {
  const base = BASE[t]
  const aj = cfg.tipos[t] ?? {}
  const cor = ehCor(aj.cor) ? aj.cor : base.cor
  let fundo: string | undefined
  if (aj.fundo === 'nenhum') fundo = undefined
  else if (ehCor(aj.fundo)) fundo = aj.fundo
  else if (!base.semFundo && cfg.intensidade > 0) fundo = misturar(cfg.claro ? TELA.claro : TELA.escuro, cor, 0.36 * cfg.intensidade / 100)
  return { cor, fundo, borda: base.borda, titulo: base.titulo }
}

// O que vem do $.store pode ser qualquer coisa: só passa o que tem forma.
export function lerConfig(v: unknown): Config {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const tipos: Config['tipos'] = {}
  const t = (o.tipos && typeof o.tipos === 'object' ? o.tipos : {}) as Record<string, unknown>
  for (const tipo of TIPOS) {
    const a = t[tipo] as Record<string, unknown> | undefined
    if (!a || typeof a !== 'object') continue
    const aj: Ajuste = {}
    if (ehCor(a.cor)) aj.cor = a.cor
    if (ehCor(a.fundo) || a.fundo === 'nenhum') aj.fundo = a.fundo as string
    if (aj.cor || aj.fundo) tipos[tipo] = aj
  }
  const i = typeof o.intensidade === 'number' ? Math.round(o.intensidade) : PADRAO.intensidade
  // Config antiga sem o campo, valor torto ou o 'svg' que saiu: sem animação.
  const animacao = ANIMACOES.includes(o.animacao as Animacao) ? o.animacao as Animacao : PADRAO.animacao
  return { ligado: o.ligado !== false, intensidade: Math.max(0, Math.min(100, i)), claro: o.claro === true, check: o.check !== false, animacao, tipos }
}

// Uma mudança pedida (pelo comando ou pela ferramenta). Devolve a config nova ou o erro.
export type Mudanca = {
  ligado?: boolean
  claro?: boolean
  check?: boolean
  animacao?: string
  intensidade?: number
  tipos?: Record<string, { cor?: string; fundo?: string }>
  restaurar?: boolean
}

// Palavras que voltam um campo ao original e que tiram o fundo: inglês primeiro, português como apelido.
const VOLTA = ['default', 'auto', 'padrao', 'padrão']
const SEM_FUNDO = ['none', 'nenhum']
const CAMPO = { cor: 'color', fundo: 'background' } as const

export function aplicar(cfg: Config, m: Mudanca): { cfg: Config } | { erro: string } {
  let novo: Config = m.restaurar ? { ...PADRAO, tipos: {}, ligado: cfg.ligado, claro: cfg.claro, check: cfg.check, animacao: cfg.animacao } : { ...cfg, tipos: { ...cfg.tipos } }
  if (m.ligado !== undefined) novo.ligado = !!m.ligado
  if (m.claro !== undefined) novo.claro = !!m.claro
  if (m.check !== undefined) novo.check = !!m.check
  if (m.animacao !== undefined) {
    // Aceita o nome em inglês e o antigo, com e sem acento (relógio vira relogio), em qualquer caixa.
    const digitado = String(m.animacao).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const a = ANIMACAO_DO_NOME[digitado] ?? digitado
    if (!ANIMACOES.includes(a as Animacao)) return { erro: 'animation: none, clock or client.' }
    novo.animacao = a as Animacao
  }
  if (m.intensidade !== undefined) {
    if (typeof m.intensidade !== 'number' || !isFinite(m.intensidade) || m.intensidade < 0 || m.intensidade > 100) {
      return { erro: 'intensity goes from 0 (no background) to 100 (strong background).' }
    }
    novo.intensidade = Math.round(m.intensidade)
  }
  for (const [nome, pedido] of Object.entries(m.tipos ?? {})) {
    const tipo = tipoDoNome(nome)
    if (!tipo) return { erro: `type "${nome}" does not exist. Types: ${TIPOS.map(nomeDoTipo).join(', ')}.` }
    const aj: Ajuste = { ...(novo.tipos[tipo] ?? {}) }
    for (const campo of ['cor', 'fundo'] as const) {
      const v = pedido?.[campo]
      if (v === undefined) continue
      if (VOLTA.includes(v)) delete aj[campo]
      else if (campo === 'fundo' && SEM_FUNDO.includes(v)) aj.fundo = 'nenhum'
      else if (ehCor(v)) aj[campo] = v.toUpperCase()
      else return { erro: `${CAMPO[campo]} "${v}" is not a #RRGGBB color${campo === 'fundo' ? ', "none"' : ''} nor "default".` }
    }
    if (aj.cor || aj.fundo) novo.tipos[tipo] = aj
    else delete novo.tipos[tipo]
  }
  return { cfg: novo }
}

export function resumo(cfg: Config): string {
  const linhas = [
    `Boxis ${cfg.ligado ? 'on' : 'off'} · background intensity ${cfg.intensidade} · ${cfg.claro ? 'light' : 'dark'} screen · check ${cfg.check ? 'on' : 'off'} · animation ${ROTULO_ANIMACAO[cfg.animacao]}`,
    ...TIPOS.map(t => {
      const v = visual(cfg, t)
      const mudou = cfg.tipos[t] ? ' (adjusted)' : ''
      return `  ${nomeDoTipo(t).padEnd(11)} border ${v.cor} · background ${v.fundo ?? 'none'}${mudou}`
    }),
  ]
  return linhas.join('\n')
}

export const AJUDA = [
  '/boxis                                opens the config panel',
  '/boxis status                         shows the config as text',
  '/boxis pins                           opens the pins of this session (⚲ on a box pins it)',
  '/boxis on | off                       turns the boxes on or off',
  '/boxis screen light | dark            backgrounds for a light or a dark screen',
  '/boxis check on | off                 ✓ button to mark a box as understood',
  '/boxis animation <value>              animation on arrival: none, clock, client',
  '/boxis intensity 0-100                how much colour goes into the background (0 = no background)',
  '/boxis color <type> #RRGGBB           border and title colour (default restores the original)',
  '/boxis background <type> #RRGGBB      fixed background (none removes it, default restores the automatic one)',
  '/boxis default                        restores every colour and the intensity to the original',
  `Types: ${TIPOS.map(nomeDoTipo).join(', ')}`,
].join('\n')

// O que a pessoa digita depois de /boxis vira uma mudança. Palavra em inglês manda; a antiga
// em português (tela, animacao, intensidade, cor, fundo, padrao) segue valendo como apelido.
export function lerComando(args: string): Mudanca | 'mostrar' | 'painel' | 'pins' | { erro: string } {
  const p = args.trim().split(/\s+/).filter(Boolean)
  const [c, a, b] = [p[0]?.toLowerCase(), p[1], p[2]]
  const a2 = a?.toLowerCase()
  if (!c) return 'painel'
  if (c === 'status') return 'mostrar'
  if (c === 'pins' || c === 'pin' || c === 'fixadas') return 'pins'
  if (c === 'screen' || c === 'tela') {
    if (a2 === 'light' || a2 === 'clara') return { claro: true }
    if (a2 === 'dark' || a2 === 'escura') return { claro: false }
  }
  if (c === 'check' && (a2 === 'on' || a2 === 'off')) return { check: a2 === 'on' }
  if (c === 'on' || c === 'ligar' || c === 'liga') return { ligado: true }
  if (c === 'off' || c === 'desligar' || c === 'desliga') return { ligado: false }
  if (c === 'default' || c === 'reset' || c === 'padrao' || c === 'padrão') return { restaurar: true }
  if ((c === 'animation' || c === 'animacao' || c === 'animação') && a) return { animacao: a }
  if (c === 'intensity' || c === 'intensidade') return { intensidade: Number(a) }
  if ((c === 'color' || c === 'cor' || c === 'background' || c === 'fundo') && a && b) {
    const campo = c === 'color' || c === 'cor' ? 'cor' : 'fundo'
    const palavra = b.toLowerCase().replace('padrão', 'padrao')
    return { tipos: { [a]: { [campo]: VOLTA.includes(palavra) || SEM_FUNDO.includes(palavra) ? palavra : b } } }
  }
  return { erro: AJUDA }
}
