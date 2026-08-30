/**
 * Deterministic text-to-CharacterSpec parser.
 *
 * Converts natural-language character descriptions into structured
 * CharacterSpec objects suitable for remote procedural generation.
 *
 * This parser is intentionally rule-based (no ML/AI) so that it is
 * deterministic, testable, and runs entirely client-side.
 */

import {
  CharacterSpec,
  Gender,
  AgeCategory,
  BodyBuild,
  HeightCategory,
  HairStyle,
  HairColor,
  SkinTone,
  createEmptyCharacterSpec,
} from './characterSpec';

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

const GENDER_KEYWORDS: Record<string, Gender> = {
  male: 'male',
  man: 'male',
  boy: 'male',
  gentleman: 'male',
  guy: 'male',
  sir: 'male',
  father: 'male',
  dad: 'male',
  husband: 'male',
  brother: 'male',
  son: 'male',
  uncle: 'male',
  grandfather: 'male',
  king: 'male',
  prince: 'male',
  lord: 'male',

  female: 'female',
  woman: 'female',
  girl: 'female',
  lady: 'female',
  madam: 'female',
  mother: 'female',
  mom: 'female',
  wife: 'female',
  sister: 'female',
  daughter: 'female',
  aunt: 'female',
  grandmother: 'female',
  queen: 'female',
  princess: 'female',
};

const AGE_CATEGORY_KEYWORDS: Record<string, AgeCategory> = {
  infant: 'infant',
  baby: 'infant',
  toddler: 'infant',

  child: 'child',
  kid: 'child',
  little: 'child',
  small: 'child',

  teenager: 'teenager',
  teen: 'teenager',
  adolescent: 'teenager',

  young: 'young_adult',
  youth: 'young_adult',

  adult: 'adult',

  middle_aged: 'middle_aged',
  middle: 'middle_aged',

  senior: 'senior',

  old: 'elderly',
  elderly: 'elderly',
  aged: 'elderly',
  ancient: 'elderly',
};

const BODY_BUILD_KEYWORDS: Record<string, BodyBuild> = {
  slim: 'slim',
  thin: 'slim',
  skinny: 'slim',
  lean: 'slim',
  lanky: 'slim',

  athletic: 'athletic',
  fit: 'athletic',
  muscular: 'athletic',
  sporty: 'athletic',

  average: 'average',
  normal: 'average',

  stocky: 'stocky',

  heavy: 'heavy',
  large: 'heavy',
  big: 'heavy',
  overweight: 'heavy',
  obese: 'heavy',
  bulky: 'heavy',
};

const OCCUPATION_KEYWORDS: Record<string, string> = {
  police: 'police_officer',
  officer: 'police_officer',
  policeman: 'police_officer',
  policewoman: 'police_officer',
  cop: 'police_officer',

  detective: 'detective',

  firefighter: 'firefighter',
  fireman: 'firefighter',
  firewoman: 'firefighter',

  doctor: 'doctor',
  physician: 'doctor',
  surgeon: 'doctor',

  nurse: 'nurse',

  soldier: 'soldier',
  military: 'soldier',
  army: 'soldier',

  warrior: 'warrior',
  knight: 'knight',

  king: 'king',
  queen: 'queen',
  prince: 'prince',
  princess: 'princess',

  teacher: 'teacher',
  professor: 'teacher',

  chef: 'chef',
  cook: 'chef',

  waiter: 'waiter',
  waitress: 'waiter',

  pilot: 'pilot',
  driver: 'driver',

  lawyer: 'lawyer',
  attorney: 'lawyer',
  judge: 'judge',

  scientist: 'scientist',
  engineer: 'engineer',

  programmer: 'programmer',
  developer: 'programmer',

  artist: 'artist',
  musician: 'musician',
  singer: 'singer',
  actor: 'actor',
  dancer: 'dancer',
  athlete: 'athlete',

  student: 'student',

  priest: 'priest',
  monk: 'monk',

  farmer: 'farmer',
  worker: 'worker',
  mechanic: 'mechanic',
  electrician: 'electrician',
  plumber: 'plumber',
  carpenter: 'carpenter',

  security: 'security_guard',
  guard: 'security_guard',

  spy: 'spy',
  agent: 'agent',

  thief: 'thief',
  criminal: 'criminal',
  prisoner: 'prisoner',

  civilian: 'civilian',
};

