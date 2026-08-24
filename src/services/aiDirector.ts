/**
 * AI Director Service — Module 2 + Module 3
 *
 * Structured story pipeline:
 *   Story text
 *     → analyzeStory()
 *     → createSeriesBible()
 *     → createEpisodePlan()  (scenes + shots)
 *     → compileEpisodeToTimeline()
 *     → existing Three.js playback / scene export
 *
 * Also supports legacy Host:/Guest: scripts via parseLegacyScriptToEpisode().
 *
 * This is a deterministic, rule-enriched director (not an LLM call yet).
 * Architecture is provider-ready: every method returns validated structured data
 * that the scene engine already understands.
 */

import {
  D3SeriesBible,
  D3Episode,
  D3Scene,
  D3Shot,
  D3Character,
  D3Location,
  D3Emotion,
  D3Gesture,
  D3CameraShotKey,
  D3StagePresetId,
  D3TimelineCompilation,
  StoryBeatAnalysis,
  StoryAnalysisResult,
  D3Performance,
  D3DialogueLine,
  D3CameraDirective,
  D3ActionDirective,
  D3AudioDirective,
  validateD3Episode,
  validateStoryAnalysis,
  normalizeCharacter,
} from '../types/d3'
import {
  SceneCameraKeyframe,
  SceneDialogueEvent,
  SceneEmoteEvent,
} from '../lib/sceneExport'
import type { CameraShotConfig } from '../App'
import { CharacterLibraryService } from './characterLibrary'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  // ~2.4 words/sec with a small pause buffer
  return Math.max(1.4, words / 2.4 + 0.35)
}

function clampDuration(sec: number, min = 1.2, max = 12): number {
  return Math.min(max, Math.max(min, sec))
}

const DEFAULT_CUSTOMIZATION = {
  skinColor: '#6e473b',
  hairColor: '#140f0c',
  shirtColor: '#2563eb',
  hairStyle: 'short' as const,
  jawScale: 1.08,
  shoulderWidth: 1.12,
}

const HOST_VOICE = { pitch: 0.95, rate: 0.98, preferredVoiceName: 'Guy' }
const GUEST_VOICE = { pitch: 1.08, rate: 0.98, preferredVoiceName: 'Samantha' }

// ---------------------------------------------------------------------------
// Keyword / rule tables (deterministic director)
// ---------------------------------------------------------------------------

const EMOTION_RULES: Array<{ keys: string[]; emotion: D3Emotion }> = [
  { keys: ['suspicious', 'wary', 'cautious', 'nervous', 'looks around'], emotion: 'suspicious' },
  { keys: ['angry', 'furious', 'rage', 'shouts'], emotion: 'angry' },
  { keys: ['sad', 'cry', 'tears', 'grief'], emotion: 'sad' },
  { keys: ['surprised', 'shock', 'gasps', 'suddenly'], emotion: 'surprised' },
  { keys: ['happy', 'smile', 'laugh', 'grin'], emotion: 'happy' },
  { keys: ['focused', 'concentrat', 'studies', 'examines'], emotion: 'focused' },
]

const GESTURE_RULES: Array<{ keys: string[]; gesture: D3Gesture }> = [
  { keys: ['wave', 'waves', 'greeting'], gesture: 'wave' },
  { keys: ['bow', 'bows'], gesture: 'bow' },
  { keys: ['thumbs', 'thumb up'], gesture: 'thumbs' },
  { keys: ['look around', 'looks around', 'scans', 'searching'], gesture: 'look_around' },
  { keys: ['turn', 'turns', 'turns toward', 'turns to'], gesture: 'turn_head' },
  { keys: ['point', 'points'], gesture: 'point' },
  { keys: ['shrug', 'shrugs'], gesture: 'shrug' },
  { keys: ['nod', 'nods'], gesture: 'nod' },
]

