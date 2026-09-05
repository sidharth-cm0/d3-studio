/**
 * Character Prompt Parser — Self-Test.
 *
 * Verifies deterministic parsing of natural-language character descriptions
 * into structured CharacterSpec objects.
 *
 * Usage:
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-char-parser-test \
 *     character-generation/src/characterSpec.ts \
 *     character-generation/src/characterPromptParser.ts \
 *     character-generation/tests/characterPromptParser.test.ts
 *   node /tmp/d3-char-parser-test/character-generation/tests/characterPromptParser.test.js
 */

import { parseCharacterPrompt } from '../src/characterPromptParser';
import { CharacterSpec } from '../src/characterSpec';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failureCount = 0;
let passCount = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (ok) {
    passCount++;
  } else {
    failureCount++;
  }
  console.log(
    `  ${ok ? '✓' : '✗'} ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
  );
}

function checkSpecField(
  label: string,
  spec: CharacterSpec,
  field: keyof CharacterSpec,
  expected: unknown
): void {
  check(`${label} [${field}]`, spec[field], expected);
}

function checkSpecHairStyle(label: string, spec: CharacterSpec, expected: string): void {
  check(`${label} [hair.style]`, spec.hair.style, expected);
}

function checkSpecHairColor(label: string, spec: CharacterSpec, expected: string): void {
  check(`${label} [hair.color]`, spec.hair.color, expected);
}

function checkSpecClothingCategory(label: string, spec: CharacterSpec, expected: string): void {
  check(`${label} [clothing.category]`, spec.clothing.category, expected);
}

function checkSpecClothingDescription(label: string, spec: CharacterSpec, expected: string): void {
  check(`${label} [clothing.description]`, spec.clothing.description, expected);
}

function checkSpecAgeCategory(label: string, spec: CharacterSpec, expected: string): void {
  check(`${label} [age.category]`, spec.age.category, expected);
}

function checkSpecAgeExact(label: string, spec: CharacterSpec, expected: number | null): void {
  check(`${label} [age.exact]`, spec.age.exact, expected);
}

function checkSpecAccessories(label: string, spec: CharacterSpec, expectedTypes: string[]): void {
  const actualTypes = spec.accessories.map(a => a.type);
  const ok = JSON.stringify(actualTypes) === JSON.stringify(expectedTypes);
  if (ok) {
    passCount++;
  } else {
    failureCount++;
  }
  console.log(
    `  ${ok ? '✓' : '✗'} ${label} [accessories] — got ${JSON.stringify(actualTypes)}, expected ${JSON.stringify(expectedTypes)}`
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

export function runCharacterPromptParserSelfTest(): number {
  failureCount = 0;
  passCount = 0;
  console.log('[D3 CHARACTER PROMPT PARSER] Self-Test');

  // ===================================================================
  // Example 1: "A 65 year old male police officer"
  // → male, age 65, police_officer
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A 65 year old male police officer');
    checkSpecField('Ex1: 65yo male officer', spec, 'gender', 'male');
    checkSpecAgeExact('Ex1: 65yo male officer', spec, 65);
    checkSpecAgeCategory('Ex1: 65yo male officer', spec, 'elderly');
    checkSpecField('Ex1: 65yo male officer', spec, 'occupation', 'police_officer');
  }

  // ===================================================================
  // Example 2: "A young woman firefighter"
  // → female, young, firefighter
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A young woman firefighter');
    checkSpecField('Ex2: young woman firefighter', spec, 'gender', 'female');
    checkSpecAgeCategory('Ex2: young woman firefighter', spec, 'young_adult');
    checkSpecField('Ex2: young woman firefighter', spec, 'occupation', 'firefighter');
  }

  // ===================================================================
  // Example 3: "An old man wearing a suit"
  // → male, old, suit
  // ===================================================================
  {
    const spec = parseCharacterPrompt('An old man wearing a suit');
    checkSpecField('Ex3: old man in suit', spec, 'gender', 'male');
    checkSpecAgeCategory('Ex3: old man in suit', spec, 'elderly');
    checkSpecClothingCategory('Ex3: old man in suit', spec, 'suit');
    checkSpecClothingDescription('Ex3: old man in suit', spec, 'business suit');
  }

  // ===================================================================
  // Example 4: "A little boy"
  // → male, child
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A little boy');
    checkSpecField('Ex4: little boy', spec, 'gender', 'male');
    checkSpecAgeCategory('Ex4: little boy', spec, 'child');
  }

  // ===================================================================
  // Example 5: "A teenage girl with long black hair"
  // → female, teenager, long hair, black hair
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A teenage girl with long black hair');
    checkSpecField('Ex5: teenage girl long black hair', spec, 'gender', 'female');
    checkSpecAgeCategory('Ex5: teenage girl long black hair', spec, 'teenager');
    checkSpecHairStyle('Ex5: teenage girl long black hair', spec, 'long');
    checkSpecHairColor('Ex5: teenage girl long black hair', spec, 'black');
  }

  // ===================================================================
  // Gender detection
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A man walks into the room');
    checkSpecField('Gender: man', spec, 'gender', 'male');
  }
  {
    const spec = parseCharacterPrompt('A woman enters the building');
    checkSpecField('Gender: woman', spec, 'gender', 'female');
  }
  {
    const spec = parseCharacterPrompt('A boy sits on a chair');
    checkSpecField('Gender: boy', spec, 'gender', 'male');
  }
  {
    const spec = parseCharacterPrompt('A girl stands near the table');
    checkSpecField('Gender: girl', spec, 'gender', 'female');
  }
  {
    const spec = parseCharacterPrompt('A gentleman approaches');
    checkSpecField('Gender: gentleman', spec, 'gender', 'male');
  }
  {
    const spec = parseCharacterPrompt('A lady walks by');
    checkSpecField('Gender: lady', spec, 'gender', 'female');
  }

  // ===================================================================
  // Age detection — numeric
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A 30 year old detective');
    checkSpecAgeExact('Age: 30', spec, 30);
    checkSpecAgeCategory('Age: 30', spec, 'adult');
  }
  {
    const spec = parseCharacterPrompt('A 10 year old student');
    checkSpecAgeExact('Age: 10', spec, 10);
    checkSpecAgeCategory('Age: 10', spec, 'child');
  }
  {
    const spec = parseCharacterPrompt('A baby');
    checkSpecAgeCategory('Age: baby', spec, 'infant');
  }
  {
    const spec = parseCharacterPrompt('A teenager');
    checkSpecAgeCategory('Age: teenager', spec, 'teenager');
  }

  // ===================================================================
  // Occupation detection
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A doctor in scrubs');
    checkSpecField('Occupation: doctor', spec, 'occupation', 'doctor');
  }
  {
    const spec = parseCharacterPrompt('A soldier with a gun');
    checkSpecField('Occupation: soldier', spec, 'occupation', 'soldier');
  }
  {
    const spec = parseCharacterPrompt('A teacher in a classroom');
    checkSpecField('Occupation: teacher', spec, 'occupation', 'teacher');
  }
  {
    const spec = parseCharacterPrompt('A chef in a kitchen');
    checkSpecField('Occupation: chef', spec, 'occupation', 'chef');
  }

  // ===================================================================
  // Clothing detection
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A man in a tuxedo');
    checkSpecClothingCategory('Clothing: tuxedo', spec, 'suit');
    checkSpecClothingDescription('Clothing: tuxedo', spec, 'tuxedo');
  }
  {
    const spec = parseCharacterPrompt('A woman wearing a dress');
    checkSpecClothingCategory('Clothing: dress', spec, 'dress');
  }
  {
    const spec = parseCharacterPrompt('A person in jeans and a hoodie');
    checkSpecClothingCategory('Clothing: jeans', spec, 'casual');
  }
  {
    const spec = parseCharacterPrompt('A scientist in a lab coat');
    checkSpecClothingCategory('Clothing: lab coat', spec, 'medical');
    checkSpecClothingDescription('Clothing: lab coat', spec, 'lab coat');
  }

  // ===================================================================
  // Hair detection
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A woman with long blonde hair');
    checkSpecHairStyle('Hair: long', spec, 'long');
    checkSpecHairColor('Hair: blonde', spec, 'blonde');
  }
  {
    const spec = parseCharacterPrompt('A bald man');
    checkSpecHairStyle('Hair: bald', spec, 'bald');
  }
  {
    const spec = parseCharacterPrompt('A person with curly red hair');
    checkSpecHairStyle('Hair: curly', spec, 'curly');
    checkSpecHairColor('Hair: red', spec, 'red');
  }
  {
    const spec = parseCharacterPrompt('A woman with dark brown hair');
    checkSpecHairColor('Hair: dark brown', spec, 'dark_brown');
  }

  // ===================================================================
  // Accessory detection
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A man with glasses and a hat');
    checkSpecAccessories('Accessories: glasses+hat', spec, ['glasses', 'hat']);
  }
  {
    const spec = parseCharacterPrompt('A woman wearing sunglasses');
    checkSpecAccessories('Accessories: sunglasses', spec, ['sunglasses']);
  }
  {
    const spec = parseCharacterPrompt('A detective with a badge and glasses');
    checkSpecAccessories('Accessories: badge+glasses', spec, ['badge', 'glasses']);
  }

  // ===================================================================
  // Body build detection
  // ===================================================================
  {
    const spec = parseCharacterPrompt('A muscular soldier');
    checkSpecField('Build: muscular', spec, 'bodyBuild', 'athletic');
  }
  {
    const spec = parseCharacterPrompt('A slim woman');
    checkSpecField('Build: slim', spec, 'bodyBuild', 'slim');
  }
  {
    const spec = parseCharacterPrompt('A heavy man');
    checkSpecField('Build: heavy', spec, 'bodyBuild', 'heavy');
  }

  // ===================================================================
  // Edge cases
  // ===================================================================
  {
    const spec = parseCharacterPrompt('');
    checkSpecField('Edge: empty string gender', spec, 'gender', 'unspecified');
    checkSpecAgeCategory('Edge: empty string age', spec, 'unspecified');
  }
  {
    const spec = parseCharacterPrompt('   ');
    checkSpecField('Edge: whitespace gender', spec, 'gender', 'unspecified');
  }
  {
    const spec = parseCharacterPrompt('A person');
    checkSpecField('Edge: person (no gender)', spec, 'gender', 'unspecified');
    checkSpecField('Edge: person (default occupation)', spec, 'occupation', 'civilian');
  }

  // ===================================================================
  // Notes preservation
  // ===================================================================
  {
    const input = 'A 65 year old male police officer';
    const spec = parseCharacterPrompt(input);
    check('Notes: original prompt preserved', spec.notes, input);
  }

  // ===================================================================
  // Summary
  // ===================================================================
  const total = passCount + failureCount;
  console.log(
    `[D3 CHARACTER PROMPT PARSER] ${failureCount === 0 ? 'ALL PASS' : `${failureCount} FAILURES`} — ${passCount}/${total} passed`
  );
  return failureCount;
}