const CLOTHING_KEYWORDS: Record<
  string,
  { category: string; description: string }
> = {
  suit: {
    category: 'suit',
    description: 'business suit',
  },

  tuxedo: {
    category: 'suit',
    description: 'tuxedo',
  },

  uniform: {
    category: 'uniform',
    description: 'uniform',
  },

  armor: {
    category: 'armor',
    description: 'armor',
  },

  robe: {
    category: 'robe',
    description: 'robe',
  },

  gown: {
    category: 'gown',
    description: 'gown',
  },

  dress: {
    category: 'dress',
    description: 'dress',
  },

  skirt: {
    category: 'skirt',
    description: 'skirt',
  },

  jeans: {
    category: 'casual',
    description: 'jeans',
  },

  tshirt: {
    category: 'casual',
    description: 't-shirt',
  },

  't-shirt': {
    category: 'casual',
    description: 't-shirt',
  },

  hoodie: {
    category: 'casual',
    description: 'hoodie',
  },

  jacket: {
    category: 'outerwear',
    description: 'jacket',
  },

  coat: {
    category: 'outerwear',
    description: 'coat',
  },

  cape: {
    category: 'outerwear',
    description: 'cape',
  },

  scrubs: {
    category: 'medical',
    description: 'medical scrubs',
  },

  labcoat: {
    category: 'medical',
    description: 'lab coat',
  },

  'lab coat': {
    category: 'medical',
    description: 'lab coat',
  },
};

const ACCESSORY_KEYWORDS: Record<string, string> = {
  glasses: 'glasses',
  sunglasses: 'sunglasses',

  hat: 'hat',
  cap: 'cap',
  helmet: 'helmet',

  watch: 'watch',
  badge: 'badge',
  tie: 'tie',
  bowtie: 'bowtie',
  scarf: 'scarf',
  gloves: 'gloves',
  belt: 'belt',

  backpack: 'backpack',
  bag: 'bag',

  earrings: 'earrings',
  necklace: 'necklace',
  ring: 'ring',
  bracelet: 'bracelet',

  crown: 'crown',
  tiara: 'tiara',

  mask: 'mask',

  cane: 'cane',
  crutches: 'crutches',
  wheelchair: 'wheelchair',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Temporary ID generator.
 *
 * We will replace this with stable deterministic character IDs
 * in the next isolated change.
 */
function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * Extract a numeric age from text like:
 *
 * "65 year old"
 * "age 30"
 * "aged 55"
 */
function extractNumericAge(text: string): number | null {
  const patterns = [
    /(\d+)\s*(?:year|yr)s?\s*old/i,
    /age[ds]?\s*(\d+)/i,
    /aged\s*(\d+)/i,
    /(\d+)\s*(?:year|yr)s?\s*of\s*age/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const age = parseInt(match[1], 10);

      if (!isNaN(age) && age >= 0 && age <= 200) {
        return age;
      }
    }
  }

  return null;
}

/**
 * Map exact numeric age to an AgeCategory.
 */
function ageToCategory(age: number): AgeCategory {
  if (age <= 2) return 'infant';
  if (age <= 12) return 'child';
  if (age <= 17) return 'teenager';
  if (age <= 25) return 'young_adult';
  if (age <= 45) return 'adult';
  if (age <= 60) return 'middle_aged';
  if (age <= 75) return 'senior';

  return 'elderly';
}

/**
 * Tokenize input into lowercase word tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0);
}

/**
 * Find first matching keyword.
 *
 * Multi-word phrases are checked before single-word entries.
 */
