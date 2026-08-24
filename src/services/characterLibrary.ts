/**
 * Module 4 — Generic Character Library + Cast Mapping
 *
 * Characters are first-class identities (id, name, personality, VRM, voice).
 * The live Three.js engine still has exactly two VRM slots (1 and 2).
 * This service:
 *   - holds / merges a character registry
 *   - assigns scene cast to slots without inventing a second engine
 *   - preserves Host/Guest as labels for slot 1 / slot 2
 */

import {
  D3Character,
  D3CharacterCustomization,
  D3Episode,
  D3Scene,
  D3SeriesBible,
  CastSlotAssignment,
  RuntimeActorSlot,
  D3Emotion,
  D3Gesture,
  normalizeCharacter,
} from '../types/d3'

const DEFAULT_CUSTOM: D3CharacterCustomization = {
  skinColor: '#6e473b',
  hairColor: '#140f0c',
  shirtColor: '#2563eb',
  hairStyle: 'short',
  jawScale: 1.08,
  shoulderWidth: 1.12,
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Built-in archetypes the director can seed from */
export const ARCHETYPE_PRESETS: Record<string, Partial<D3Character>> = {
  detective: {
    name: 'Detective',
    role: 'lead',
    description: 'Lead investigator — cautious, observant, dry wit.',
    personality: 'Methodical and suspicious under pressure.',
    appearance: 'Coat, tired eyes, controlled posture.',
    animationProfile: {
      idleIntensity: 0.9,
      gestureBias: ['look_around', 'turn_head', 'nod'],
      defaultEmotion: 'suspicious' as D3Emotion,
    },
    preferredSlot: 1,
  },
  netrunner: {
    name: 'Netrunner',
    role: 'lead',
    description: 'Cyber operative jacked into the grid.',
    personality: 'Fast, paranoid, technical.',
    animationProfile: {
      idleIntensity: 1.1,
      gestureBias: ['point', 'look_around'],
      defaultEmotion: 'focused' as D3Emotion,
    },
    preferredSlot: 1,
  },
  anchor: {
    name: 'News Anchor',
    role: 'lead',
    description: 'On-air presenter under studio lights.',
    personality: 'Composed, clear, authoritative.',
    animationProfile: {
      idleIntensity: 0.7,
      gestureBias: ['nod', 'wave'],
      defaultEmotion: 'neutral' as D3Emotion,
    },
    preferredSlot: 1,
  },
  figure: {
    name: 'Unknown Figure',
    role: 'supporting',
    description: 'Mysterious second presence in the scene.',
    personality: 'Opaque; reacts more than leads.',
    animationProfile: {
      idleIntensity: 0.8,
      gestureBias: ['turn_head', 'look_around'],
      defaultEmotion: 'neutral' as D3Emotion,
    },
    preferredSlot: 2,
  },
  partner: {
    name: 'Partner',
    role: 'supporting',
    description: 'Supporting ally or foil.',
    preferredSlot: 2,
  },
  host: {
    name: 'Host',
    role: 'host',
    description: 'Legacy host slot character.',
    preferredSlot: 1,
  },
  guest: {
    name: 'Guest',
    role: 'guest',
    description: 'Legacy guest slot character.',
    preferredSlot: 2,
  },
}

export class CharacterLibraryService {
  private static registry: Map<string, D3Character> = new Map()

  static reset(): void {
    this.registry.clear()
  }

  static upsert(character: D3Character): D3Character {
    this.registry.set(character.id, character)
    return character
  }

  static get(id: string): D3Character | undefined {
    return this.registry.get(id)
  }

  static list(): D3Character[] {
    return Array.from(this.registry.values())
  }

  static createCharacter(partial: Partial<D3Character> & { name: string }): D3Character {
    const id = partial.id || uid('char')
    const slot = partial.preferredSlot ?? (partial.role === 'guest' || partial.role === 'supporting' ? 2 : 1)
    const character = normalizeCharacter({
      ...partial,
      id,
      name: partial.name,
      continuityKey: partial.continuityKey || id,
      tags: partial.tags || [],
      role: partial.role ?? (slot === 1 ? 'lead' : 'supporting'),
      description: partial.description ?? partial.name,
      vrmAssetUrl: partial.vrmAssetUrl ?? '/avatar.vrm',
      customization: partial.customization ?? { ...DEFAULT_CUSTOM },
      voiceProfile: partial.voiceProfile ?? {
        pitch: slot === 1 ? 0.95 : 1.08,
        rate: 0.98,
        preferredVoiceName: slot === 1 ? 'Guy' : 'Samantha',
      },
      animationProfile: partial.animationProfile ?? {
        idleIntensity: 1,
        gestureBias: ['look_around', 'nod'] as D3Gesture[],
        defaultEmotion: 'neutral',
      },
      preferredSlot: slot,
    })
    this.upsert(character)
    return character
  }

  static fromArchetype(key: string, overrides?: Partial<D3Character>): D3Character {
    const preset = ARCHETYPE_PRESETS[key.toLowerCase()] || ARCHETYPE_PRESETS.figure
    return this.createCharacter({
      ...preset,
      name: overrides?.name || preset.name || key,
      ...overrides,
    })
  }

  /**
   * Seed / merge Series Bible characters into the registry.
   */
  static syncFromBible(bible: D3SeriesBible): D3Character[] {
    const out: D3Character[] = []
    for (const c of bible.characters) {
      const existing = this.registry.get(c.id)
      if (existing) {
        const merged = { ...existing, ...c, id: c.id }
        this.upsert(merged)
        out.push(merged)
      } else {
        out.push(this.upsert(c))
      }
    }
    return out
  }

  /**
   * Assign up to two characters from a scene cast onto runtime slots.
   * Prefer preferredSlot; fall back to order (first → slot 1, second → slot 2).
   */
  static assignCastToSlots(
    castIds: string[],
    fallbackCharacters?: D3Character[]
  ): CastSlotAssignment[] {
    const resolved: D3Character[] = []
    for (const id of castIds) {
      const c = this.registry.get(id) || fallbackCharacters?.find((x) => x.id === id)
      if (c) resolved.push(c)
    }

    // If empty, ensure two default slots
    if (resolved.length === 0) {
      const lead = this.createCharacter({
        id: 'char_host',
        name: 'Lead',
        role: 'lead',
        preferredSlot: 1,
      })
      const support = this.createCharacter({
        id: 'char_guest_1',
        name: 'Supporting',
        role: 'supporting',
        preferredSlot: 2,
      })
      resolved.push(lead, support)
    }

    const usedSlots = new Set<RuntimeActorSlot>()
    const assignments: CastSlotAssignment[] = []

    // First pass: honor preferredSlot when free
    for (const c of resolved) {
      if (assignments.length >= 2) break
      const want = c.preferredSlot ?? (c.role === 'guest' || c.role === 'supporting' ? 2 : 1)
      if (!usedSlots.has(want)) {
        usedSlots.add(want)
        assignments.push({
          characterId: c.id,
          slot: want,
          displayName: c.name,
        })
      }
    }

    // Second pass: fill remaining slots in order
    for (const c of resolved) {
      if (assignments.length >= 2) break
      if (assignments.some((a) => a.characterId === c.id)) continue
      const free: RuntimeActorSlot = usedSlots.has(1) ? 2 : 1
      usedSlots.add(free)
      assignments.push({
        characterId: c.id,
        slot: free,
        displayName: c.name,
      })
    }

    // Always expose both slots for the dual-engine (pad if needed)
    if (!assignments.some((a) => a.slot === 1)) {
      const pad = this.createCharacter({ id: 'char_host', name: 'Lead', role: 'lead', preferredSlot: 1 })
      assignments.push({ characterId: pad.id, slot: 1, displayName: pad.name })
    }
    if (!assignments.some((a) => a.slot === 2)) {
      const pad = this.createCharacter({
        id: 'char_guest_1',
        name: 'Supporting',
        role: 'supporting',
        preferredSlot: 2,
      })
      assignments.push({ characterId: pad.id, slot: 2, displayName: pad.name })
    }

    return assignments.sort((a, b) => a.slot - b.slot)
  }

  /**
   * Attach castSlots + characters onto an episode for the runtime / UI.
   */
  static bindEpisodeCast(episode: D3Episode, bible?: D3SeriesBible): D3Episode {
    if (bible) this.syncFromBible(bible)

    const scene: D3Scene | undefined = episode.scenes[0]
    const castIds =
      scene?.castIds?.length
        ? scene.castIds
        : (episode.characters || bible?.characters || []).map((c) => c.id)

    const chars =
      episode.characters ||
      bible?.characters ||
      castIds.map((id) => this.get(id)).filter(Boolean) as D3Character[]

    const castSlots = this.assignCastToSlots(castIds, chars)

    return {
      ...episode,
      characters: chars.length ? chars : this.list().slice(0, 2),
      castSlots,
    }
  }

  /** Resolve characterId → runtime slot (1|2). Defaults to 1. */
  static slotForCharacterId(characterId: string, castSlots?: CastSlotAssignment[]): RuntimeActorSlot {
    const hit = castSlots?.find((c) => c.characterId === characterId)
    if (hit) return hit.slot
    if (characterId.includes('guest') || characterId.includes('_2') || characterId.endsWith('2')) {
      return 2
    }
    return 1
  }

  static displayNameForSlot(slot: RuntimeActorSlot, castSlots?: CastSlotAssignment[]): string {
    return castSlots?.find((c) => c.slot === slot)?.displayName ?? (slot === 1 ? 'Lead' : 'Supporting')
  }

  /** Legacy Host/Guest role string for scene export compatibility */
  static roleForSlot(slot: RuntimeActorSlot): 'host' | 'guest' {
    return slot === 1 ? 'host' : 'guest'
  }
}
