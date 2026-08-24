import {
    D3Character,
    D3CharacterCustomization,
    D3VoiceProfile,
    D3AnimationProfile,
    RuntimeActorSlot,
    normalizeCharacter,
} from './types/d3';

const DEFAULT_CUSTOMIZATION: D3CharacterCustomization = {
    skinColor: '#6e473b',
    hairColor: '#140f0c',
    shirtColor: '#2563eb',
    hairStyle: 'short',
    jawScale: 1.08,
    shoulderWidth: 1.12,
}

const DEFAULT_VOICE_PROFILE: D3VoiceProfile = {
    pitch: 1,
    rate: 0.98,
}

const DEFAULT_ANIMATION_PROFILE: D3AnimationProfile = {
    idleIntensity: 1,
    gestureBias: [],
    defaultEmotion: 'neutral',
}

function uid(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
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
        const character: D3Character = normalizeCharacter({
            id,
            name: partial.name,
            continuityKey: partial.continuityKey || id,
            tags: partial.tags || [],
            role: partial.role || 'lead',
            description: partial.description || partial.name,
            vrmAssetUrl: partial.vrmAssetUrl || '/avatar.vrm',
            customization: {
                ...DEFAULT_CUSTOMIZATION,
                ...(partial.customization || {}),
            },
            voiceProfile: {
                ...DEFAULT_VOICE_PROFILE,
                ...(partial.voiceProfile || {}),
            },
            animationProfile: {
                ...DEFAULT_ANIMATION_PROFILE,
                ...(partial.animationProfile || {}),
            },
            preferredSlot: partial.preferredSlot || undefined,
        })
        this.upsert(character)
        return character
    }

    static fromArchetype(key: string, overrides?: Partial<D3Character>): D3Character {
        const archetype: Partial<D3Character> = {
            id: uid('archetype'),
            name: key,
            role: 'supporting',
            description: 'Generated archetype character.',
            vrmAssetUrl: '/avatar.vrm',
            customization: {
                ...DEFAULT_CUSTOMIZATION,
                ...(overrides?.customization || {}),
            },
            voiceProfile: {
                ...DEFAULT_VOICE_PROFILE,
                ...(overrides?.voiceProfile || {}),
            },
            animationProfile: {
                ...DEFAULT_ANIMATION_PROFILE,
                ...(overrides?.animationProfile || {}),
            },
            tags: overrides?.tags || [],
            continuityKey: overrides?.continuityKey || uid('continuity'),
            preferredSlot: overrides?.preferredSlot || undefined,
        }
        return this.createCharacter(archetype as D3Character)
    }
}
