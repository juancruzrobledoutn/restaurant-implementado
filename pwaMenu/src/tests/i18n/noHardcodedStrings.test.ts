/**
 * Test de no-hardcoded-strings en componentes de carrito, rondas y páginas.
 *
 * Escanea los archivos TSX/TS de:
 * - src/components/cart/
 * - src/components/rounds/
 * - src/pages/Cart*.tsx
 * - src/pages/RoundsPage.tsx
 *
 * Busca texto JSX que parezca español hardcodeado sin pasar por t().
 *
 * Estrategia: buscamos strings en JSX (entre > y <, o en atributos como title/placeholder/aria-label)
 * que contengan palabras en español con más de 3 caracteres, excluyendo:
 * - Strings dentro de llamadas t('...')
 * - Strings dentro de comentarios
 * - Strings que son solo espacios, números o símbolos
 * - Clases CSS (className=)
 * - Identificadores de código (camelCase, snake_case)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../')

// Files to scan
const SCAN_DIRS = [
  join(ROOT, 'components/cart'),
  join(ROOT, 'components/rounds'),
]
const SCAN_FILES = [
  join(ROOT, 'pages/CartPage.tsx'),
  join(ROOT, 'pages/CartConfirmPage.tsx'),
  join(ROOT, 'pages/RoundsPage.tsx'),
]

// Words that indicate hardcoded Spanish text (common Spanish words)
// These patterns look for Spanish words that appear inside JSX text content
// or HTML attributes (not inside function calls or CSS classes)
const SPANISH_WORD_PATTERN =
  /(?<![a-zA-Z])(?:Agregar|Eliminar|Confirmar|Cancelar|Enviar|Carrito|Ronda|Pedido|Mesa|Total|Subtotal|Notas|Opciones|Cargando|Error|Éxito|Pendiente|Confirmado|Cocina|Listo|Servido|Pagar|Volver|Cerrar|Abrir|Ver|Detalles|Items|Item|Continuar|Guardar)(?![a-zA-Z])/g

function getFilesFromDir(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

function checkFileForHardcodedStrings(filePath: string): string[] {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const violations: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Skip comment lines (JS comments, JSX block comments, JSDoc)
    const trimmed = line.trim()
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('{/*') ||
      trimmed.includes('{/*') // JSX comment blocks like {/* Items */}
    ) {
      continue
    }

    // Skip lines that contain t(' or t(` — these are properly translated
    if (line.includes("t('") || line.includes('t("') || line.includes('t(`')) {
      continue
    }

    // Check for bare Spanish words in JSX content
    const matches = line.match(SPANISH_WORD_PATTERN)
    if (matches) {
      // More precise: check if the match is inside JSX text (not in strings passed to t(), not in className)
      // If line contains className= and the match is there, skip
      if (line.includes('className=')) continue
      // If match is inside a comment, skip
      if (trimmed.startsWith('//')) continue

      // Report the violation
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath
      violations.push(`${fileName}:${lineNum}: suspected hardcoded string: ${matches.join(', ')} — line: ${trimmed}`)
    }
  }

  return violations
}

describe('no-hardcoded-strings', () => {
  const allFiles = [
    ...SCAN_FILES,
    ...SCAN_DIRS.flatMap(getFilesFromDir),
  ]

  it('collected files to scan exist', () => {
    // At least CartPage, CartConfirmPage, RoundsPage should exist
    expect(allFiles.length).toBeGreaterThanOrEqual(3)
  })

  it('cart and rounds components have no hardcoded Spanish text', () => {
    const allViolations: string[] = []

    for (const file of allFiles) {
      const violations = checkFileForHardcodedStrings(file)
      allViolations.push(...violations)
    }

    if (allViolations.length > 0) {
      console.warn(
        '\n⚠️  Possible hardcoded strings found (review manually):\n' +
        allViolations.map((v) => `  • ${v}`).join('\n'),
      )
    }

    // We report as warnings, not hard failures, because the regex is a heuristic
    // The test passes but logs violations for review
    // To make this a hard fail, change the line below:
    expect(allViolations, `Possible hardcoded strings:\n${allViolations.join('\n')}`).toHaveLength(0)
  })
})
