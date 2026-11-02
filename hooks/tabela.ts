// Acha as tabelas markdown de um pedaço para o Caixinhas desenhá-las com quebra de linha.
// Função pura; o desenho fica em register.tsx.

export type Trecho =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'tabela'; cabecalho: string[]; linhas: string[][] }

const CERCA = /^\s*(```|~~~)/
const SEPARADOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const ehLinhaDeTabela = (l: string) => l.trim().startsWith('|') || /\S\s*\|\s*\S/.test(l)

export function celulas(linha: string): string[] {
  let t = linha.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

export const temTabela = (texto: string) => separarTabelas(texto).some(t => t.tipo === 'tabela')

export function separarTabelas(texto: string): Trecho[] {
  const linhas = texto.split('\n')
  const trechos: Trecho[] = []
  let solto: string[] = []
  let cerca: string | null = null
  const soltar = () => {
    const t = solto.join('\n').trim()
    if (t) trechos.push({ tipo: 'texto', texto: t })
    solto = []
  }

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]
    if (cerca) {
      solto.push(l)
      if (l.trim().startsWith(cerca)) cerca = null
      continue
    }
    const m = CERCA.exec(l)
    if (m) {
      cerca = m[1]
      solto.push(l)
      continue
    }
    // Cabeçalho seguido do separador |---|---| abre uma tabela.
    if (ehLinhaDeTabela(l) && i + 1 < linhas.length && SEPARADOR.test(linhas[i + 1])) {
      const cabecalho = celulas(l)
      const corpo: string[][] = []
      let j = i + 2
      while (j < linhas.length && linhas[j].trim() && ehLinhaDeTabela(linhas[j])) {
        const c = celulas(linhas[j])
        corpo.push(cabecalho.map((_, k) => c[k] ?? ''))
        j++
      }
      soltar()
      trechos.push({ tipo: 'tabela', cabecalho, linhas: corpo })
      i = j - 1
      continue
    }
    solto.push(l)
  }
  soltar()
  return trechos
}

// Quanto cada coluna cresce: o texto mais longo dela, com piso e teto para nenhuma sumir.
export function pesos(cabecalho: string[], linhas: string[][]): number[] {
  return cabecalho.map((c, k) => {
    const maior = Math.max(c.length, ...linhas.map(l => (l[k] ?? '').length))
    return Math.max(6, Math.min(maior, 60))
  })
}
