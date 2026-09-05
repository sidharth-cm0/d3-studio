/**
 * Scene Graph Relations — Self-Test Runner (Phase 3, Task 5).
 *
 * Verifies the full relation pipeline for the 6 resolvable relation types:
 *   - "chair near table"
 *   - "lamp left of sofa"
 *   - "sofa right of lamp"
 *   - "crate behind machinery"
 *   - "detective facing streetlight"
 *   - "box in front of door"
 *
 * Checks:
 *   - parser produces valid entities (objects with stable IDs)
 *   - IDs are unique
 *   - relations reference valid IDs (subject/object exist)
 *   - transforms remain finite (positions, rotations, scales)
 *   - directional relations are geometrically correct after layout
 *   - facing produces the expected orientation within tolerance
 *
 * Usage (project has no ts-node runner):
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-rel-test \
 *     src/services/sceneGraphTypes.ts \
 *     src/services/sceneGraphValidator.ts \
 *     src/services/sceneGraphParser.ts \
 *     src/services/semanticDimensions.ts \
 *     src/services/spatialLayoutEngine.ts \
 *     src/services/sceneGraphRelations.test.ts
 *   node /tmp/d3-rel-test/sceneGraphRelations.test.js
 */

import { parseSceneGraph } from './sceneGraphParser'
import { validateSceneGraph } from './sceneGraphValidator'
import { planLayout, relationSatisfied } from './spatialLayoutEngine'
import type { SceneGraph, SceneRelation } from './sceneGraphTypes'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failureCount = 0

const pass = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failureCount++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

function isFiniteTuple(v: number[]): boolean {
  return v.length === 3 && v.every((n) => Number.isFinite(n))
}

interface RelationCase {
  label: string
  prompt: string
  expectedType: SceneRelation['type']
  subjectSemantic: string
  objectSemantic: string
}

const CASES: RelationCase[] = [
  { label: 'chair near table', prompt: 'chair near table', expectedType: 'near', subjectSemantic: 'chair', objectSemantic: 'table' },
  { label: 'lamp left of sofa', prompt: 'lamp left of sofa', expectedType: 'leftOf', subjectSemantic: 'lamp_post', objectSemantic: 'sofa' },
  { label: 'sofa right of lamp', prompt: 'sofa right of lamp', expectedType: 'rightOf', subjectSemantic: 'sofa', objectSemantic: 'lamp_post' },
  { label: 'crate behind machinery', prompt: 'crate behind machinery', expectedType: 'behind', subjectSemantic: 'crate', objectSemantic: 'lab_machine' },
  { label: 'detective facing streetlight', prompt: 'detective facing streetlight', expectedType: 'facing', subjectSemantic: 'detective', objectSemantic: 'lamp_post' },
  { label: 'box in front of door', prompt: 'box in front of door', expectedType: 'inFrontOf', subjectSemantic: 'crate', objectSemantic: 'door' },
]

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

export function runSceneGraphRelationsSelfTest(): number {
  failureCount = 0
  console.log('[D3 RELATIONS] Self-Test')

  for (const c of CASES) {
    console.group(`  ${c.label}`)
    const parsed = parseSceneGraph(c.prompt)
    const sg: SceneGraph = parsed.sceneGraph

    const repeated = parseSceneGraph(c.prompt).sceneGraph
    pass(
      'entity IDs deterministic across parses',
      JSON.stringify(sg.objects.map((object) => object.id)) === JSON.stringify(repeated.objects.map((object) => object.id))
    )

    // --- parser produces valid entities ------------------------------------
    pass('parser produced objects', sg.objects.length > 0, `${sg.objects.length} objects`)

    // --- IDs are unique ----------------------------------------------------
    const ids = sg.objects.map((o) => o.id)
    const unique = new Set(ids).size === ids.length
    pass('entity IDs unique', unique, `ids=${ids.length}`)

    // --- relations reference valid IDs ------------------------------------
    const idSet = new Set(ids)
    const rel = sg.relations.find((r) => r.type === c.expectedType)
    pass(`relation "${c.expectedType}" parsed`, !!rel, rel ? `${rel.subject} → ${rel.object}` : 'none')
    if (rel) {
      pass('relation subject exists', idSet.has(rel.subject), rel.subject)
      pass('relation object exists', idSet.has(rel.object), rel.object)
      pass('no self-relation', rel.subject !== rel.object)
      pass(
        'relation subject semantic matches',
        sg.objects.find((object) => object.id === rel.subject)?.semanticType === c.subjectSemantic
      )
      pass(
        'relation object semantic matches',
        sg.objects.find((object) => object.id === rel.object)?.semanticType === c.objectSemantic
      )
    }

    // --- transforms remain finite ------------------------------------------
    const allFinite = sg.objects.every(
      (o) => isFiniteTuple(o.position) && isFiniteTuple(o.rotation) && isFiniteTuple(o.scale)
    )
    pass('parser transforms finite', allFinite)

    // --- layout + geometric resolution -------------------------------------
    const layout = planLayout({ sceneGraph: sg, objects: sg.objects, seed: sg.seed })
    const resolvedFinite = layout.objects.every(
      (o) => isFiniteTuple(o.position) && isFiniteTuple(o.rotation) && isFiniteTuple(o.scale)
    )
    pass('layout transforms finite', resolvedFinite)

    if (rel) {
      const subject = layout.objects.find((o) => o.sourceSpecId === rel.subject)
      const object = layout.objects.find((o) => o.sourceSpecId === rel.object)
      if (subject && object) {
        const res = relationSatisfied(rel, layout.objects)
        pass(`directional relation geometrically correct (${c.expectedType})`, res.satisfied, res.detail)

        // facing: expected orientation within tolerance
        if (c.expectedType === 'facing') {
          const yaw = subject.rotation[1]
          const desired = Math.atan2(object.position[0] - subject.position[0], object.position[2] - subject.position[2])
          const diff = Math.abs(Math.atan2(Math.sin(yaw - desired), Math.cos(yaw - desired)))
          pass('facing orientation within tolerance', diff <= 0.35, `yaw=${yaw.toFixed(3)} desired=${desired.toFixed(3)} diff=${diff.toFixed(3)}`)
        }
      } else {
        pass('layout contains both relation entities', false, `subject=${!!subject} object=${!!object}`)
      }
    }
    console.groupEnd()
  }

  console.group('  relation validation')
  const validationBase = parseSceneGraph('chair near table').sceneGraph
  const duplicateIdRaw = {
    ...validationBase,
    objects: validationBase.objects.map((object, index) => ({
      ...object,
      id: index < 2 ? 'duplicate' : object.id,
    })),
    relations: [
      { type: 'near', subject: 'duplicate', object: validationBase.objects[2]?.id ?? 'missing' },
      { type: 'near', subject: 'duplicate', object: 'duplicate' },
      { type: 'unsupported', subject: 'duplicate', object: validationBase.objects[2]?.id ?? 'missing' },
      { type: 'leftOf', subject: 'missing', object: 'duplicate' },
    ],
  }
  const validated = validateSceneGraph(duplicateIdRaw)
  pass('validator repairs duplicate entity IDs', !!validated && new Set(validated.objects.map((object) => object.id)).size === validated.objects.length)
  pass('validator keeps valid relation references', validated?.relations.length === 1)
  pass('validator drops self/unknown/missing relations', validated?.relations.every((relation) => relation.subject !== relation.object) === true)
  console.groupEnd()

  console.log(`[D3 RELATIONS] ${failureCount === 0 ? 'ALL PASS' : `${failureCount} FAILURES`}`)
  return failureCount
}
