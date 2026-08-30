# Character Generation — Remote Architecture

Local/client-side module for the remote character generation pipeline.

## Architecture

```
D3 Studio text → CharacterSpec JSON → remote character generator → GLB → D3 Studio
```

This module implements the **local/client side only**. It does NOT include a server,
Blender, or MPFB2. It provides:

1. A structured `CharacterSpec` interface (parameters, not preset models)
2. A deterministic text-to-spec parser
3. A client for the remote generation API (with mock for local testing)

## Files

| File | Purpose |
|------|---------|
| `src/characterSpec.ts` | `CharacterSpec` interface and type definitions |
| `src/characterPromptParser.ts` | Deterministic text → `CharacterSpec` parser |
| `src/characterGeneratorClient.ts` | Remote API contract + mock implementation |
| `character-spec.json` | Example output of the parser |
| `tests/characterPromptParser.test.ts` | Parser self-test suite |

## CharacterSpec Schema

```json
{
  "id": "char_example_001",
  "gender": "male",
  "age": { "category": "elderly", "exact": 65 },
  "bodyBuild": "average",
  "height": "average",
  "hair": { "style": "short", "color": "gray" },
  "skinTone": "medium",
  "clothing": { "category": "uniform", "description": "police uniform", "color": "#1a237e" },
  "occupation": "police_officer",
  "accessories": [{ "type": "badge" }, { "type": "hat", "description": "police cap" }],
  "notes": "A 65 year old male police officer"
}
```

All fields are **generation parameters** — they describe what to generate, not
references to existing models.

## Parser Examples

| Input | Parsed Result |
|-------|---------------|
| `"A 65 year old male police officer"` | male, age 65 (elderly), police_officer |
| `"A young woman firefighter"` | female, young_adult, firefighter |
| `"An old man wearing a suit"` | male, elderly, suit |
| `"A little boy"` | male, child |
| `"A teenage girl with long black hair"` | female, teenager, long hair, black hair |

## Remote API Contract

### `POST /generate-character`

**Request:**
```json
{
  "spec": { /* CharacterSpec */ }
}
```

**Response:**
```json
{
  "characterId": "string",
  "modelUrl": "string",
  "format": "glb"
}
```

## Usage

```typescript
import { parseCharacterPrompt } from './src/characterPromptParser';
import { createGeneratorClient } from './src/characterGeneratorClient';

// Parse text to spec
const spec = parseCharacterPrompt('A 65 year old male police officer');

// Generate (mock for local dev)
const client = createGeneratorClient({ type: 'mock' });
const result = await client.generateCharacter(spec);

console.log(result.characterId);  // e.g. "male_elderly_age65_police_officer_0"
console.log(result.modelUrl);    // e.g. "/generated-characters/male_elderly_age65_police_officer_0.glb"
console.log(result.format);      // "glb"
```

## Running Tests

```bash
npx tsc --module commonjs --target ES2020 --esModuleInterop \
  --skipLibCheck --outDir /tmp/d3-char-parser-test \
  character-generation/src/characterSpec.ts \
  character-generation/src/characterPromptParser.ts \
  character-generation/tests/characterPromptParser.test.ts
node /tmp/d3-char-parser-test/character-generation/tests/characterPromptParser.test.js
```

## Isolation

This module is completely isolated from:
- `src/App.tsx`
- `src/services/characterPresence.ts`
- `src/characterLibrary.ts`
- Any Blender/MPFB2 installation

No preset characters are defined. The JSON specification represents **parameters**
for procedural generation, not references to fixed male/female models.