function findKeyword<T>(
  tokens: string[],
  keywordMap: Record<string, T>,
): T | null {
  const lowerText = tokens.join(' ');

  const phrases = Object.keys(keywordMap)
    .filter(key => key.includes(' '))
    .sort((a, b) => b.length - a.length);

  for (const phrase of phrases) {
    if (lowerText.includes(phrase)) {
      return keywordMap[phrase];
    }
  }

  for (const token of tokens) {
    if (Object.prototype.hasOwnProperty.call(keywordMap, token)) {
      return keywordMap[token];
    }
  }

  return null;
}

/**
 * Find all matching keywords.
 */
function findAllKeywords<T>(
  tokens: string[],
  keywordMap: Record<string, T>,
): T[] {
  const found: T[] = [];
  const lowerText = tokens.join(' ');

  const phrases = Object.keys(keywordMap)
    .filter(key => key.includes(' '))
    .sort((a, b) => b.length - a.length);

  for (const phrase of phrases) {
    if (lowerText.includes(phrase)) {
      const value = keywordMap[phrase];

      if (!found.includes(value)) {
        found.push(value);
      }
    }
  }

  for (const token of tokens) {
    if (Object.prototype.hasOwnProperty.call(keywordMap, token)) {
      const value = keywordMap[token];

      if (!found.includes(value)) {
        found.push(value);
      }
    }
  }

  return found;
}

/**
 * Resolve body height without confusing hair-length descriptions
 * such as "short hair" with body height.
 */
function resolveHeight(text: string): HeightCategory {
  let heightText = text.toLowerCase().replace(/[_-]/g, ' ');

  // Remove phrases where short/medium/long clearly describe hair.
  heightText = heightText
    .replace(
      /\b(?:very\s+)?(?:short|medium|long)\s+(?:black|brown|dark brown|light brown|blonde|red|gray|grey|white|blue|green|pink|purple|auburn|platinum)?\s*hair\b/g,
      ' ',
    )
    .replace(
      /\b(?:short|medium|long)\s+(?:hairstyle|haircut)\b/g,
      ' ',
    );

  if (/\b(?:very\s+)?tall\b/.test(heightText)) {
    return 'tall';
  }

  if (/\btowering\b/.test(heightText)) {
    return 'tall';
  }

  if (/\babove\s+average(?:\s+height)?\b/.test(heightText)) {
    return 'above_average';
  }

  if (/\bbelow\s+average(?:\s+height)?\b/.test(heightText)) {
    return 'below_average';
  }

  if (/\baverage[- ]height\b/.test(heightText)) {
    return 'average';
  }

  if (/\bshort\b/.test(heightText)) {
    return 'short';
  }

  if (/\bpetite\b/.test(heightText)) {
    return 'short';
  }

  return 'unspecified';
}

/**
 * Resolve hair style only when it clearly describes hair,
 * except strongly hair-specific terms such as bald, afro, mohawk, etc.
 */
function resolveHairStyle(text: string): HairStyle {
  const normalized = text.toLowerCase().replace(/[_-]/g, ' ');

  const patterns: Array<[RegExp, HairStyle]> = [
    [/\bbald\b/, 'bald'],
    [/\bbuzz(?:cut)?\b/, 'buzzcut'],
    [/\bponytail\b/, 'ponytail'],
    [/\bhair\s+in\s+a\s+bun\b/, 'bun'],
    [/\bbun\s+hairstyle\b/, 'bun'],
    [/\bbraided\s+hair\b/, 'braided'],
    [/\bhair\s+in\s+braids?\b/, 'braided'],
    [/\bcurly(?:\s+\w+){0,2}\s+hair\b/, 'curly'],
    [/\bwavy(?:\s+\w+){0,2}\s+hair\b/, 'wavy'],
    [/\bafro\b/, 'afro'],
    [/\bmohawk\b/, 'mohawk'],

    [/\bshort(?:\s+\w+){0,2}\s+hair\b/, 'short'],
    [/\bmedium(?:\s+\w+){0,2}\s+hair\b/, 'medium'],
    [/\blong(?:\s+\w+){0,2}\s+hair\b/, 'long'],
  ];

  for (const [pattern, value] of patterns) {
    if (pattern.test(normalized)) {
      return value;
    }
  }

  return 'unspecified';
}

