// Corta a resposta em pedaços pelo emoji do começo da linha (fase 2 do plano-caixinhas.md).
// Função pura: não desenha nada, só diz que pedaço é de que tipo.

export type Tipo = 'corpo' | 'decisao' | 'sobreVoce' | 'aviso' | 'escopo' | 'documento' | 'objeto' | 'teste' | 'fechamento'

export type Pedaco = { tipo: Tipo; texto: string }

// Ordem importa: "❓ About you:" (ou o antigo "Sobre você:") antes de "❓".
const INICIOS: [RegExp, Tipo][] = [
  [/^❓\s*(Sobre você|About you):\s*/iu, 'sobreVoce'],
  [/^❓\s*/u, 'decisao'],
  [/^⚠️?\s*/u, 'aviso'],
  [/^🚧\s*/u, 'escopo'],
  [/^📄\s*/u, 'documento'],
  [/^📌\s*/u, 'objeto'],
  [/^🧪\s*Testar:?\s*/u, 'teste'],
  [/^✅\s*/u, 'fechamento'],
]

const CERCA = /^\s*(```|~~~)/
const PASSO = /^\s*\d+[.)]\s/
const RECUADA = /^\s+\S/

function tipoDaLinha(linha: string): { tipo: Tipo; resto: string } | null {
  for (const [re, tipo] of INICIOS) {
    const m = re.exec(linha)
    if (m) return { tipo, resto: linha.slice(m[0].length) }
  }
  return null
}

export function cortar(texto: string): Pedaco[] {
  const pedacos: Pedaco[] = []
  let atual: { tipo: Tipo; linhas: string[] } | null = null
  let brancas: string[] = []
  let cerca: string | null = null

  const fechar = () => {
    if (atual) {
      const t = atual.linhas.join('\n').trim()
      if (t) pedacos.push({ tipo: atual.tipo, texto: t })
    }
    atual = null
  }
  const por = (tipo: Tipo, linha: string, cabecalho = false) => {
    if (atual && atual.tipo === tipo) {
      atual.linhas.push(...brancas)
    } else {
      fechar()
      atual = { tipo, linhas: [] }
    }
    brancas = []
    if (!cabecalho) atual!.linhas.push(linha)
  }

  for (const linha of texto.split('\n')) {
    // Dentro de bloco de código nada corta: a linha vai para o pedaço onde o bloco abriu.
    if (cerca) {
      atual!.linhas.push(...brancas, linha)
      brancas = []
      if (linha.trim().startsWith(cerca)) cerca = null
      continue
    }
    if (linha.trim() === '') {
      brancas.push(linha)
      continue
    }
    const abre = CERCA.exec(linha)
    if (abre) {
      // Bloco recuado dentro de um passo de teste fica no teste; o resto é corpo.
      const tipo: Tipo = atual?.tipo === 'teste' && RECUADA.test(linha) ? 'teste' : 'corpo'
      por(tipo, linha)
      cerca = abre[1]
      continue
    }
    const achou = tipoDaLinha(linha)
    if (achou) {
      // "🧪 Testar:" sozinho vira só o título da caixa; com texto depois, o texto fica.
      por(achou.tipo, achou.resto, achou.tipo === 'teste' && achou.resto.trim() === '')
      continue
    }
    if (atual?.tipo === 'teste' && (PASSO.test(linha) || RECUADA.test(linha))) {
      por('teste', linha)
      continue
    }
    por('corpo', linha)
  }
  fechar()
  return pedacos
}
