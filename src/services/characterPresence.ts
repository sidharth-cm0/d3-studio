/**
 * Character Presence Resolver — Phase 3
 *
 * Determines which VRM character(s) should be visible based on the story/script
 * text. Returns 'male' | 'female' | 'both' | 'default'.
 *
 * Parsing rules (reusable language patterns, not prompt-specific):
 *   1. If both male AND female gendered terms are present → 'both'
 *   2. If only male gendered terms → 'male'
 *   3. If only female gendered terms → 'female'
 *   4. If no gendered terms but explicit "both"/"two people" → 'both'
 *   5. Otherwise → 'default' (preserve existing behavior)
 *
 * Male terms:   man, men, male, boy, boys, he, him, his, himself, guy, guys, gentleman, gentlemen
 * Female terms: woman, women, female, females, girl, girls, she, her, hers, herself, lady, ladies
 * Both terms:   both, two people
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CharacterPresence = 'male' | 'female' | 'both' | 'default'

// ---------------------------------------------------------------------------
// Term tables (reusable language patterns)
// ---------------------------------------------------------------------------

/** Male gendered terms — word-boundary matched, case-insensitive. */
const MALE_TERMS: string[] = [
  'man', 'men', 'male', 'boy', 'boys',
  'he', 'him', 'his', 'himself',
  'guy', 'guys', 'gentleman', 'gentlemen',
]

/** Female gendered terms — word-boundary matched, case-insensitive. */
const FEMALE_TERMS: string[] = [
  'woman', 'women', 'female', 'females', 'girl', 'girls',
  'she', 'her', 'hers', 'herself',
  'lady', 'ladies',
]

/** Explicit "both" signals that don't require gendered terms. */
const BOTH_TERMS: string[] = [
  'both',
  'two people',
]

// ---------------------------------------------------------------------------
// Regex builder
// ---------------------------------------------------------------------------

/**
 * Build a case-insensitive word-boundary regex for a list of terms.
 * Handles multi-word terms (e.g. "two people") by joining with |.
 * Each term is regex-escaped to prevent injection from term content.
 */
function buildTermRegex(terms: string[]): RegExp {
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i')
}

const MALE_REGEX = buildTermRegex(MALE_TERMS)
const FEMALE_REGEX = buildTermRegex(FEMALE_TERMS)
const BOTH_REGEX = buildTermRegex(BOTH_TERMS)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve which character(s) should be visible based on story/script text.
 *
 * @param text - The story prompt or script text
 * @returns 'male' | 'female' | 'both' | 'default'
 */
export function resolveCharacterPresence(text: string): CharacterPresence {
  if (!text || text.trim().length === 0) return 'default'

  const lower = text.toLowerCase()

  const hasMale = MALE_REGEX.test(lower)
  const hasFemale = FEMALE_REGEX.test(lower)

  // Rule 1: both male and female terms present → both characters
  if (hasMale && hasFemale) return 'both'

  // Rule 2: only male terms → male only
  if (hasMale) return 'male'

  // Rule 3: only female terms → female only
  if (hasFemale) return 'female'

  // Rule 4: no gendered terms, but explicit "both" signal → both
  if (BOTH_REGEX.test(lower)) return 'both'

  // Rule 5: ambiguous or not mentioned → default (preserve existing behavior)
  return 'default'
}

/**
 * Map a CharacterPresence result to visibility flags for the two VRM slots.
 *
 * Slot 1 = lead/male character, Slot 2 = supporting/female character.
 *
 * - 'male'    → lead visible, supporting hidden
 * - 'female'  → lead hidden, supporting visible
 * - 'both'    → both visible
 * - 'default' → both visible (preserve existing behavior)
 */
export function presenceToVisibility(presence: CharacterPresence): {
  leadVisible: boolean
  supportingVisible: boolean
} {
  switch (presence) {
    case 'male':
      return { leadVisible: true, supportingVisible: false }
    case 'female':
      return { leadVisible: false, supportingVisible: true }
    case 'both':
    case 'default':
      return { leadVisible: true, supportingVisible: true }
  }
}