/**
 * Resolve hair color.
 *
 * Long/multi-word colors are intentionally checked first.
 */
function resolveHairColor(text: string): HairColor {
  const normalized = text.toLowerCase().replace(/[_-]/g, ' ');

  const patterns: Array<[RegExp, HairColor]> = [
    [
      /\bstrawberry blonde(?:\s+\w+){0,2}\s+hair\b/,
      'strawberry_blonde',
    ],
    [
      /\bdark brown(?:\s+\w+){0,2}\s+hair\b/,
      'dark_brown',
    ],
    [
      /\blight brown(?:\s+\w+){0,2}\s+hair\b/,
      'light_brown',
    ],

    [/\bplatinum(?:\s+\w+){0,2}\s+hair\b/, 'platinum'],
    [/\bblonde(?:\s+\w+){0,2}\s+hair\b/, 'blonde'],
    [/\bauburn(?:\s+\w+){0,2}\s+hair\b/, 'auburn'],

    [/\bgray(?:\s+\w+){0,2}\s+hair\b/, 'gray'],
    [/\bgrey(?:\s+\w+){0,2}\s+hair\b/, 'gray'],

    [/\bwhite(?:\s+\w+){0,2}\s+hair\b/, 'white'],
    [/\bblack(?:\s+\w+){0,2}\s+hair\b/, 'black'],
    [/\bbrown(?:\s+\w+){0,2}\s+hair\b/, 'brown'],
    [/\bred(?:\s+\w+){0,2}\s+hair\b/, 'red'],

    [/\bblue(?:\s+\w+){0,2}\s+hair\b/, 'blue'],
    [/\bpink(?:\s+\w+){0,2}\s+hair\b/, 'pink'],
    [/\bpurple(?:\s+\w+){0,2}\s+hair\b/, 'purple'],
    [/\bgreen(?:\s+\w+){0,2}\s+hair\b/, 'green'],
  ];

  for (const [pattern, value] of patterns) {
    if (pattern.test(normalized)) {
      return value;
    }
  }

  return 'unspecified';
}

/**
 * Resolve skin tone only when skin/complexion context is explicit.
 *
 * This prevents:
 *
 * "brown hair"
 *
 * from incorrectly producing:
 *
 * skinTone = dark
 */
