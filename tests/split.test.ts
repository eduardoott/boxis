import { test, expect } from 'claude-code/testing'
import { split } from '../hooks/split'

const types = (t: string) => split(t).map(p => p.type)

test('a slot-shaped answer splits into the right pieces', () => {
  const answer = [
    'Made the change.',
    '',
    '📊 Status:',
    '',
    '| Case | Result |',
    '|---|---|',
    '| a | ✅ passed |',
    '',
    '🧪 Test:',
    '1. Open the session.',
    '2. Say hi.',
    '',
    '⚠️ X may break.',
    '🚧 Y was left out.',
    '',
    '❓ A or B?',
    '',
    '❓ And C?',
    '',
    '❓ About you: coffee or tea?',
    '',
    '✅ Done: change. ➡️ Next: test.',
    '',
    '📄 [plan.md](plan.md)',
    '📌 [a.ts](a.ts)',
  ].join('\n')
  const p = split(answer)
  expect(p.map(x => x.type)).toEqual(['body', 'test', 'warning', 'scope', 'decision', 'about-you', 'wrap-up', 'document', 'object'])
  expect(p[0].text).toContain('| a | ✅ passed |')
  expect(p[1].text).toBe('1. Open the session.\n2. Say hi.')
  expect(p[4].text).toBe('A or B?\n\nAnd C?')
  expect(p[5].text).toBe('coffee or tea?')
  expect(p[6].text).toBe('Done: change. ➡️ Next: test.')
  expect(p[7].text).toBe('[plan.md](plan.md)')
  expect(p[8].text).toBe('[a.ts](a.ts)')
})

// The same answer in English and in Portuguese (the legacy slot labels) gives the same boxes.
test('slot labels are bilingual: both languages give identical boxes', () => {
  const answer = (l: { test: string; about: string; done: string; next: string }) => [
    'Text.',
    '',
    `🧪 ${l.test}`,
    '1. One.',
    '   indented',
    '2. Two.',
    '',
    '⚠️ Risk.',
    '',
    '❓ A or B?',
    '',
    `❓ ${l.about} coffee?`,
    '',
    `✅ ${l.done} x. ➡️ ${l.next} y.`,
  ].join('\n')
  const en = split(answer({ test: 'Test:', about: 'About you:', done: 'Done:', next: 'Next:' }))
  const pt = split(answer({ test: 'Testar:', about: 'Sobre você:', done: 'Feito:', next: 'Planejado:' }))
  expect(en.map(p => p.type)).toEqual(['body', 'test', 'warning', 'decision', 'about-you', 'wrap-up'])
  expect(pt.map(p => p.type)).toEqual(en.map(p => p.type))
  // Every box but the wrap-up holds the same text: the labels themselves never reach the box.
  expect(pt.slice(0, 5)).toEqual(en.slice(0, 5))
  expect(split('🧪 Test:\n1. a')).toEqual(split('🧪 Testar:\n1. a'))
  expect(split('🧪 Test\n1. a')).toEqual(split('🧪 Testar\n1. a'))
  expect(types('🧪 Tests are green.')).toEqual(['body'])
})

test('"❓ About you:" in English and "❓ Sobre você:" (legacy) both give about-you', () => {
  expect(split('❓ About you: coffee or tea?')).toEqual([{ type: 'about-you', text: 'coffee or tea?' }])
  expect(split('❓ about you: coffee?')).toEqual([{ type: 'about-you', text: 'coffee?' }])
  expect(split('❓ Sobre você: coffee?')).toEqual([{ type: 'about-you', text: 'coffee?' }])
  expect(types('❓ About me?')).toEqual(['decision'])
})

test('an emoji inside a code block does not split', () => {
  const t = 'See:\n\n```text\n❓ this is code\n⚠️ this too\n```\n\nend'
  expect(types(t)).toEqual(['body'])
})

test('a one-sentence answer stays whole', () => {
  expect(split('Just that.')).toEqual([{ type: 'body', text: 'Just that.' }])
})

test('a code block after the test steps goes to the body', () => {
  expect(types('🧪 Test:\n1. Paste:\n\n```text\nhi\n```')).toEqual(['test', 'body'])
})