const LOCATION_RULES: Array<{ keys: string[]; name: string; stage: D3StagePresetId }> = [
  { keys: ['warehouse', 'abandoned', 'shadow', 'midnight', 'alley'], name: 'Abandoned Warehouse', stage: 'cyberpunk' },
  { keys: ['subway', 'station', 'platform', 'tunnel'], name: 'Abandoned Subway Platform', stage: 'minimal' },
  { keys: ['news', 'studio', 'broadcast', 'anchor', 'satellite'], name: 'Broadcast Newsroom', stage: 'broadcast' },
  { keys: ['corporate', 'core', 'server', 'netrunner', 'cyber'], name: 'Corporate Data Core', stage: 'cyberpunk' },
  { keys: ['office', 'desk'], name: 'Office Interior', stage: 'minimal' },
]

const CHARACTER_RULES: Array<{ keys: string[]; name: string; role: 'host' | 'guest'; description: string }> = [
  { keys: ['detective', 'investigator', 'inspector'], name: 'Detective', role: 'host', description: 'Lead investigator, cautious and observant.' },
  { keys: ['netrunner', 'hacker', 'operative'], name: 'Netrunner', role: 'host', description: 'Cyber operative jacked into the grid.' },
  { keys: ['anchor', 'reporter', 'correspondent'], name: 'News Anchor', role: 'host', description: 'On-air news presenter.' },
  { keys: ['guest', 'stranger', 'figure', 'shadow', 'suspect'], name: 'Unknown Figure', role: 'guest', description: 'Mysterious second presence.' },
  { keys: ['partner', 'assistant'], name: 'Partner', role: 'guest', description: 'Supporting character.' },
]

function inferEmotion(text: string): D3Emotion {
  const lower = text.toLowerCase()
  for (const rule of EMOTION_RULES) {
    if (rule.keys.some((k) => lower.includes(k))) return rule.emotion
  }
  return 'neutral'
}

function inferGesture(text: string): D3Gesture {
  const lower = text.toLowerCase()
  for (const rule of GESTURE_RULES) {
    if (rule.keys.some((k) => lower.includes(k))) return rule.gesture
  }
  // Default cinematic gestures for action beats without dialogue
  if (/\b(enter|walk|approach|discover|find|hear|turn)\b/i.test(text)) {
    return 'look_around'
  }
  return 'none'
}

function inferCamera(beat: StoryBeatAnalysis, index: number, total: number): D3CameraShotKey {
  if (beat.cameraShot) return beat.cameraShot
  const text = `${beat.beat} ${beat.action || ''} ${beat.dialogue || ''}`.toLowerCase()

  if (index === 0) return 'two_shot_wide'
  if (total > 1 && index === total - 1) return 'close_up'
  if (text.includes('shadow') || text.includes('mysterious') || text.includes('reveal')) return 'dutch_angle'
  if (text.includes('turn') || text.includes('toward') || text.includes('look')) return 'over_shoulder'
  if (text.includes('hero') || text.includes('stand') || text.includes('power')) return 'low_angle'
  if (beat.speaker === 'guest' || beat.speaker === 'actor2') return 'actor2_close'
  if (beat.dialogue) return 'close_up'
  if (beat.action) return 'low_angle'
  return index % 2 === 0 ? 'close_up' : 'over_shoulder'
}

function detectGenre(lower: string): string {
  if (/(detective|warehouse|shadow|midnight|noir|mystery|disappear)/.test(lower)) {
    return 'Film Noir / Mystery'
  }
  if (/(cyber|netrunner|hack|ai|corporate|telemetry)/.test(lower)) {
    return 'Cyberpunk Sci-Fi'
  }
  if (/(news|report|satellite|anchor|broadcast)/.test(lower)) {
    return 'Broadcast News'
  }
  return 'Cinematic Drama'
}

function detectCharacters(lower: string, raw: string): string[] {
  const found: string[] = []
  for (const rule of CHARACTER_RULES) {
    if (rule.keys.some((k) => lower.includes(k))) {
      if (!found.includes(rule.name)) found.push(rule.name)
    }
  }
  // Host/Guest explicit labels
  if (/\bhost\s*:/i.test(raw) && !found.includes('Host')) found.push('Host')
  if (/\bguest\s*:/i.test(raw) && !found.includes('Guest')) found.push('Guest')
  if (found.length === 0) found.push('Lead', 'Supporting')
  return found.slice(0, 4)
}