function resolveSkinTone(text: string): SkinTone {
  const normalized = text.toLowerCase().replace(/[_-]/g, ' ');

  const patterns: Array<[RegExp, SkinTone]> = [
    [
      /\bvery dark(?:\s+skin|\s+complexion)\b/,
      'very_dark',
    ],

    [
      /\bvery light(?:\s+skin|\s+complexion)\b/,
      'very_light',
    ],

    [
      /\bmedium dark(?:\s+skin|\s+complexion)\b/,
      'medium_dark',
    ],

    [
      /\bmedium light(?:\s+skin|\s+complexion)\b/,
      'medium_light',
    ],

    [
      /\bfair[- ]skinned\b/,
      'light',
    ],

    [
      /\bpale[- ]skinned\b/,
      'very_light',
    ],

    [
      /\bdark[- ]skinned\b/,
      'dark',
    ],

    [
      /\blight[- ]skinned\b/,
      'light',
    ],

    [
      /\bbrown[- ]skinned\b/,
      'dark',
    ],

    [
      /\bpale(?:\s+skin|\s+complexion)\b/,
      'very_light',
    ],

    [
      /\bfair(?:\s+skin|\s+complexion)\b/,
      'light',
    ],

    [
      /\blight(?:\s+skin|\s+complexion)\b/,
      'light',
    ],

    [
      /\bmedium(?:\s+skin|\s+complexion)\b/,
      'medium',
    ],

    [
      /\bolive(?:\s+skin|\s+complexion)\b/,
      'medium',
    ],

    [
      /\btan(?:\s+skin|\s+complexion)\b/,
      'medium_dark',
    ],

    [
      /\bdark(?:\s+skin|\s+complexion)\b/,
      'dark',
    ],

    [
      /\bbrown(?:\s+skin|\s+complexion)\b/,
      'dark',
    ],
  ];

  for (const [pattern, value] of patterns) {
    if (pattern.test(normalized)) {
      return value;
    }
  }

  return 'unspecified';
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a natural-language character description into a CharacterSpec.
 *
 * Examples:
 *
 * "A 65 year old male police officer"
 * → male, age 65, police_officer
 *
 * "A young woman firefighter"
 * → female, young_adult, firefighter
 *
 * "An old man wearing a suit"
 * → male, elderly, suit
 *
 * "A little boy"
 * → male, child
 *
 * "A teenage girl with long black hair"
 * → female, teenager, long hair, black hair
 */
export function parseCharacterPrompt(prompt: string): CharacterSpec {
  const spec = createEmptyCharacterSpec(uid('char'));

  const tokens = tokenize(prompt);

  // -----------------------------------------------------------------------
  // Gender
  // -----------------------------------------------------------------------

  const gender = findKeyword(tokens, GENDER_KEYWORDS);

  if (gender) {
    spec.gender = gender;
  }

  // -----------------------------------------------------------------------
  // Age
  // -----------------------------------------------------------------------

  const numericAge = extractNumericAge(prompt);

  if (numericAge !== null) {
    spec.age.exact = numericAge;
    spec.age.category = ageToCategory(numericAge);
  } else {
    const ageCategory = findKeyword(
      tokens,
      AGE_CATEGORY_KEYWORDS,
    );

    if (ageCategory) {
      spec.age.category = ageCategory;
    }
  }

  // -----------------------------------------------------------------------
  // Body build
  // -----------------------------------------------------------------------

  const bodyBuild = findKeyword(
    tokens,
    BODY_BUILD_KEYWORDS,
  );

  if (bodyBuild) {
    spec.bodyBuild = bodyBuild;
  }

  // -----------------------------------------------------------------------
  // Height
  // -----------------------------------------------------------------------

  spec.height = resolveHeight(prompt);

  // -----------------------------------------------------------------------
  // Hair style
  // -----------------------------------------------------------------------

  spec.hair.style = resolveHairStyle(prompt);

  // -----------------------------------------------------------------------
  // Hair color
  // -----------------------------------------------------------------------

  spec.hair.color = resolveHairColor(prompt);

  // -----------------------------------------------------------------------
  // Skin tone
  // -----------------------------------------------------------------------

  spec.skinTone = resolveSkinTone(prompt);

  // -----------------------------------------------------------------------
  // Occupation
  // -----------------------------------------------------------------------

  const occupation = findKeyword(
    tokens,
    OCCUPATION_KEYWORDS,
  );

  if (occupation) {
    spec.occupation = occupation;
  }

  // -----------------------------------------------------------------------
  // Clothing
  // -----------------------------------------------------------------------

  const clothing = findKeyword(
    tokens,
    CLOTHING_KEYWORDS,
  );

  if (clothing) {
    spec.clothing = clothing;
  }

  // -----------------------------------------------------------------------
  // Accessories
  // -----------------------------------------------------------------------

  const accessories = findAllKeywords(
    tokens,
    ACCESSORY_KEYWORDS,
  );

  if (accessories.length > 0) {
    spec.accessories = accessories.map(type => ({
      type,
    }));
  }

  // -----------------------------------------------------------------------
  // Preserve original description
  // -----------------------------------------------------------------------

  spec.notes = prompt;

  return spec;
}