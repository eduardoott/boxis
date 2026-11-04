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
  // Without the colon it is not the slot: plain body text.
  expect(types('🧪 Test\n1. a')).toEqual(['body'])
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

test('a heading opens a body box titled with the subject; the slot boxes keep their own titles', () => {
  const p = split([
    'Intro line.',
    '',
    '### First **subject**',
    'Text one.',
    '',
    'More of one.',
    '## Second subject ##',
    'Text two.',
    '⚠️ Careful.',
    'After the warning.',
    '```md',
    '### not a heading inside a block',
    '```',
  ].join('\n'))
  expect(p.map(x => [x.type, x.title])).toEqual([
    ['body', undefined],
    ['body', 'First subject'],
    ['body', 'Second subject'],
    ['warning', undefined],
    ['body', undefined],
  ])
  expect(p[1].text).toBe('Text one.\n\nMore of one.')
  expect(p[4].text).toContain('### not a heading inside a block')
})

test('one heading alone still gives its titled box; a heading with nothing under it gives none', () => {
  expect(split('### Only\ntext')).toEqual([{ type: 'body', text: 'text', title: 'Only' }])
  expect(types('### Empty\n⚠️ x')).toEqual(['warning'])
  expect(types('# Big title\ntext')).toEqual(['body'])
})

test('a table right under a warning or a decision stays in that box; text after it is body again', () => {
  const t = '⚠️ Risk.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.\n\n| x |\n|---|\n| y |'
  expect(split(t)).toEqual([
    { type: 'warning', text: 'Risk.\n\n| a | b |\n|---|---|\n| 1 | 2 |' },
    { type: 'body', text: 'After.\n\n| x |\n|---|\n| y |' },
  ])
  expect(types('❓ Which?\n| a |\n|---|\n| 1 |')).toEqual(['decision'])
  expect(types('🚧 Out.\n\n| a |\n|---|\n| 1 |')).toEqual(['scope', 'body'])
})

test('labelled slots need label and colon: a bare check is body, the wrap-up keeps its label', () => {
  expect(types('✅ passed')).toEqual(['body'])
  expect(split('✅ Feito: x. ➡️ Planejado: y.')).toEqual([{ type: 'wrap-up', text: 'Feito: x. ➡️ Planejado: y.' }])
  expect(split('✅ Done: x.')[0].text).toBe('Done: x.')
})
