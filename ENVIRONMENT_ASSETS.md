# D3 Studio — Environment Asset Library

This document explains how to add **local 3D assets** (`.glb` / `.gltf`) that
D3 Studio loads and places **on top of** the existing procedural environment
builder.

> **No download happens automatically.** You place files in the folders listed
> below. If a file is missing, D3 Studio keeps running and simply uses the
> existing **procedural primitive fallback** for that prop — you will see a
> console warning like:
>
> ```
> Missing environment asset: warehouse/crate.glb
> ```

---

## 1. Exact folder structure

Create these folders (they already exist in this repo):

```
public/
└── assets/
    └── environments/
        ├── warehouse/
        ├── railway/
        ├── apartment/
        ├── forest/
        ├── studio/
        └── city/
```

---

## 2. Exact expected filenames

The manifest **`src/services/environmentAssetLibrary.ts`** is the single source
of truth. Do **not** invent other filenames — the loader looks up exactly these:

| Folder       | Filenames                                                        |
| ------------ | ---------------------------------------------------------------- |
| `warehouse/` | `crate.glb`, `barrel.glb`, `shelf.glb`, `pallet.glb`, `pillar.glb` |
| `railway/`   | `bench.glb`, `platform.glb`, `rail.glb`, `lamp.glb`, `station_sign.glb` |
| `apartment/` | `sofa.glb`, `table.glb`, `chair.glb`, `cabinet.glb`, `shelf.glb` |
| `forest/`    | `tree_01.glb`, `tree_02.glb`, `rock.glb`, `bush.glb`             |
| `studio/`    | `desk.glb`, `screen.glb`, `panel.glb`, `light_stand.glb`         |
| `city/`      | `building.glb`, `sidewalk.glb`, `lamp.glb`, `bench.glb`          |

> The `railway/lamp.glb` and `city/lamp.glb` files are **separate assets** —
> place each in its own folder exactly as shown.

---

## 3. What each file is used for

| Semantic name   | Category   | Used for                                                        |
| --------------- | ---------- | --------------------------------------------------------------- |
| `crate`         | warehouse  | Stacked storage crates along aisles, frame edges, back walls.   |
| `barrel`        | warehouse  | Industrial barrels near the frame edges.                        |
| `shelf`         | warehouse  | Heavy metal rack / shelf units against the side walls.          |
| `pallet`        | warehouse  | Wooden shipping pallet — flat floor props near aisles.          |
| `pillar`        | warehouse  | Structural support pillar (hero silhouette row).               |
| `bench`         | railway    | Platform bench on the platform edge, facing the tracks.         |
| `platform`      | railway    | Station platform slab (midground walkable surface).             |
| `rail`          | railway    | Metal rail track segment (pair) running along Z.                |
| `lamp`          | railway    | Overhead platform light fixture.                                 |
| `station_sign`  | railway    | Station name sign above the platform.                           |
| `sofa`          | apartment  | Living-room sofa, visible midground.                            |
| `table`         | apartment  | Coffee / side table.                                            |
| `chair`         | apartment  | Living-room chair, visible midground.                           |
| `cabinet`       | apartment  | Storage cabinet against the back wall.                          |
| `shelf`         | apartment  | Wall shelf unit, back wall.                                     |
| `tree_01`       | forest     | Tall tree variant A (frame edges, midground, deep rows).        |
| `tree_02`       | forest    | Tall tree variant B (alternates with `tree_01`).                |
| `rock`          | forest    | Scattered mossy rock (foreground / midground).                  |
| `bush`          | forest     | Low undergrowth bush along the frame edge.                      |
| `desk`          | studio     | Presenter / news desk behind the actor area.                    |
| `screen`        | studio     | Large studio display wall / backdrop screen.                    |
| `panel`         | studio     | Flanking studio panel (lit-edge paneling).                      |
| `light_stand`   | studio     | Studio softbox / light stand accent.                            |
| `building`      | city       | City building — street canyon walls.                            |
| `sidewalk`      | city       | Sidewalk strip beside the road.                                 |
| `lamp`          | city       | Street lamp along the sidewalks.                                |
| `bench`         | city       | Public street bench on the sidewalk.                            |

---

## 4. Accepted formats

- **`.glb` — preferred.** Binary GLTF · single file · loads fast.
- **`.gltf` — acceptable.** JSON GLTF (with same base filename, e.g.
  `crate.gltf`). If your `.gltf` needs external `.bin` / texture files, place
  them next to it in the same folder.

The loader always tries `.glb` first, then falls back to the `.gltf` with the
same base name.

---

## 5. How to replace an asset later

1. Put your new file at the **exact** path shown above (same filename).
2. Refresh the page (the loader probes the file, and caches per URL — a fresh
   load picks up the new file).
3. The procedural prop remains hidden while the asset is loaded; if your asset
   fails to parse, you get the warning and the procedural prop reappears.

> File size guidance: keep each prop under ~2 MB when possible; use Draco
> compression if your exporter supports it. D3 Studio never downloads remote
> assets — only local files in `public/assets/environments/`.

---

## 6. Recommended: low-poly CC0 assets

- **Low-poly** — keeps the older-MacBook frame budget safe; props here are
  visible but secondary to the VRM actors.
- **CC0 licensed** — public domain / no attribution required (e.g. from
  KayKit-like packs, Quaternius, or Sketchfab CC0 collections). This project
  must not depend on paid APIs or paid asset packs.
- Keep the model's **origin at the ground / base** (the loader normalizes scale
  so the largest axis matches the manifest target; the composer places it at
  the procedural location, so "feet" should be at y=0 of the model).

---

## 7. Procedural fallback is automatic

Every asset slot has a matching procedural primitive built into the existing
composer:

- `warehouse/crate.glb` missing → the code's `buildCrate` box appears.
- `forest/tree_01.glb` missing → the code's `buildTree` cone canopy appears.
- …and so on for all slots.

The project stays fully functional with **zero** asset files.

---

## Quick missing-asset report

You can generate the current checklist in-browser via the console helper
(`src/services/environmentAssetReport.ts`):

```ts
import { formatAssetChecklist } from './src/services/environmentAssetReport'
// formatAssetChecklist().then(console.log)
```

It prints exactly which `public/assets/environments/...` files are still
missing, grouped by category:

```
MISSING ASSETS:

WAREHOUSE:
[ ] public/assets/environments/warehouse/crate.glb
[ ] public/assets/environments/warehouse/barrel.glb
...