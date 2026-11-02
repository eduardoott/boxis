import { test, expect } from 'claude-code/testing'
import { cortar } from '../hooks/cortar'

const tipos = (t: string) => cortar(t).map(p => p.tipo)

test('2.1 resposta do modo direto sai nos pedaços certos', () => {
  const resposta = [
    'Fiz a troca.',
    '',
    '📊 Estado:',
    '',
    '| Caso | Situação |',
    '|---|---|',
    '| a | ✅ passou |',
    '',
    '🧪 Testar:',
    '1. Abrir a sessão.',
    '2. Mandar oi.',
    '',
    '⚠️ Pode quebrar X.',
    '🚧 Faltou Y.',
    '',
    '❓ Faço A ou B?',
    '',
    '❓ E C?',
    '',
    '❓ Sobre você: café ou chá?',
    '',
    '✅ Feito: troca. ➡️ Planejado: teste.',
    '',
    '📄 [plano.md](plano.md)',
    '📌 [a.ts](a.ts)',
  ].join('\n')
  const p = cortar(resposta)
  expect(p.map(x => x.tipo)).toEqual(['corpo', 'teste', 'aviso', 'escopo', 'decisao', 'sobreVoce', 'fechamento', 'documento', 'objeto'])
  expect(p[0].texto).toContain('| a | ✅ passou |')
  expect(p[1].texto).toBe('1. Abrir a sessão.\n2. Mandar oi.')
  expect(p[4].texto).toBe('Faço A ou B?\n\nE C?')
  expect(p[5].texto).toBe('café ou chá?')
  expect(p[6].texto).toBe('Feito: troca. ➡️ Planejado: teste.')
  expect(p[7].texto).toBe('[plano.md](plano.md)')
  expect(p[8].texto).toBe('[a.ts](a.ts)')
})

test('"❓ About you:" em inglês e "❓ Sobre você:" em português dão sobreVoce', () => {
  expect(cortar('❓ About you: coffee or tea?')).toEqual([{ tipo: 'sobreVoce', texto: 'coffee or tea?' }])
  expect(cortar('❓ about you: coffee?')).toEqual([{ tipo: 'sobreVoce', texto: 'coffee?' }])
  expect(cortar('❓ Sobre você: café?')).toEqual([{ tipo: 'sobreVoce', texto: 'café?' }])
  expect(tipos('❓ About me?')).toEqual(['decisao'])
})

test('2.2 emoji dentro de bloco de código não corta', () => {
  const t = 'Veja:\n\n```text\n❓ isto é código\n⚠️ também\n```\n\nfim'
  expect(tipos(t)).toEqual(['corpo'])
})

test('2.7 resposta de uma frase fica inteira', () => {
  expect(cortar('Só isso.')).toEqual([{ tipo: 'corpo', texto: 'Só isso.' }])
})

test('bloco de código depois dos passos de teste vai para o corpo', () => {
  expect(tipos('🧪 Testar:\n1. Cole:\n\n```text\noi\n```')).toEqual(['teste', 'corpo'])
})
