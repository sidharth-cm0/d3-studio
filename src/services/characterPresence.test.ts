/**
 * Character Presence Resolver — Self-Test.
 *
 * Verifies:
 *   - male only → 'male'
 *   - female only → 'female'
 *   - both → 'both'
 *   - pronoun male → 'male'
 *   - pronoun female → 'female'
 *   - ambiguous/default → 'default'
 *   - visibility mapping correctness
 *   - false-positive prevention (word boundaries)
 *
 * Usage:
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-presence-test \
 *     src/services/characterPresence.ts \
 *     src/services/characterPresence.test.ts
 *   node /tmp/d3-presence-test/characterPresence.test.js
 */

import {
  resolveCharacterPresence,
  presenceToVisibility,
  type CharacterPresence,
} from './characterPresence'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failureCount = 0

function check(label: string, actual: CharacterPresence, expected: CharacterPresence): void {
  const ok = actual === expected
  if (!ok) failureCount++
  console.log(`  ${ok ? '✓' : '✗'} ${label} — got "${actual}", expected "${expected}"`)
}

function checkVisibility(
  label: string,
  presence: CharacterPresence,
  expectedLead: boolean,
  expectedSupport: boolean
): void {
  const v = presenceToVisibility(presence)
  const ok = v.leadVisible === expectedLead && v.supportingVisible === expectedSupport
  if (!ok) failureCount++
  console.log(
    `  ${ok ? '✓' : '✗'} ${label} — lead=${v.leadVisible} (exp ${expectedLead}), support=${v.supportingVisible} (exp ${expectedSupport})`
  )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

export function runCharacterPresenceSelfTest(): number {
  failureCount = 0
  console.log('[D3 CHARACTER PRESENCE] Self-Test')

  // --- male only ---
  check('male only: "A man walks into the room."', resolveCharacterPresence('A man walks into the room.'), 'male')
  check('male only: "A boy sits on a chair."', resolveCharacterPresence('A boy sits on a chair.'), 'male')
  check('male only: "The male character runs."', resolveCharacterPresence('The male character runs.'), 'male')
  check('male only: "A man enters the building."', resolveCharacterPresence('A man enters the building.'), 'male')
  check('male only: "A gentleman approaches."', resolveCharacterPresence('A gentleman approaches.'), 'male')

  // --- female only ---
  check('female only: "A woman walks into the room."', resolveCharacterPresence('A woman walks into the room.'), 'female')
  check('female only: "A girl sits near the table."', resolveCharacterPresence('A girl sits near the table.'), 'female')
  check('female only: "The female character runs."', resolveCharacterPresence('The female character runs.'), 'female')
  check('female only: "A woman enters the building."', resolveCharacterPresence('A woman enters the building.'), 'female')
  check('female only: "A lady approaches."', resolveCharacterPresence('A lady approaches.'), 'female')

  // --- both ---
  check('both: "A man and a woman are talking."', resolveCharacterPresence('A man and a woman are talking.'), 'both')
  check('both: "A boy and a girl walk together."', resolveCharacterPresence('A boy and a girl walk together.'), 'both')
  check('both: "Both characters enter the room."', resolveCharacterPresence('Both characters enter the room.'), 'both')
  check('both: "Two people are standing together."', resolveCharacterPresence('Two people are standing together.'), 'both')
  check('both: "A man and a woman enter."', resolveCharacterPresence('A man and a woman enter.'), 'both')

  // --- pronoun male ---
  check('pronoun male: "He looks at the door."', resolveCharacterPresence('He looks at the door.'), 'male')
  check('pronoun male: "He slowly walks forward."', resolveCharacterPresence('He slowly walks forward.'), 'male')
  check('pronoun male: "He hears a noise behind him."', resolveCharacterPresence('He hears a noise behind him.'), 'male')
  check('pronoun male: "His hand reaches for the handle."', resolveCharacterPresence('His hand reaches for the handle.'), 'male')
  check('pronoun male: "He turns around."', resolveCharacterPresence('He turns around.'), 'male')

  // --- pronoun female ---
  check('pronoun female: "She looks outside."', resolveCharacterPresence('She looks outside.'), 'female')
  check('pronoun female: "She walks toward the window."', resolveCharacterPresence('She walks toward the window.'), 'female')
  check('pronoun female: "Her eyes meet the light."', resolveCharacterPresence('Her eyes meet the light.'), 'female')
  check('pronoun female: "She sees the figure."', resolveCharacterPresence('She sees the figure.'), 'female')

  // --- pronoun both ---
  check('pronoun both: "He talks to her."', resolveCharacterPresence('He talks to her.'), 'both')
  check('pronoun both: "She sees him."', resolveCharacterPresence('She sees him.'), 'both')
  check('pronoun both: "Her eyes meet his."', resolveCharacterPresence('Her eyes meet his.'), 'both')

  // --- ambiguous / default ---
  check('default: "A person walks into the room."', resolveCharacterPresence('A person walks into the room.'), 'default')
  check('default: "The detective enters an abandoned warehouse."', resolveCharacterPresence('The detective enters an abandoned warehouse.'), 'default')
  check('default: "A character stands silently."', resolveCharacterPresence('A character stands silently.'), 'default')
  check('default: empty string', resolveCharacterPresence(''), 'default')
  check('default: whitespace only', resolveCharacterPresence('   '), 'default')
  check('default: "The news anchor presents data."', resolveCharacterPresence('The news anchor presents data.'), 'default')

  // --- visibility mapping ---
  checkVisibility('visibility: male', 'male', true, false)
  checkVisibility('visibility: female', 'female', false, true)
  checkVisibility('visibility: both', 'both', true, true)
  checkVisibility('visibility: default', 'default', true, true)

  // --- false-positive prevention (word boundaries) ---
  check('edge: "the" does not match "he"', resolveCharacterPresence('the theater is empty'), 'default')
  check('edge: "other" does not match "her"', resolveCharacterPresence('the other person'), 'default')
  check('edge: "history" does not match "his"', resolveCharacterPresence('history records'), 'default')
  check('edge: "sheep" does not match "she"', resolveCharacterPresence('the sheep is white'), 'default')
  check('edge: "womanly" does not match "woman"', resolveCharacterPresence('womanly grace'), 'default')
  check('edge: "boycott" does not match "boy"', resolveCharacterPresence('boycott the meeting'), 'default')
  check('edge: "malevolent" does not match "male"', resolveCharacterPresence('malevolent force'), 'default')
  check('edge: "female" in "feminine" does not match', resolveCharacterPresence('feminine energy'), 'default')

  // --- cross-sentence ---
  check('cross-sentence: "A man walks in. He sits down."', resolveCharacterPresence('A man walks in. He sits down.'), 'male')
  check('cross-sentence: "A woman enters. She looks around."', resolveCharacterPresence('A woman enters. She looks around.'), 'female')
  check('cross-sentence: "A man and woman talk. He says hello to her."', resolveCharacterPresence('A man and woman talk. He says hello to her.'), 'both')

  // --- full story prompts ---
  check(
    'full prompt: noir detective (male)',
    resolveCharacterPresence("A detective enters an abandoned warehouse at midnight. He slowly walks forward, looks around suspiciously, hears a noise behind him, turns around and says, 'Who's there?'"),
    'male'
  )
  check(
    'full prompt: news anchor (default)',
    resolveCharacterPresence('A news anchor presents breaking satellite data while the remote correspondent delivers live verification from the field.'),
    'default'
  )
  check(
    'full prompt: cyber infiltration (default)',
    resolveCharacterPresence('A netrunner jacks into a secure corporate core, discovers illegal telemetry data, and warns their operative to disconnect immediately.'),
    'default'
  )

  console.log(`[D3 CHARACTER PRESENCE] ${failureCount === 0 ? 'ALL PASS' : `${failureCount} FAILURES`}`)
  return failureCount
}
