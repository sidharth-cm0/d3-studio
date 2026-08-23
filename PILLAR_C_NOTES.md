
Pillar C — Cloud Production Render & Scene Exporter
What changed in App.tsx

Bugs fixed (these were compile-breakers, not stylistic):

Six useRef<X null |>(...) declarations used invalid TypeScript generic
  syntax (union written backwards). Fixed to useRef<X | null>(...) for
  actor1VrmRef, actor2VrmRef, stageGroupRef, sceneRef, cameraRef,
  rendererRef, the two light refs, and mediaRecorderRef.
The animation-loop cleanup referenced audioContextRef.current, a ref
  that was never declared anywhere in the component — this was a guaranteed
  ReferenceError on unmount/remount (e.g. every time you flipped between
  Director and MoCap mode, since the effect re-runs on [mode]). Removed;
  nothing in the current engine opens a Web Audio AudioContext.
Removed a few genuinely-dead state variables (lightIntensity,
  isMicActive, isRecording, recordedChunksRef) that were declared but
  never read/written anywhere, which tsc --noUnusedLocals (or most CI
  lint configs) would fail on.

New capability — scene export:

playStageDialogue() was refactored so all the scheduling math (camera
  cut times, dialogue start/duration, emote trigger times) is computed once
  up front by buildDialogueTimelinePlan(), then both used to schedule the
  live setTimeouts and stashed in lastTimelineRef. Previously this
  logic was interleaved directly into the scheduling loop, so there was no
  single source of truth to export from.
exportSceneGraph() (wired to the new 📦 Export Scene button, top-left
  toolbar) assembles a SceneGraphExport object — stage config, resolved
  light colors/intensities/positions, both actors' transform + customization
  + a snapshot of key bone rotations, the full camera keyframe track, and
  the dialogue/emote timelines — and downloads it as
  d3-scene-<timestamp>.scene.json via downloadSceneJSON().
If the user hasn't pressed Play yet, export still works: it builds a
  fresh timeline from the current prompt text so the file is never empty.
src/lib/sceneExport.ts

Owns the .scene.json TypeScript types (SceneGraphExport and friends),
downloadSceneJSON(), and validateSceneGraph(). Kept separate from
App.tsx so the Blender script's expectations and the web engine's output
have one canonical shape to stay in sync against — bump
SCENE_FORMAT_VERSION if you change the schema, and update
render_scene.py's load_scene_graph() required-keys check to match.

blender/render_scene.py

Headless Blender entry point. Given a .scene.json (and the two actors'
.vrm files, resolved via --vrm-dir or alongside the JSON), it:

Resets to an empty .blend, configures Cycles (GPU/OPTIX by default,
   denoising on, AgX/Filmic view transform).
Rebuilds the stage geometry and three-point lighting from stage /
   lighting.
Imports each actor via the VRM Blender add-on, applies its exported
   world transform, customization colors, and rest-pose bone offsets.
Converts cameraTrack (spherical offset + anchor, same math as the
   live THREE.Spherical rig in App.tsx) into keyframed camera
   location/rotation/lens, with the anchor re-resolved per-keyframe against
   the actor armature's actual bone position (mirrors
   getSubjectWorldPosition) and Bezier ease-out interpolation to match the
   client's Cubic.Out tweens.
Turns emoteTimeline (wave/bow) and dialogueTimeline into simple
   procedural bone keyframes standing in for the browser's live idle/emote
   loop, since Blender isn't running that JS every frame.
Renders the full animation range at the requested resolution/sample
   count to a PNG sequence.

Coordinate systems: the export is Three.js convention (Y-up, right-handed).
Blender is Z-up, right-handed, so every position/vector conversion in the
script maps (x, y, z)_threejs -> (x, -z, y)_blender consistently.

blender --background --python blender/render_scene.py -- \
  --scene ./d3-scene-1735000000000.scene.json \
  --vrm-dir ./public \
  --out ./renders/take01_ \
  --res-x 3840 --res-y 2160 \
  --samples 256 --device GPU

ffmpeg -framerate 30 -i renders/take01_%04d.png -c:v libx264 -pix_fmt yuv420p take01.mp4

Dependency note: this requires the community "VRM Add-on for Blender"
(saturday06/VRM-Addon-for-Blender) enabled in the target Blender install —
bpy.ops.import_scene.vrm doesn't exist otherwise, and the script raises a
clear RuntimeError telling you that rather than failing silently.

Pillar D — optimization / regression pass

Reviewed all four pillars together for interaction bugs:

Fixed: the audioContextRef crash above would have hit on every
  mode toggle (Director ↔ MoCap), since that effect's cleanup runs on every
  [mode] change, not just unmount — this was the most severe regression
  risk in the current code.
Verified no regression: MoCap's face tracking and Director's TTS/
  emote/camera system don't share mutable state that the timeline refactor
  touched — speakDialogue, triggerEmote, and the render loop's blend
  shape/bone code are untouched.
Still open / recommend as next pass, not done here (flagging rather
  than silently expanding scope): the isRecording UI affordance was dead
  code before and after this change — if local WebM recording is still a
  P4 goal, it needs an actual MediaRecorder wired to
  renderer.domElement.captureStream(), which is a separate, sizeable
  chunk of work I didn't want to bundle into this pass unannounced.

Ingests a .scene.json file exported from the D3 web engine (Pillar C) and
renders a photorealistic, raytraced (Cycles) image sequence: VRM actor rigs,
the animated camera track, the three-point studio lighting rig, and the
stage geometry — all reconstructed from the JSON, with dialogue/emote
timing driving simple procedural gesture keyframes.

REQUIREMENTS
Blender 3.6+ (tested against 3.6 LTS and 4.x)
The "VRM Add-on for Blender" (https://github.com/saturday06/VRM-Addon-for-Blender)
  installed and enabled, so bpy.ops.import_scene.vrm is available.
A Cycles-capable GPU is recommended but not required (falls back to CPU).
USAGE

    blender --background --python render_scene.py --
