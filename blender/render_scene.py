import argparse
import json
import math
import os
import sys

import bpy
import mathutils

# ---------------------------------------------------------------------------
# CLI argument parsing (Blender passes its own args before --)
# ---------------------------------------------------------------------------

def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser(description="D3 headless Blender render pipeline")
    parser.add_argument("--scene", required=True, help="Path to the .scene.json file")
    parser.add_argument("--out", required=True, help="Output frame path prefix, e.g. /out/render_")
    parser.add_argument("--res-x", type=int, default=3840, help="Render width (default: 3840 = 4K UHD)")
    parser.add_argument("--res-y", type=int, default=2160, help="Render height (default: 2160 = 4K UHD)")
    parser.add_argument("--samples", type=int, default=256, help="Cycles render samples")
    parser.add_argument("--device", choices=["GPU", "CPU"], default="GPU", help="Cycles compute device")
    parser.add_argument("--frame-start", type=int, default=None, help="Override first frame to render")
    parser.add_argument("--frame-end", type=int, default=None, help="Override last frame to render")
    parser.add_argument("--vrm-dir", default=None, help="Directory to resolve relative vrmSourceUrl values against")
    return parser.parse_args(argv)

# ---------------------------------------------------------------------------
# Scene graph loading
# ---------------------------------------------------------------------------

def load_scene_graph(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    required = ["formatVersion", "fps", "durationSeconds", "stage", "lighting", "actors", "cameraTrack"]
    missing = [k for k in required if k not in data]
    if missing:
        raise ValueError(f"scene.json is missing required keys: {missing}")

    return data

# ---------------------------------------------------------------------------
# Scene bootstrap
# ---------------------------------------------------------------------------

def reset_blend_file():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def configure_render_engine(res_x: int, res_y: int, samples: int, device: str, fps: int):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX" if "AgX" in [
        t.name for t in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items
    ] else "Filmic"

    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX" if device == "GPU" else "NONE"
    try:
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
    except Exception:
        pass
    scene.cycles.device = device

