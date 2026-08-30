/**
 * CharacterSpec — Parameterized character definition.
 *
 * This interface represents a character as a set of generation parameters,
 * NOT as a reference to a fixed model. A remote generator service will
 * use these parameters to procedurally produce a unique GLB at runtime.
 *
 * Architecture:
 *   D3 Studio text → CharacterSpec JSON → remote generator → GLB → D3 Studio
 */

export type Gender = 'male' | 'female' | 'non_binary' | 'unspecified';

export type AgeCategory =
  | 'infant'
  | 'child'
  | 'teenager'
  | 'young_adult'
  | 'adult'
  | 'middle_aged'
  | 'senior'
  | 'elderly'
  | 'unspecified';

export type BodyBuild =
  | 'slim'
  | 'athletic'
  | 'average'
  | 'stocky'
  | 'heavy'
  | 'unspecified';

export type HeightCategory =
  | 'short'
  | 'below_average'
  | 'average'
  | 'above_average'
  | 'tall'
  | 'unspecified';

export type HairStyle =
  | 'bald'
  | 'buzzcut'
  | 'short'
  | 'medium'
  | 'long'
  | 'ponytail'
  | 'bun'
  | 'braided'
  | 'curly'
  | 'wavy'
  | 'afro'
  | 'mohawk'
  | 'unspecified';

export type HairColor =
  | 'black'
  | 'dark_brown'
  | 'brown'
  | 'light_brown'
  | 'auburn'
  | 'red'
  | 'strawberry_blonde'
  | 'blonde'
  | 'platinum'
  | 'gray'
  | 'white'
  | 'blue'
  | 'pink'
  | 'purple'
  | 'green'
  | 'unspecified';

export type SkinTone =
  | 'very_light'
  | 'light'
  | 'medium_light'
  | 'medium'
  | 'medium_dark'
  | 'dark'
  | 'very_dark'
  | 'unspecified';

export type ClothingItem = {
  category: string;       // e.g. 'uniform', 'suit', 'casual', 'armor', 'medical'
  description: string;    // e.g. 'police uniform', 'business suit', 't-shirt and jeans'
  color?: string;         // optional hex or named color
};

export type Accessory = {
  type: string;           // e.g. 'glasses', 'hat', 'watch', 'badge', 'helmet'
  description?: string;
};

/**
 * Core character specification.
 * All fields are parameters for procedural generation.
 */
export interface CharacterSpec {
  /** Unique identifier for this character request. */
  id: string;

  /** Gender parameter for the generator. */
  gender: Gender;

  /** Approximate age — either a numeric value or a category. */
  age: {
    category: AgeCategory;
    /** Exact age in years if known, otherwise null. */
    exact: number | null;
  };

  /** Body build / physique. */
  bodyBuild: BodyBuild;

  /** Height category. */
  height: HeightCategory;

  /** Hair parameters. */
  hair: {
    style: HairStyle;
    color: HairColor;
  };

  /** Skin tone. */
  skinTone: SkinTone;

  /** Clothing description. */
  clothing: ClothingItem;

  /** Occupation or role — drives uniform/props generation. */
  occupation: string;

  /** Optional accessories. */
  accessories: Accessory[];

  /** Free-form notes for the generator (mood, context, etc.). */
  notes: string;
}

/**
 * Creates a minimal valid CharacterSpec with sensible defaults.
 * Callers should override every field relevant to their use case.
 */
export function createEmptyCharacterSpec(id: string): CharacterSpec {
  return {
    id,
    gender: 'unspecified',
    age: { category: 'unspecified', exact: null },
    bodyBuild: 'unspecified',
    height: 'unspecified',
    hair: { style: 'unspecified', color: 'unspecified' },
    skinTone: 'unspecified',
    clothing: { category: 'casual', description: 'plain clothes' },
    occupation: 'civilian',
    accessories: [],
    notes: '',
  };
}