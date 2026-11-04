// Blocos de código cercados, lidos como o CommonMark: a cerca que abriu diz qual fecha.
// Um só lugar para cortar.ts, tabela.ts e register.tsx não discordarem sobre onde um bloco acaba.

export type Cerca = { char: string; n: number }

// O recuo livre (e não até 3 espaços) é de propósito: o bloco recuado de um passo de teste é cerca.
const ABRE = /^\s*(`{3,}|~{3,})(.*)$/
const FECHA = /^\s*(`{3,}|~{3,})\s*$/

export function abreCerca(linha: string): Cerca | null {
  const m = ABRE.exec(linha)
  if (!m) return null
  // Crase na info string é código em linha, não cerca.
  if (m[1][0] === '`' && m[2].includes('`')) return null
  return { char: m[1][0], n: m[1].length }
}

// Fecha só com o mesmo caractere, uma corrida pelo menos do mesmo tamanho e nada depois.
export function fechaCerca(linha: string, aberta: Cerca): boolean {
  const m = FECHA.exec(linha)
  return !!m && m[1][0] === aberta.char && m[1].length >= aberta.n
}

export const temCerca = (texto: string) => texto.split('\n').some(l => abreCerca(l) !== null)

export function cercaAbertaNoFim(texto: string): Cerca | null {
  let aberta: Cerca | null = null
  for (const l of texto.split('\n')) aberta = aberta ? (fechaCerca(l, aberta) ? null : aberta) : abreCerca(l)
  return aberta
}