def hex_to_linear_rgb(hex_str: str):
    hex_str = hex_str.lstrip("#")
    r, g, b = (int(hex_str[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    # sRGB -> linear
    def to_linear(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (to_linear(r), to_linear(g), to_linear(b), 1.0)

# ---------------------------------------------------------------------------
# Stage geometry (mirrors buildStageEnvironment() in App.tsx)
# ---------------------------------------------------------------------------

def build_stage(stage_cfg: dict):
    floor_color = hex_to_linear_rgb(stage_cfg["floorColor"])
    grid_color = hex_to_linear_rgb(stage_cfg["gridColor"])

    bpy.ops.mesh.primitive_cylinder_add(radius=4.65, depth=0.25, location=(0, 0, -0.125))
    floor = bpy.context.active_object
    floor.name = "Stage_Floor"
    floor_mat = bpy.data.materials.new("Stage_Floor_Mat")
    floor_mat.use_nodes = True
    bsdf = floor_mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = floor_color
    bsdf.inputs["Roughness"].default_value = 0.15
    bsdf.inputs["Metallic"].default_value = 0.6
    floor.data.materials.append(floor_mat)

    bpy.ops.mesh.primitive_torus_add(major_radius=4.55, minor_radius=0.04, location=(0, 0, 0.01))
    ring = bpy.context.active_object
    ring.name = "Stage_Ring"
    ring_mat = bpy.data.materials.new("Stage_Ring_Mat")
    ring_mat.use_nodes = True
    ring_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = grid_color
    ring_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.0
    ring.data.materials.append(ring_mat)

    for i in range(-2, 3):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(i * 1.8, -3.2, 1.75))
        pillar = bpy.context.active_object
        pillar.scale = (0.06, 0.06, 1.75)
        pillar.name = f"Stage_Pillar_{i}"
        pillar_mat = bpy.data.materials.new(f"Stage_Pillar_Mat_{i}")
        pillar_mat.use_nodes = True
        pillar_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = grid_color
        pillar_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.5
        pillar.data.materials.append(pillar_mat)

def build_lighting(lighting_cfg: list):
    for light_def in lighting_cfg:
        color = hex_to_linear_rgb(light_def["color"])[:3]
        if light_def["type"] == "ambient":
            world = bpy.data.worlds.new("D3_World")
            bpy.context.scene.world = world
            world.use_nodes = True
            bg = world.node_tree.nodes["Background"]
            bg.inputs["Color"].default_value = (*color, 1.0)
            bg.inputs["Strength"].default_value = light_def["intensity"] * 0.4
        else:
            pos = light_def.get("position", {"x": 0, "y": 2, "z": 2})
            bpy.ops.object.light_add(type="SUN", location=(pos["x"], -pos["z"], pos["y"]))
            light = bpy.context.active_object
            light.data.color = color
            light.data.energy = light_def["intensity"] * 2.0
            # Aim the sun back toward stage center.
            direction = mathutils.Vector((0, 0, 1.3)) - light.location
            light.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

# ---------------------------------------------------------------------------
# Actor (VRM) import
# ---------------------------------------------------------------------------

def resolve_vrm_path(vrm_source_url: str, vrm_dir: str, scene_json_path: str) -> str:
    if os.path.isabs(vrm_source_url) and os.path.exists(vrm_source_url):
        return vrm_source_url
    search_dirs = [vrm_dir, os.path.dirname(os.path.abspath(scene_json_path)), os.getcwd()]
    basename = os.path.basename(vrm_source_url)
    for d in search_dirs:
        if not d:
            continue
        candidate = os.path.join(d, basename)
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(
        f"Could not resolve VRM source '{vrm_source_url}'. Pass --vrm-dir pointing at the "
        f"folder containing the exported .vrm files."
    )

VRM_BONE_TO_BLENDER = {
    "head": "head",
    "spine": "spine",
    "chest": "chest",
    "leftUpperArm": "leftUpperArm",
    "rightUpperArm": "rightUpperArm",
    "leftLowerArm": "leftLowerArm",
    "rightLowerArm": "rightLowerArm",
}

def import_actor(actor: dict, vrm_dir: str, scene_json_path: str):
    vrm_path = resolve_vrm_path(actor["vrmSourceUrl"], vrm_dir, scene_json_path)

    if not hasattr(bpy.ops.import_scene, "vrm"):
        raise RuntimeError(
            "bpy.ops.import_scene.vrm is unavailable — install & enable the "
            "'VRM Add-on for Blender' (saturday06/VRM-Addon-for-Blender) in this Blender install."
        )

    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.vrm(filepath=vrm_path)
    after = set(bpy.data.objects.keys())
    new_objs = [bpy.data.objects[n] for n in (after - before)]

    armature = next((o for o in new_objs if o.type == "ARMATURE"), None)
    root = armature if armature else (new_objs[0] if new_objs else None)
    if root is None:
        raise RuntimeError(f"VRM import for actor {actor['id']} produced no objects")

    # Three.js is Y-up, right-handed with Z toward viewer; Blender is Z-up,
    # right-handed. Map (x, y, z)_threejs -> (x, -z, y)blender.
    pos = actor["position"]
    root.location = (pos["x"], -pos["z"], pos["y"])
    root.rotation_mode = "XYZ"
    root.rotation_euler = (0, 0, actor["rotationY"])
    root.name = f"Actor{actor['id']}{actor['role']}"

    # Apply the rest-pose bone offsets captured at export time, if the
    # armature exposes matching bone names via the VRM humanoid mapping.
    if armature and armature.pose:
        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.mode_set(mode="POSE")
        for bone_pose in actor.get("restPose", []):
            bl_bone_name = VRM_BONE_TO_BLENDER.get(bone_pose["bone"])
            pbone = armature.pose.bones.get(bl_bone_name) if bl_bone_name else None
            if pbone:
                r = bone_pose["rotation"]
                pbone.rotation_mode = "XYZ"
                pbone.rotation_euler = (r["x"], r["y"], r["z"])
        bpy.ops.object.mode_set(mode="OBJECT")

    return armature

def apply_actor_customization(armature, actor: dict):
    """Best-effort recolor of skin/hair/cloth materials to match the web
    engine's customization, in case the imported VRM's own material colors
    should be overridden (mirrors applyCustomAvatarFeatures() in App.tsx)."""
    if armature is None:
        return
    custom = actor.get("customization", {})
    color_map = {
        "skin": custom.get("skinColor"),
        "hair": custom.get("hairColor"),
        "cloth": custom.get("shirtColor"),
    }
    mesh_objs = [o for o in armature.children if o.type == "MESH"]
    for obj in mesh_objs:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            name = mat.name.lower()
            for key, hex_color in color_map.items():
                if hex_color and key in name:
                    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                    if bsdf:
                        bsdf.inputs["Base Color"].default_value = hex_to_linear_rgb(hex_color)

# ---------------------------------------------------------------------------
# Camera track (keyframed from cameraTrack[])
# ---------------------------------------------------------------------------

def spherical_to_cartesian(radius, phi, theta):
    # Matches THREE.Vector3.setFromSpherical: phi = polar (from +Y), theta = azimuthal.
    x = radius * math.sin(phi) * math.sin(theta)
    y = radius * math.cos(phi)
    z = radius * math.sin(phi) * math.cos(theta)
    return x, y, z

ANCHOR_TO_ACTOR_BONE = {
    "actor1_head": (1, "head"),
    "actor1_chest": (1, "chest"),
    "actor2_head": (2, "head"),
    "actor2_chest": (2, "chest"),
}

def anchor_world_position(anchor: str, actor_armatures: dict):
    if anchor in ANCHOR_TO_ACTOR_BONE:
        actor_id, bone_name = ANCHOR_TO_ACTOR_BONE[anchor]
        armature = actor_armatures.get(actor_id)
        bl_bone = VRM_BONE_TO_BLENDER.get(bone_name)
        if armature and bl_bone and armature.pose.bones.get(bl_bone):
            bone = armature.pose.bones[bl_bone]
            world = armature.matrix_world @ bone.head
            return world
    return mathutils.Vector((0, 0, 1.25))

def build_camera_track(camera_track: list, fps: int, actor_armatures: dict):
    bpy.ops.object.camera_add(location=(0, -2.8, 1.35))
    cam_obj = bpy.context.active_object
    cam_obj.name = "D3_Camera"
    bpy.context.scene.camera = cam_obj

    for kf in camera_track:
        frame = round(kf["time"] * fps) + 1
        pivot = anchor_world_position(kf["anchor"], actor_armatures)
        ox, oy, oz = spherical_to_cartesian(kf["radius"], kf["phi"], kf["theta"])
        # three.js (x, y, z) -> blender (x, -z, y)
        cam_pos = mathutils.Vector((pivot.x + ox, pivot.y - oz, pivot.z + oy))
        cam_obj.location = cam_pos

        direction = pivot - cam_pos
        rot_quat = direction.to_track_quat("-Z", "Y")
        cam_obj.rotation_mode = "XYZ"
        cam_obj.rotation_euler = rot_quat.to_euler()
        if kf.get("rollZ"):
            cam_obj.rotation_euler.rotate_axis("Z", -kf["rollZ"])

        # Convert vertical FOV (three.js PerspectiveCamera.fov, degrees) to
        # a Blender lens angle on the same axis.
        cam_obj.data.sensor_fit = "VERTICAL"
        cam_obj.data.lens_unit = "FOV"
        cam_obj.data.angle = math.radians(kf["fov"])

        cam_obj.keyframe_insert(data_path="location", frame=frame)
        cam_obj.keyframe_insert(data_path="rotation_euler", frame=frame)
        cam_obj.data.keyframe_insert(data_path="lens", frame=frame)

    # Smooth, filmic interpolation to mirror the Cubic.Out tween easing used
    # client-side for every shot transition.
    if cam_obj.animation_data and cam_obj.animation_data.action:
        for fcurve in cam_obj.animation_data.action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.easing = "EASE_OUT"

    return cam_obj

# ---------------------------------------------------------------------------
# Dialogue / emote timeline -> simple procedural gesture keyframes
# ---------------------------------------------------------------------------

def apply_emote_keyframes(emote_timeline: list, fps: int, actor_armatures: dict):
    for emote in emote_timeline:
        armature = actor_armatures.get(emote["actor"])
        if not armature:
            continue
        start_frame = round(emote["time"] * fps) + 1
        end_frame = start_frame + round(emote.get("durationEstimate", 3.0) * fps)

        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.mode_set(mode="POSE")
        arm_bone = armature.pose.bones.get("rightUpperArm")
        if arm_bone and emote["name"] == "wave":
            arm_bone.rotation_mode = "XYZ"
            for i, frac in enumerate((0.0, 0.25, 0.5, 0.75, 1.0)):
                frame = start_frame + round(frac * (end_frame - start_frame))
                osc = math.sin(frac * math.pi * 4) * 0.45
                arm_bone.rotation_euler = (-0.45, -0.35 + osc * 0.1, -0.28)
                arm_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
        spine_bone = armature.pose.bones.get("spine")
        if spine_bone and emote["name"] == "bow":
            spine_bone.rotation_mode = "XYZ"
            for frac, angle in ((0.0, 0.0), (0.5, 0.55), (1.0, 0.0)):
                frame = start_frame + round(frac * (end_frame - start_frame))
                spine_bone.rotation_euler = (angle, 0, 0)
                spine_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
        bpy.ops.object.mode_set(mode="OBJECT")

def apply_dialogue_visemes(dialogue_timeline: list, fps: int, actor_armatures: dict):
    """Simple open/close jaw-proxy animation (head-bone micro nod) timed to
    each line's start/duration, standing in for full viseme shape-key
    playback when the imported VRM doesn't expose blend shapes to Blender."""
    for line in dialogue_timeline:
        armature = actor_armatures.get(line["actor"])
        head_bone = armature.pose.bones.get("head") if armature else None
        if not head_bone:
            continue
        start_frame = round(line["startTime"] * fps) + 1
        end_frame = round((line["startTime"] + line["duration"]) * fps) + 1

        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.mode_set(mode="POSE")
        head_bone.rotation_mode = "XYZ"
        steps = max(2, (end_frame - start_frame) // 4)
        for i in range(steps + 1):
            frame = start_frame + round((end_frame - start_frame) * i / steps)
            nod = math.sin(i * 1.7) * 0.03
            head_bone.rotation_euler = (nod, 0, 0)
            head_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
        bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = parse_args()
    scene_data = load_scene_graph(args.scene)

    fps = scene_data.get("fps", 30)
    duration_seconds = scene_data["durationSeconds"]
    total_frames = max(1, round(duration_seconds * fps))

    reset_blend_file()
    configure_render_engine(args.res_x, args.res_y, args.samples, args.device, fps)

    bpy.context.scene.frame_start = args.frame_start or 1
    bpy.context.scene.frame_end = args.frame_end or total_frames

    build_stage(scene_data["stage"])
    build_lighting(scene_data["lighting"])

    actor_armatures = {}
    for actor in scene_data["actors"]:
        armature = import_actor(actor, args.vrm_dir, args.scene)
        apply_actor_customization(armature, actor)
        actor_armatures[actor["id"]] = armature

    build_camera_track(scene_data["cameraTrack"], fps, actor_armatures)
    apply_emote_keyframes(scene_data.get("emoteTimeline", []), fps, actor_armatures)
    apply_dialogue_visemes(scene_data.get("dialogueTimeline", []), fps, actor_armatures)

    bpy.context.scene.render.filepath = args.out
    print(f"[D3] Rendering frames {bpy.context.scene.frame_start}-{bpy.context.scene.frame_end} "
          f"at {args.res_x}x{args.res_y}, {args.samples} spp, device={args.device}")
    bpy.ops.render.render(animation=True)
    print("[D3] Render complete.")

if __name__ == "__main__":
    main()
