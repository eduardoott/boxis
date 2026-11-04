import { test, expect } from 'claude-code/testing'
import { DEFAULTS, PALETTE, apply, nextAnimation, nextColor, parseCommand, readConfig, style, summary, typeFromName, type Change } from '../hooks/config'

test('defaults: automatic dark background, about-you without background, intensity 0 removes them all', () => {
  expect(style(DEFAULTS, 'decision').color).toBe('#4A90E2')
  expect(style(DEFAULTS, 'decision').background).toMatch(/^#[0-9A-F]{6}$/)
  expect(style(DEFAULTS, 'about-you').background).toBeUndefined()
  expect(style({ ...DEFAULTS, intensity: 0 }, 'warning').background).toBeUndefined()
})

const run = (start = DEFAULTS) => {
  let cfg = start
  const step = (args: string) => {
    const m = parseCommand(args)
    if (typeof m === 'string' || 'error' in m) throw new Error(String(m))
    const r = apply(cfg, m)
    if ('error' in r) throw new Error(r.error)
    cfg = r.cfg
  }
  return { step, cfg: () => cfg }
}

test('the command changes colour, background, intensity and restores the defaults', () => {
  const { step, cfg } = run()
  step('color warning #ff8800')
  expect(style(cfg(), 'warning').color).toBe('#FF8800')
  step('background decision none')
  expect(style(cfg(), 'decision').background).toBeUndefined()
  step('background about-you #202020')
  expect(style(cfg(), 'about-you').background).toBe('#202020')
  step('intensity 80')
  expect(cfg().intensity).toBe(80)
  step('off')
  expect(cfg().enabled).toBe(false)
  step('default')
  expect(cfg().types).toEqual({})
  expect(cfg().intensity).toBe(50)
  expect(cfg().enabled).toBe(false)
})

// The legacy Portuguese command words stay as aliases.
test('legacy command words still work as aliases', () => {
  const { step, cfg } = run()
  step('cor aviso #ff8800')
  expect(style(cfg(), 'warning').color).toBe('#FF8800')
  step('fundo decisão nenhum')
  expect(cfg().types.decision).toEqual({ background: 'none' })
  step('fundo sobre-voce #202020')
  expect(style(cfg(), 'about-you').background).toBe('#202020')
  step('intensidade 80')
  expect(cfg().intensity).toBe(80)
  step('desligar')
  expect(cfg().enabled).toBe(false)
  step('padrao')
  expect(cfg().types).toEqual({})
  expect(parseCommand('tela clara')).toEqual({ light: true })
  expect(parseCommand('tela escura')).toEqual({ light: false })
  expect(parseCommand('animacao relógio')).toEqual({ animation: 'relógio' })
  expect(parseCommand('fixadas')).toBe('pins')
})

test('check as understood: on by default, the command turns it on and off, default leaves it', () => {
  expect(readConfig(undefined).check).toBe(true)
  expect(readConfig({ check: false }).check).toBe(false)
  expect(parseCommand('check off')).toEqual({ check: false })
  expect(parseCommand('check on')).toEqual({ check: true })
  const r = apply({ ...DEFAULTS, check: false }, { reset: true })
  expect('cfg' in r && r.cfg.check).toBe(false)
})

test('errors: unknown type, bad colour, intensity out of range', () => {
  expect('error' in apply(DEFAULTS, { types: { banana: { color: '#000000' } } })).toBe(true)
  expect('error' in apply(DEFAULTS, { types: { warning: { color: 'orange' } } })).toBe(true)
  expect('error' in apply(DEFAULTS, { intensity: 150 })).toBe(true)
  expect(parseCommand('anything at all')).toHaveProperty('error')
})

test('a malformed saved config reads as the defaults', () => {
  expect(readConfig(null)).toEqual(DEFAULTS)
  expect(readConfig({ enabled: false, intensity: 999, types: { warning: { color: 'x' } } })).toEqual({ enabled: false, intensity: 100, light: false, check: true, animation: 'none', maxPins: 5, types: {} })
})

test('a light screen lightens the backgrounds; the pane buttons walk the palette and wrap around', () => {
  const dark = style(DEFAULTS, 'decision').background!
  const light = style({ ...DEFAULTS, light: true }, 'decision').background!
  expect(parseInt(dark.slice(1, 3), 16)).toBeLessThan(80)
  expect(parseInt(light.slice(1, 3), 16)).toBeGreaterThan(150)
  expect(nextColor(PALETTE[0], -1)).toBe(PALETTE[PALETTE.length - 1])
  expect(nextColor('#7f77dd', 1)).toBe(PALETTE[1])
  expect(nextColor('#123456', 1)).toBe(PALETTE[0])
  expect(parseCommand('screen light')).toEqual({ light: true })
  expect(parseCommand('')).toBe('panel')
})

test('animation: none by default, the command takes accents, a bad value errors, default leaves it', () => {
  expect(readConfig(undefined).animation).toBe('none')
  expect(readConfig({ animation: 'clock' }).animation).toBe('clock')
  expect(readConfig({ animation: 'banana' }).animation).toBe('none')
  const m = parseCommand('animation Clock')
  expect(m).toEqual({ animation: 'Clock' })
  const r = apply(DEFAULTS, m as Change)
  expect('cfg' in r && r.cfg.animation).toBe('clock')
  const legacy = apply(DEFAULTS, { animation: 'relógio' })
  expect('cfg' in legacy && legacy.cfg.animation).toBe('clock')
  expect('error' in apply(DEFAULTS, { animation: 'blink' })).toBe(true)
  const p = apply({ ...DEFAULTS, animation: 'client' }, { reset: true })
  expect('cfg' in p && p.cfg.animation).toBe('client')
  expect(nextAnimation('none')).toBe('clock')
  expect(nextAnimation('client')).toBe('none')
  expect(summary({ ...DEFAULTS, animation: 'clock' })).toContain('animation clock')
  expect(summary(DEFAULTS)).toContain('Boxis on · background intensity 50 · dark screen · check on · animation none · max pins 5')
  expect(summary(DEFAULTS)).toContain('  body        border #7F77DD · background #')
  expect(summary(DEFAULTS)).toContain('  about-you   border #6B6B6B · background none')
})

test('English type names rule, the legacy Portuguese ones stay as aliases', () => {
  expect(typeFromName('decision')).toBe('decision')
  expect(typeFromName('decisão')).toBe('decision')
  expect(typeFromName('Decisao')).toBe('decision')
  expect(typeFromName('about-you')).toBe('about-you')
  expect(typeFromName('sobre-você')).toBe('about-you')
  expect(typeFromName('sobreVoce')).toBe('about-you')
  expect(typeFromName('wrap-up')).toBe('wrap-up')
  expect(typeFromName('fechamento')).toBe('wrap-up')
  expect(parseCommand('screen dark')).toEqual({ light: false })
  expect(parseCommand('animation clock')).toEqual({ animation: 'clock' })
  expect(parseCommand('intensity 30')).toEqual({ intensity: 30 })
  expect(parseCommand('default')).toEqual({ reset: true })
  expect(parseCommand('color warning #ff8800')).toEqual({ types: { warning: { color: '#ff8800' } } })
  expect(parseCommand('background decision none')).toEqual({ types: { decision: { background: 'none' } } })
  expect(parseCommand('background decision Default')).toEqual({ types: { decision: { background: 'default' } } })
  const f = apply(DEFAULTS, { types: { decision: { background: 'none' } } })
  expect('cfg' in f && f.cfg.types.decision).toEqual({ background: 'none' })
  const d = apply({ ...DEFAULTS, types: { decision: { background: 'none', color: '#000000' } } }, { types: { decision: { background: 'default' } } })
  expect('cfg' in d && d.cfg.types.decision).toEqual({ color: '#000000' })
  const e = apply(DEFAULTS, { types: { banana: { color: '#000000' } } })
  expect('error' in e && e.error).toBe('type "banana" does not exist. Types: body, decision, warning, scope, document, object, test, wrap-up, about-you.')
  const g = apply(DEFAULTS, { types: { warning: { background: 'orange' } } })
  expect('error' in g && g.error).toBe('background "orange" is not a #RRGGBB color, "none" nor "default".')
  const h = apply(DEFAULTS, { types: { warning: { color: 'orange' } } })
  expect('error' in h && h.error).toBe('color "orange" is not a #RRGGBB color nor "default".')
  const i = apply(DEFAULTS, { animation: 'blink' })
  expect('error' in i && i.error).toBe('animation: none, clock or client.')
})

test('max pins: 5 by default, clamped to 1..10 on read and on change, set by /boxis pins max N', () => {
  expect(readConfig(undefined).maxPins).toBe(5)
  expect(readConfig({ maxPins: 0 }).maxPins).toBe(1)
  expect(readConfig({ maxPins: 99 }).maxPins).toBe(10)
  expect(readConfig({ maxPins: 7.4 }).maxPins).toBe(7)
  expect(readConfig({ maxPins: 'x' }).maxPins).toBe(5)
  expect(parseCommand('pins max 8')).toEqual({ maxPins: 8 })
  expect(parseCommand('pins')).toBe('pins')
  const { step, cfg } = run()
  step('pins max 3')
  expect(cfg().maxPins).toBe(3)
  step('pins max 40')
  expect(cfg().maxPins).toBe(10)
  step('default')
  expect(cfg().maxPins).toBe(10)
  expect('error' in apply(DEFAULTS, { maxPins: Number('x') })).toBe(true)
})