function detectLocations(lower: string): string[] {
  const found: string[] = []
  for (const rule of LOCATION_RULES) {
    if (rule.keys.some((k) => lower.includes(k))) {
      if (!found.includes(rule.name)) found.push(rule.name)
    }
  }
  if (found.length === 0) found.push('Studio Stage')
  return found
}

function splitIntoBeats(raw: string): string[] {
  // Prefer sentence boundaries; also split on "; " and long "and" clauses
  let parts = raw
    .split(/(?<=[.?!])\s+|:\s+|\s+—\s+|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (parts.length <= 1 && raw.length > 60) {
    parts = raw
      .split(/,\s+(?=[a-z])/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 10)
  }

  // Further split very long clauses on " and " when useful
  const expanded: string[] = []
  for (const part of parts) {
    if (part.length > 100 && /\sand\s/i.test(part)) {
      const sub = part.split(/\s+and\s+/i).map((s) => s.trim()).filter((s) => s.length > 10)
      if (sub.length > 1) {
        expanded.push(...sub)
        continue
      }
    }
    expanded.push(part)
  }
  return expanded.length > 0 ? expanded : [raw]
}

function speakerFromBeat(text: string, characters: string[]): string | undefined {
  const lower = text.toLowerCase()
  if (/^(host|detective|netrunner|anchor)\b/.test(lower) || lower.includes('he ') || lower.includes('she ')) {
    return characters[0] || 'Lead'
  }
  if (/^(guest|figure|stranger|partner)\b/.test(lower)) {
    return characters[1] || characters[0] || 'Supporting'
  }
  // Quoted dialogue often belongs to the lead in short prompts
  if (/"[^"]+"/.test(text) || /'[^']+'/.test(text)) {
    return characters[0] || 'Lead'
  }
  return undefined
}

function extractDialogue(text: string): string | undefined {
  const q = text.match(/"([^"]+)"/) || text.match(/'([^']+)'/)
  if (q) return q[1]
  // Legacy "Host: line"
  const legacy = text.match(/^(?:Host|Guest|Actor\s*[12])\s*:\s*(.+)$/i)
  if (legacy) return legacy[1].trim()
  return undefined
}

