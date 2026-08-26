# Animation Implementation Plan

## Overview
Add procedural animation to make actors move naturally instead of standing static.

## Implementation Phases

### 1. Motion Director Service
- Parse timeline dialogue text for action cues (walk, enter, exit, look, face, step, turn, point, gesture)
- Parse emotion keywords (surprised, angry, happy, sad, neutral, thinking, confused)
- Generate motion blocks: WalkTo, TurnTo, LookAt, Emote, Gesture, Idle
- Each block has duration in seconds

### 2. Idle Animation System
- Deterministic subtle motion using time-based sine functions
- Head sway: gentle ±0.02 rad
- Breathing: chest/arm bob via hip height ±0.005
- Tiny shoulder rotations
- Very subtle arm drift
- No constant full-body movement — keep it still and natural

### 3. Walk System
- Procedural walk cycle
- Bone rotations driven by a walk phase clock
- Foot, knee, hip, arm swing, and chest counter-rotation
- Speed-scaled amplitude and stride
- No external animation libs

### 4. Per-Actor Motion Controller
Each actor gets a scripted `MotionState`:
- position
- facing (yaw)
- headYaw / headPitch (look-at)
- emote (none, talk, surprise, fear, nod, shake)
- keys for smoothing (position, rotation)

### 5. Integration with timeline
- On playback start, compile the scene shots into an actor-director schedule.
- Each shot has constraints: facing target, walk target, look target, emotion, gesture.
- Map dialogue to gestures. Map D3Shot.timing etc.

Let me start understanding the existing code structure first.

<write_to_file>
<path>src/services/motionDirector.ts</path>
<content>
/**
 * MotionDirector - Procedural animation director for D3 story scenes.
 *
 * Drives actors through a "performance schedule" compiled from the scene timeline.
 * Handles: idle breathing, look-at, turn-to, walk-to, gesture blending, emotion postures.
 * Designed for the "static actors" problem: actors should move when action requires it,
 * but remain subtly animated (idle) even when standing still.
 */

import type { D3Shot, D3Scene, D3Episode } from '../types/d3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActorPose {
  position: { x: number; y: number; z: number }
  rotationY: number
  headPitch: number
  headYaw: number
  leftArm: number
  rightArm: number
  leftLeg: number
  rightLeg: number
  spineBend: number
  weightShift: number
  breathing: number
}

export interface ActorIdleState {
  phase: number
  breathPhase: number
  armPhase: number
  eyeBlinkAt: number
  nextEyeBlink: number
}

export interface ActorMotionState {
  targetPosition: { x: number; z: number } | null
  currentPosition: { x: number; z: number }
  velocity: { x: number; z: number }
  facingAngle: number
  targetFacingAngle: number
  isMoving: boolean
  moveSpeed: number // units/sec
  lookTarget: { x: number; y: number; z: number } | null
  emotion: 'neutral' | 'happy' | 'surprised' | 'sad' | 'angry' | 'fearful' | 'disgusted'
  isInteracting: boolean
  interactionStartTime: number | null
  lastGaitCycle: number
}

export interface ActorMotionState {
  actorId: string
  // Movement
  position: { x: number; y: number; z: number }
  targetPosition: { x: number; y: number; z: number } | null
  destinationReached: boolean
  // Rotation
  facingYaw: number
  targetYaw: number | null
  // Head / look
  lookTarget: { x: number; y: number; z: number } | null
  headPitch: number
  headYaw: number
  // Animation phase (no repeats)
  walkPhase: number
  idlePhase: number
  // Blend weight for scripted vs procedural
  scriptedBlend: number
}
export const HEAD_BONE_NAMES = [
  'Head', 'Jaw', 'HeadTop', 'head', 'Head',
  'CC_Base_Head', 'CC_Base_Jaw',
  'mixamorig:Head', 'mixamorig:Jaw',
  'mixamorig:HeadTop_End'
]

export const ARMS_BONE_NAMES = [
  'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', // UE re-target
  'Arm_L', 'Arm_R', 'ForeArm_L', 'ForeArm_R', // UE Mannequin
  'mixamorig:LeftArm', 'mixamorig:RightArm',
  'mixamorig:LeftForeArm', 'mixamorig:RightForeArm',
  'shoulder_L', 'shoulder_R'
]

export function getBoneByName(root: Object3D, targetName: string): Object3D | null {
  const q: Object3D[] = [root]
  while (q.length > 0) {
    const node = q.pop()!
    if (!node) continue
    if (node.name.toLowerCase().includes(targetName.toLowerCase())) return node
    q.push(...node.children)
  }
  return null
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + diff * t
}

export function dampToward(current: number, target: number, lambda = 2.0, dt = 1/60): number {
  const t = Math.min(1, lambda * dt)
  return current + (target - current) * t
}

export function gazeToHead(e: SceneCharacterKeyframe, target: { x: number; y: number; z: number }, damp: number): { hx: number; hy: number; hz: number } {
  // Compute normalized direction from head to gaze target
  const { position } = e
  const dx = target.x - position.x
  const dy = target.y - position.y - 1.45 // eye height
  const dz = target.z - position.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const yaw = Math.atan2(dx, dz) - e.yaw // relative to body yaw
  const pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
  // clamp to human-like limits
  const clampedYaw = Math.max(-1.25, Math.min(1.25, yaw))
  const clampedPitch = Math.max(-0.6, Math.min(0.5, pitch - e.pitch))
  return { yaw: clampedYaw, pitch: clampedPitch }
}
```
</content_analysis> I need to read the full App.tsx to understand the state management and constants before making any changes.

<read_file>
<file_path>/Users/apple/Downloads/d3-studio 12/src/App.tsx</file_path>
<start_line>1</start_line>
<end_line>200</end_line>
</read_file>