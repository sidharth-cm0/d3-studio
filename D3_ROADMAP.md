# D3 Studio — Integrated Build

This archive includes Modules 2–6 integrated into one runnable Vite + React + Three.js app.

## Included

- AI Director (`src/services/aiDirector.ts`) — story → episode → scenes → shots → timeline
- Character library (`src/services/characterLibrary.ts`) — cast → dual VRM slots
- Timeline editor (`src/components/TimelineEditor.tsx`) — edit camera / dialogue / duration / gestures
- Scene export (`src/lib/sceneExport.ts`) + Blender bridge (`blender/render_scene.py`)
- Types (`src/types/d3.ts`) with validation
- Existing Three.js stage, VRM, MediaPipe MoCap, cinematic cameras

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

Place a default `public/avatar.vrm` if you want auto-loaded actors (or upload via UI).

## Verify

```bash
npm run build
```

TypeScript and Vite production build pass on this package.