function extractAction(text: string, dialogue?: string): string | undefined {
  if (dialogue) {
    const without = text.replace(`"${dialogue}"`, '').replace(`'${dialogue}'`, '').trim()
    return without.length > 8 ? without : undefined
  }
  // Pure action sentence
  if (/\b(enter|walk|look|turn|hear|discover|find|approach|raise|point)\b/i.test(text)) {
    return text
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class AIDirectorService {
  /**
   * Analyze natural-language story into structured beats and metadata.
   */
  static analyzeStory(storyPrompt: string): StoryAnalysisResult {
    const raw = storyPrompt.trim()
    const lower = raw.toLowerCase()

    const genre = detectGenre(lower)
    const characters = detectCharacters(lower, raw)
    const keyLocations = detectLocations(lower)
    const sentences = splitIntoBeats(raw)

    const beats: StoryBeatAnalysis[] = sentences.map((sentence, idx) => {
      const dialogue = extractDialogue(sentence)
      const action = extractAction(sentence, dialogue)
      const speaker = speakerFromBeat(sentence, characters)
      const emotion = inferEmotion(sentence)
      const gesture = inferGesture(sentence)
      const cameraShot = inferCamera(
        { beat: sentence, speaker, dialogue, action, emotion, gesture },
        idx,
        sentences.length
      )

      // Stage hint from location keywords inside this beat
      let stageId: D3StagePresetId | undefined
      for (const rule of LOCATION_RULES) {
        if (rule.keys.some((k) => sentence.toLowerCase().includes(k))) {
          stageId = rule.stage
          break
        }
      }

      return {
        beat: sentence,
        speaker,
        dialogue,
        action,
        emotion,
        gesture,
        cameraShot,
        stageId,
      }
    })

    const result: StoryAnalysisResult = {
      genre,
      premise: raw.length > 160 ? `${raw.slice(0, 157)}...` : raw,
      characters,
      keyLocations,
      beats,
    }

    const errors = validateStoryAnalysis(result)
    if (errors.length > 0) {
      console.warn('[AIDirector] Story analysis validation:', errors)
    }
    return result
  }

  /**
   * Build a lightweight Series Bible from analysis (persistent characters + locations).
   */
  static createSeriesBible(
    analysis: StoryAnalysisResult,
    preferredStage: D3StagePresetId = 'cyberpunk'
  ): D3SeriesBible {
    const characters: D3Character[] = analysis.characters.map((name, i) => {
      const rule = CHARACTER_RULES.find((r) => r.name === name)
      const role: 'host' | 'guest' = i === 0 ? 'host' : 'guest'
      const id = i === 0 ? 'char_host' : `char_guest_${i}`
      return normalizeCharacter({
        id,
        name,
        continuityKey: id,
        tags: [name.toLowerCase().replace(/\s+/g, '_'), role],
        role: rule?.role ?? role,
        description: rule?.description ?? `${name} in the story.`,
        vrmAssetUrl: '/avatar.vrm',
        customization: { ...DEFAULT_CUSTOMIZATION },
        voiceProfile: i === 0 ? { ...HOST_VOICE } : { ...GUEST_VOICE },
        preferredSlot: i === 0 ? 1 : 2,
      })
    })

    // Ensure at least two slots for the current dual-actor engine
    while (characters.length < 2) {
      const idx = characters.length
      const id = idx === 0 ? 'char_host' : 'char_guest_1'
      const name = idx === 0 ? 'Lead' : 'Supporting'
      characters.push(
        normalizeCharacter({
          id,
          name,
          continuityKey: id,
          tags: [name.toLowerCase()],
          role: idx === 0 ? 'host' : 'guest',
          description: idx === 0 ? 'Primary character' : 'Secondary character',
          vrmAssetUrl: '/avatar.vrm',
          customization: { ...DEFAULT_CUSTOMIZATION },
          voiceProfile: idx === 0 ? { ...HOST_VOICE } : { ...GUEST_VOICE },
          preferredSlot: idx === 0 ? 1 : 2,
        })
      )
    }

    const locations: D3Location[] = analysis.keyLocations.map((name, i) => {
      const rule = LOCATION_RULES.find((r) => r.name === name)
      const stage = rule?.stage ?? preferredStage
      return {
        id: `loc_${i + 1}`,
        name,
        description: name,
        presetStageId: stage,
        lightingPreset: {
          keyColor: stage === 'broadcast' ? '#ffffff' : '#fff7ed',
          rimColor: stage === 'cyberpunk' ? '#f43f5e' : stage === 'broadcast' ? '#6366f1' : '#818cf8',
          ambientIntensity: 1.4,
        },
      }
    })

    if (locations.length === 0) {
      locations.push({
        id: 'loc_1',
        name: 'Studio Stage',
        presetStageId: preferredStage,
        lightingPreset: {
          keyColor: '#fff7ed',
          rimColor: '#818cf8',
          ambientIntensity: 1.4,
        },
      })
    }

    return {
      stableId: uid('bible'),
      version: '1.0.0',
      logline: analysis.premise,
      visualStyle: preferredStage === 'cyberpunk' ? 'cyberpunk' : preferredStage === 'broadcast' ? 'broadcast' : 'minimal',
      characters,
      locations,
      toneRules: [
        `Genre: ${analysis.genre}`,
        'Prefer motivated camera cuts over random coverage.',
        'Preserve character continuity across scenes.',
      ],
    }
  }

  /**
   * Full story → episode plan (scenes + shots with camera, dialogue, performance, actions).
   */
  static createEpisodePlan(
    storyPrompt: string,
    stageKey: D3StagePresetId = 'cyberpunk'
  ): D3Episode {
    const analysis = this.analyzeStory(storyPrompt)
    const bible = this.createSeriesBible(analysis, stageKey)
    const hostId = bible.characters[0]?.id ?? 'char_host'
    const guestId = bible.characters[1]?.id ?? 'char_guest_1'
    const locationId = bible.locations[0]?.id ?? 'loc_1'

    const shots: D3Shot[] = analysis.beats.map((beat, idx) => {
      const speakerIsGuest =
        beat.speaker === bible.characters[1]?.name ||
        beat.speaker === 'Guest' ||
        beat.speaker === 'guest' ||
        beat.speaker === 'actor2'

      const speakerId = speakerIsGuest ? guestId : hostId
      const actorSlot = speakerIsGuest ? '2' : '1'

      const dialogueText =
        beat.dialogue ||
        (beat.action && !beat.dialogue
          ? undefined
          : beat.beat.length < 120 && !beat.action
            ? beat.beat
            : undefined)

      // Generate a short spoken line when the beat is pure action (keeps TTS useful)
      const spoken: string | undefined =
        dialogueText ||
        (beat.action
          ? this.narrateAction(beat.action, beat.emotion)
          : beat.beat)

      const speechDur = spoken ? estimateSpeechSeconds(spoken) : 2.0
      const gesture = beat.gesture && beat.gesture !== 'none' ? beat.gesture : inferGesture(beat.beat)
      const emotion = beat.emotion || inferEmotion(beat.beat)
      const shotKey = inferCamera(beat, idx, analysis.beats.length)

      const duration = clampDuration(
        speechDur + (gesture !== 'none' ? 0.6 : 0.25) + 0.4
      )

      const camera: D3CameraDirective = {
        shotKey,
        anchor:
          shotKey === 'actor2_close'
            ? 'actor2_head'
            : shotKey === 'two_shot_wide'
              ? 'stage_center'
              : shotKey === 'low_angle' || shotKey === 'over_shoulder'
                ? 'actor1_chest'
                : 'actor1_head',
        transitionDurationMs: idx === 0 ? 900 : 1400,
        rollZ: shotKey === 'dutch_angle' ? 0.18 : undefined,
      }

      const dialogue: D3DialogueLine | undefined = spoken
        ? {
            speakerId,
            text: spoken,
            estimatedDuration: speechDur,
          }
        : undefined

      const actions: D3ActionDirective[] = []
      if (beat.action) {
        actions.push({
          actorId: speakerId,
          type: 'physical',
          description: beat.action,
          duration: Math.min(3, duration * 0.7),
        })
      }

      const performances: Record<string, D3Performance> = {
        [speakerId]: {
          source: 'AI',
          emotion,
          gesture: gesture === 'none' ? undefined : gesture,
        },
      }

      // Second character gets a subtle reactive performance on wider shots
      if (shotKey === 'two_shot_wide' || shotKey === 'over_shoulder') {
        const otherId = speakerId === hostId ? guestId : hostId
        performances[otherId] = {
          source: 'AI',
          emotion: 'neutral',
          gesture: undefined,
        }
      }

      const audio: D3AudioDirective | undefined =
        /noise|sound|hear|footstep|creak|thunder/i.test(beat.beat)
          ? {
              soundEffects: [{ time: 0.2, effectName: 'subtle_ambience_hit' }],
            }
          : undefined

      return {
        id: uid(`shot_${idx + 1}`),
        shotNumber: idx + 1,
        narrativeBeat: beat.beat,
        camera,
        duration,
        dialogue,
        actions: actions.length ? actions : undefined,
        performances,
        audio,
      }
    })

    // Guarantee at least one shot
    if (shots.length === 0) {
      shots.push({
        id: uid('shot_1'),
        shotNumber: 1,
        narrativeBeat: storyPrompt,
        camera: {
          shotKey: 'two_shot_wide',
          anchor: 'stage_center',
          transitionDurationMs: 1000,
        },
        duration: 4,
        dialogue: {
          speakerId: hostId,
          text: storyPrompt.slice(0, 120),
          estimatedDuration: 3,
        },
        performances: {
          [hostId]: { source: 'AI', emotion: 'neutral', gesture: 'look_around' },
        },
      })
    }

    // Group shots into multiple scenes (by location shift, emotion shift, or chunk size)
    const scenes: D3Scene[] = []
    const maxShotsPerScene = 4
    let sceneShots: D3Shot[] = []
    let sceneStartIdx = 0

    const flushScene = (titleHint?: string) => {
      if (sceneShots.length === 0) return
      const sn = scenes.length + 1
      const locIdx = Math.min(sn - 1, bible.locations.length - 1)
      const loc = bible.locations[Math.max(0, locIdx)]
      const renumbered = sceneShots.map((sh, i) => ({ ...sh, shotNumber: i + 1 }))
      scenes.push({
        id: uid(`scene_${sn}`),
        sceneNumber: sn,
        title: titleHint || loc?.name || `Scene ${sn}`,
        locationId: loc?.id || locationId,
        castIds: bible.characters.map((c) => c.id),
        narrativeGoal:
          analysis.beats[sceneStartIdx]?.beat?.slice(0, 80) || analysis.premise,
        emotionalTone:
          analysis.beats[sceneStartIdx]?.emotion || analysis.genre,
        shots: renumbered,
      })
      sceneShots = []
      sceneStartIdx = sceneStartIdx + renumbered.length
    }

    for (let i = 0; i < shots.length; i++) {
      const beat = analysis.beats[i]
      const prevBeat = analysis.beats[i - 1]
      const locationShift =
        i > 0 &&
        beat?.stageId &&
        prevBeat?.stageId &&
        beat.stageId !== prevBeat.stageId
      const emotionShift =
        i > 0 &&
        beat?.emotion &&
        prevBeat?.emotion &&
        beat.emotion !== prevBeat.emotion &&
        sceneShots.length >= 2

      if (sceneShots.length >= maxShotsPerScene || locationShift || emotionShift) {
        flushScene(prevBeat?.stageId ? undefined : analysis.keyLocations[scenes.length])
      }
      sceneShots.push(shots[i])
    }
    flushScene(analysis.keyLocations[scenes.length] || analysis.keyLocations[0])

    if (scenes.length === 0) {
      scenes.push({
        id: uid('scene_1'),
        sceneNumber: 1,
        title: analysis.keyLocations[0] || 'Opening Scene',
        locationId,
        castIds: bible.characters.map((c) => c.id),
        narrativeGoal: analysis.premise,
        emotionalTone: analysis.genre,
        shots,
      })
    }

    const totalDuration = scenes.reduce(
      (sum, sc) => sum + sc.shots.reduce((s, sh) => s + sh.duration, 0),
      0
    )

    const episode: D3Episode = {
      id: uid('ep'),
      seriesId: uid('series'),
      episodeNumber: 1,
      title: this.titleFromGenre(analysis.genre, analysis.characters[0]),
      synopsis: analysis.premise,
      estimatedDuration: totalDuration,
      scenes,
      characters: bible.characters,
      narrativeGoals: [analysis.premise],
    }

    const errors = validateD3Episode(episode)
    if (errors.length > 0) {
      console.warn('[AIDirector] Episode validation:', errors)
    }

    CharacterLibraryService.syncFromBible(bible)
    return CharacterLibraryService.bindEpisodeCast(episode, bible)
  }

  /**
   * Legacy Host:/Guest: script → D3Episode (backward compatible).
   */
  static parseLegacyScriptToEpisode(
    script: string,
    stageKey: D3StagePresetId = 'cyberpunk'
  ): D3Episode {
    const lines = script
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)

    const beats: StoryBeatAnalysis[] = []
    for (const line of lines) {
      const m = line.match(/^(Host|Guest|Actor\s*1|Actor\s*2)\s*:\s*(.+)$/i)
      if (m) {
        const who = m[1].toLowerCase()
        const text = m[2].trim()
        const isGuest = who.includes('guest') || who.includes('2')
        beats.push({
          beat: line,
          speaker: isGuest ? 'Guest' : 'Host',
          dialogue: text,
          emotion: inferEmotion(text),
          gesture: inferGesture(text),
          cameraShot: isGuest ? 'actor2_close' : 'close_up',
        })
      } else {
        beats.push({
          beat: line,
          dialogue: line,
          emotion: 'neutral',
          gesture: inferGesture(line),
          cameraShot: 'two_shot_wide',
        })
      }
    }

    if (beats.length === 0) {
      beats.push({
        beat: script || 'Host: Hello.',
        speaker: 'Host',
        dialogue: script || 'Hello.',
        emotion: 'neutral',
        gesture: 'wave',
        cameraShot: 'two_shot_wide',
      })
    }

    // Reuse createEpisodePlan path by synthesizing a prompt, but keep explicit speakers
    const synthetic = beats
      .map((b) => (b.speaker ? `${b.speaker}: ${b.dialogue}` : b.dialogue || b.beat))
      .join(' ')

    const episode = this.createEpisodePlan(synthetic, stageKey)
    // Overlay explicit speaker/dialogue from legacy lines onto shots
    const scene = episode.scenes[0]
    if (scene) {
      scene.shots = beats.map((beat, idx) => {
        const existing = scene.shots[idx]
        const isGuest = beat.speaker === 'Guest'
        const speakerId = isGuest ? 'char_guest_1' : 'char_host'
        const speechDur = estimateSpeechSeconds(beat.dialogue || beat.beat)
        const gesture = beat.gesture && beat.gesture !== 'none' ? beat.gesture : undefined
        return {
          id: existing?.id ?? uid(`shot_${idx + 1}`),
          shotNumber: idx + 1,
          narrativeBeat: beat.beat,
          camera: {
            shotKey: beat.cameraShot || (isGuest ? 'actor2_close' : 'close_up'),
            anchor: isGuest ? 'actor2_head' : 'actor1_head',
            transitionDurationMs: idx === 0 ? 800 : 1200,
          },
          duration: clampDuration(speechDur + 0.8),
          dialogue: {
            speakerId,
            text: beat.dialogue || beat.beat,
            estimatedDuration: speechDur,
          },
          performances: {
            [speakerId]: {
              source: 'AI',
              emotion: beat.emotion || 'neutral',
              gesture,
            },
          },
        } as D3Shot
      })
      episode.estimatedDuration = scene.shots.reduce((s, sh) => s + sh.duration, 0)
      episode.title = 'Script Take'
      episode.synopsis = 'Legacy Host/Guest script'
      episode.characters = episode.characters || [
        CharacterLibraryService.fromArchetype('host', { id: 'char_host', name: 'Host' }),
        CharacterLibraryService.fromArchetype('guest', { id: 'char_guest_1', name: 'Guest' }),
      ]
    }
    return CharacterLibraryService.bindEpisodeCast(episode)
  }

  /**
   * Compile structured episode into the canonical camera / dialogue / emote tracks
   * consumed by App.tsx playback and scene export.
   */
  static compileEpisodeToTimeline(
    episode: D3Episode,
    cinematicShots: Record<string, CameraShotConfig>
  ): D3TimelineCompilation {
    const cameraTrack: SceneCameraKeyframe[] = []
    const dialogueTimeline: SceneDialogueEvent[] = []
    const emoteTimeline: SceneEmoteEvent[] = []

    let t = 0

    for (const scene of episode.scenes) {
      for (const shot of scene.shots) {
        const shotKey = String(shot.camera.shotKey)
        const config = cinematicShots[shotKey] || cinematicShots['two_shot_wide']
        const durationMs = shot.camera.transitionDurationMs ?? 1400

        cameraTrack.push({
          time: t,
          shotKey,
          anchor: shot.camera.anchor || config?.anchor || 'stage_center',
          radius: config?.radius ?? 2.8,
          phi: config?.phi ?? Math.PI / 2.1,
          theta: config?.theta ?? 0,
          fov: config?.fov ?? 40,
          rollZ: shot.camera.rollZ ?? config?.rollZ ?? 0,
          durationMs,
          easing: 'cubic_out',
        })

        // Dialogue — map characterId → runtime slot via Module 4 cast map
        if (shot.dialogue?.text) {
          const speakerId = shot.dialogue.speakerId
          const actor = CharacterLibraryService.slotForCharacterId(speakerId, episode.castSlots)
          const dur = shot.dialogue.estimatedDuration ?? estimateSpeechSeconds(shot.dialogue.text)
          dialogueTimeline.push({
            actor,
            actorRole: CharacterLibraryService.roleForSlot(actor),
            text: shot.dialogue.text,
            startTime: t + 0.15,
            duration: dur,
          })
        }

        // Emotes from performances
        for (const [perfId, perf] of Object.entries(shot.performances || {})) {
          if (!perf.gesture || perf.gesture === 'none') continue
          const actor = CharacterLibraryService.slotForCharacterId(perfId, episode.castSlots)
          emoteTimeline.push({
            actor,
            name: perf.gesture,
            time: t + 0.1,
            durationEstimate: Math.min(3.2, shot.duration * 0.85),
          })
        }

        // Fallback: action description → look_around / turn_head
        if (
          shot.actions?.length &&
          !emoteTimeline.some((e) => Math.abs(e.time - t) < 0.2)
        ) {
          const desc = shot.actions[0].description.toLowerCase()
          const name: D3Gesture = /turn/.test(desc)
            ? 'turn_head'
            : /look|scan|search/.test(desc)
              ? 'look_around'
              : 'look_around'
          const actor = CharacterLibraryService.slotForCharacterId(
            shot.actions[0].actorId,
            episode.castSlots
          )
          emoteTimeline.push({
            actor,
            name,
            time: t + 0.1,
            durationEstimate: 2.8,
          })
        }

        t += shot.duration
      }
    }

    // Always start with an establishing camera if track is empty
    if (cameraTrack.length === 0) {
      const config = cinematicShots['two_shot_wide']
      cameraTrack.push({
        time: 0,
        shotKey: 'two_shot_wide',
        anchor: 'stage_center',
        radius: config?.radius ?? 2.8,
        phi: config?.phi ?? Math.PI / 2.1,
        theta: 0,
        fov: config?.fov ?? 40,
        rollZ: 0,
        durationMs: 1200,
        easing: 'cubic_out',
      })
      t = Math.max(t, 3)
    }

    return {
      cameraTrack,
      dialogueTimeline,
      emoteTimeline,
      durationSeconds: Math.max(t, episode.estimatedDuration || 0, 3),
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private static narrateAction(action: string, emotion?: D3Emotion): string {
    const lower = action.toLowerCase()
    if (lower.includes('enter')) return 'I need to see what is inside.'
    if (lower.includes('look') || lower.includes('suspicious')) {
      return emotion === 'suspicious' ? 'Something is not right here.' : 'Let me take a look around.'
    }
    if (lower.includes('hear') || lower.includes('sound') || lower.includes('noise')) {
      return 'Did you hear that?'
    }
    if (lower.includes('turn')) return 'Who is there?'
    if (lower.includes('discover') || lower.includes('find') || lower.includes('photograph')) {
      return 'What is this...?'
    }
    if (lower.includes('warn') || lower.includes('disconnect')) {
      return 'Get out of the system. Now.'
    }
    // Generic short line from first clause
    const short = action.replace(/[.?!].*$/, '').trim()
    if (short.length > 8 && short.length < 90) return short
    return 'Stay focused.'
  }

  private static titleFromGenre(genre: string, lead?: string): string {
    if (genre.includes('Noir') || genre.includes('Mystery')) {
      return lead ? `${lead} — Midnight Case` : 'Midnight Case'
    }
    if (genre.includes('Cyber')) return 'Grid Breach'
    if (genre.includes('Broadcast') || genre.includes('News')) return 'Breaking Feed'
    return lead ? `${lead} — Opening Scene` : 'Opening Scene'
  }
}
