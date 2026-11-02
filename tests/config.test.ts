import { test, expect } from 'claude-code/testing'
import { PADRAO, PALETA, aplicar, lerComando, lerConfig, nomeDoTipo, proximaAnimacao, proximaCor, resumo, tipoDoNome, visual } from '../hooks/config'

test('padrão: fundo automático escuro, sobre-voce sem fundo, intensidade 0 tira todos', () => {
  expect(visual(PADRAO, 'decisao').cor).toBe('#4A90E2')
  expect(visual(PADRAO, 'decisao').fundo).toMatch(/^#[0-9A-F]{6}$/)
  expect(visual(PADRAO, 'sobreVoce').fundo).toBeUndefined()
  expect(visual({ ...PADRAO, intensidade: 0 }, 'aviso').fundo).toBeUndefined()
})

test('comando muda cor, fundo, intensidade e volta ao padrão', () => {
  let cfg = PADRAO
  const passo = (args: string) => {
    const m = lerComando(args)
    if (m === 'mostrar' || 'erro' in m) throw new Error(String(m))
    const r = aplicar(cfg, m)
    if ('erro' in r) throw new Error(r.erro)
    cfg = r.cfg
  }
  passo('cor aviso #ff8800')
  expect(visual(cfg, 'aviso').cor).toBe('#FF8800')
  passo('fundo decisão nenhum')
  expect(visual(cfg, 'decisao').fundo).toBeUndefined()
  passo('fundo sobre-voce #202020')
  expect(visual(cfg, 'sobreVoce').fundo).toBe('#202020')
  passo('intensidade 80')
  expect(cfg.intensidade).toBe(80)
  passo('off')
  expect(cfg.ligado).toBe(false)
  passo('padrao')
  expect(cfg.tipos).toEqual({})
  expect(cfg.intensidade).toBe(50)
  expect(cfg.ligado).toBe(false)
})

test('check de entendido: ligado por padrão, comando liga e desliga, padrao não mexe', () => {
  expect(lerConfig(undefined).check).toBe(true)
  expect(lerConfig({ check: false }).check).toBe(false)
  expect(lerComando('check off')).toEqual({ check: false })
  expect(lerComando('check on')).toEqual({ check: true })
  const r = aplicar({ ...PADRAO, check: false }, { restaurar: true })
  expect('cfg' in r && r.cfg.check).toBe(false)
})

test('erros: tipo inexistente, cor torta, intensidade fora da faixa', () => {
  expect('erro' in aplicar(PADRAO, { tipos: { banana: { cor: '#000000' } } })).toBe(true)
  expect('erro' in aplicar(PADRAO, { tipos: { aviso: { cor: 'laranja' } } })).toBe(true)
  expect('erro' in aplicar(PADRAO, { intensidade: 150 })).toBe(true)
  expect(lerComando('qualquer coisa')).toHaveProperty('erro')
})

test('config guardada torta vira padrão', () => {
  expect(lerConfig(null)).toEqual(PADRAO)
  expect(lerConfig({ ligado: false, intensidade: 999, tipos: { aviso: { cor: 'x' } } })).toEqual({ ligado: false, intensidade: 100, claro: false, check: true, animacao: 'nenhuma', tipos: {} })
})

test('tela clara clareia os fundos; botões do painel passam pela paleta e dão a volta', () => {
  const escuro = visual(PADRAO, 'decisao').fundo!
  const claro = visual({ ...PADRAO, claro: true }, 'decisao').fundo!
  expect(parseInt(escuro.slice(1, 3), 16)).toBeLessThan(80)
  expect(parseInt(claro.slice(1, 3), 16)).toBeGreaterThan(150)
  expect(proximaCor(PALETA[0], -1)).toBe(PALETA[PALETA.length - 1])
  expect(proximaCor('#7f77dd', 1)).toBe(PALETA[1])
  expect(proximaCor('#123456', 1)).toBe(PALETA[0])
  expect(lerComando('tela clara')).toEqual({ claro: true })
  expect(lerComando('')).toBe('painel')
})

test('animação: nenhuma por padrão, comando aceita acento, valor torto dá erro, padrao não mexe', () => {
  expect(lerConfig(undefined).animacao).toBe('nenhuma')
  expect(lerConfig({ animacao: 'relogio' }).animacao).toBe('relogio')
  expect(lerConfig({ animacao: 'banana' }).animacao).toBe('nenhuma')
  const m = lerComando('animacao relógio')
  expect(m).toEqual({ animacao: 'relógio' })
  const r = aplicar(PADRAO, m as { animacao: string })
  expect('cfg' in r && r.cfg.animacao).toBe('relogio')
  expect(lerComando('animação svg')).toEqual({ animacao: 'svg' })
  expect('erro' in aplicar(PADRAO, { animacao: 'piscar' })).toBe(true)
  const p = aplicar({ ...PADRAO, animacao: 'svg' }, { restaurar: true })
  expect('cfg' in p && p.cfg.animacao).toBe('svg')
  expect(proximaAnimacao('nenhuma')).toBe('relogio')
  expect(proximaAnimacao('svg')).toBe('nenhuma')
  expect(resumo({ ...PADRAO, animacao: 'relogio' })).toContain('animation clock')
  expect(resumo(PADRAO)).toContain('Boxis on · background intensity 50 · dark screen · check on · animation none')
  expect(resumo(PADRAO)).toContain('  body        border #7F77DD · background #')
  expect(resumo(PADRAO)).toContain('  about-you   border #6B6B6B · background none')
})

test('nomes em inglês mandam, os antigos em português seguem como apelido', () => {
  expect(tipoDoNome('decision')).toBe('decisao')
  expect(tipoDoNome('decisão')).toBe('decisao')
  expect(tipoDoNome('Decisao')).toBe('decisao')
  expect(tipoDoNome('about-you')).toBe('sobreVoce')
  expect(tipoDoNome('sobre-você')).toBe('sobreVoce')
  expect(tipoDoNome('wrap-up')).toBe('fechamento')
  expect(nomeDoTipo('decisao')).toBe('decision')
  expect(nomeDoTipo('sobreVoce')).toBe('about-you')
  expect(lerComando('screen light')).toEqual({ claro: true })
  expect(lerComando('tela clara')).toEqual({ claro: true })
  expect(lerComando('screen dark')).toEqual({ claro: false })
  expect(lerComando('animation clock')).toEqual({ animacao: 'clock' })
  expect(lerComando('intensity 30')).toEqual({ intensidade: 30 })
  expect(lerComando('default')).toEqual({ restaurar: true })
  expect(lerComando('color warning #ff8800')).toEqual({ tipos: { warning: { cor: '#ff8800' } } })
  expect(lerComando('background decision none')).toEqual({ tipos: { decision: { fundo: 'none' } } })
  expect(lerComando('background decision Default')).toEqual({ tipos: { decision: { fundo: 'default' } } })
  const a = aplicar(PADRAO, { animacao: 'none' })
  expect('cfg' in a && a.cfg.animacao).toBe('nenhuma')
  const c = aplicar(PADRAO, { animacao: 'clock' })
  expect('cfg' in c && c.cfg.animacao).toBe('relogio')
  const f = aplicar(PADRAO, { tipos: { decision: { fundo: 'none' } } })
  expect('cfg' in f && f.cfg.tipos.decisao).toEqual({ fundo: 'nenhum' })
  const d = aplicar({ ...PADRAO, tipos: { decisao: { fundo: 'nenhum', cor: '#000000' } } }, { tipos: { decision: { fundo: 'default' } } })
  expect('cfg' in d && d.cfg.tipos.decisao).toEqual({ cor: '#000000' })
  const e = aplicar(PADRAO, { tipos: { banana: { cor: '#000000' } } })
  expect('erro' in e && e.erro).toBe('type "banana" does not exist. Types: body, decision, warning, scope, document, object, test, wrap-up, about-you.')
  const g = aplicar(PADRAO, { tipos: { warning: { fundo: 'laranja' } } })
  expect('erro' in g && g.erro).toBe('background "laranja" is not a #RRGGBB color, "none" nor "default".')
  const h = aplicar(PADRAO, { tipos: { warning: { cor: 'laranja' } } })
  expect('erro' in h && h.erro).toBe('color "laranja" is not a #RRGGBB color nor "default".')
  const i = aplicar(PADRAO, { animacao: 'piscar' })
  expect('erro' in i && i.erro).toBe('animation: none, clock, client or svg.')
})
