/**
 * Character Generator Client — Remote API contract + local mock.
 *
 * Architecture:
 *   D3 Studio text → CharacterSpec JSON → remote generator → GLB → D3 Studio
 *
 * This module defines:
 *   1. The remote API contract (interface + types)
 *   2. A mock implementation for local testing without a server
 *
 * When a real server becomes available, implement `CharacterGeneratorClient`
 * with actual HTTP calls to POST /generate-character.
 */

import { CharacterSpec } from './characterSpec';

// ---------------------------------------------------------------------------
// Remote API Contract
// ---------------------------------------------------------------------------

/**
 * Request body for POST /generate-character
 */
export interface GenerateCharacterRequest {
  /** Character specification parameters. */
  spec: CharacterSpec;
}

/**
 * Response body from POST /generate-character
 */
export interface GenerateCharacterResponse {
  /** Unique identifier for the generated character. */
  characterId: string;
  /** URL where the generated GLB model can be downloaded. */
  modelUrl: string;
  /** Format of the generated model. */
  format: 'glb';
}

/**
 * Interface for the character generator client.
 *
 * Implementations:
 *   - MockCharacterGeneratorClient (local, no server needed)
 *   - RemoteCharacterGeneratorClient (HTTP, future)
 */
export interface ICharacterGeneratorClient {
  /**
   * Generate a character model from a CharacterSpec.
   *
   * @param spec - The character specification parameters.
   * @returns A promise resolving to the generation response.
   */
  generateCharacter(spec: CharacterSpec): Promise<GenerateCharacterResponse>;
}

// ---------------------------------------------------------------------------
// Mock Implementation
// ---------------------------------------------------------------------------

/**
 * Mock character generator client for local development and testing.
 *
 * Does NOT require a remote server. Returns a deterministic mock response
 * based on the input spec. The returned modelUrl points to a placeholder
 * that can be replaced with a real GLB once the remote service is available.
 */
export class MockCharacterGeneratorClient implements ICharacterGeneratorClient {
  private callCount = 0;

  /**
   * Generate a mock character response.
   *
   * In a real implementation, this would:
   *   1. Serialize the CharacterSpec to JSON
   *   2. POST to /generate-character
   *   3. Poll for completion (if async)
   *   4. Return the modelUrl of the generated GLB
   */
  async generateCharacter(spec: CharacterSpec): Promise<GenerateCharacterResponse> {
    this.callCount++;

    // Simulate async work (network delay)
    await new Promise(resolve => setTimeout(resolve, 10));

    // Generate a deterministic character ID from the spec
    const characterId = this.deriveCharacterId(spec);

    // In production, this URL would point to the actual generated GLB
    const modelUrl = this.deriveModelUrl(spec, characterId);

    return {
      characterId,
      modelUrl,
      format: 'glb',
    };
  }

  /**
   * Get the number of times generateCharacter has been called.
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Derive a deterministic character ID from spec parameters.
   */
  private deriveCharacterId(spec: CharacterSpec): string {
    const parts = [
      spec.gender,
      spec.age.category,
      spec.age.exact !== null ? `age${spec.age.exact}` : '',
      spec.bodyBuild !== 'unspecified' ? spec.bodyBuild : '',
      spec.height !== 'unspecified' ? spec.height : '',
      spec.occupation !== 'civilian' ? spec.occupation : '',
      spec.hair.style !== 'unspecified' ? spec.hair.style : '',
      spec.hair.color !== 'unspecified' ? spec.hair.color : '',
      spec.clothing.category !== 'casual' ? spec.clothing.category : '',
    ].filter(Boolean);

    const base = parts.join('_') || 'character';
    return `${base}_${this.callCount.toString(36)}`;
  }

  /**
   * Derive a model URL from spec parameters.
   *
   * In production, this would be the actual URL returned by the server.
   * For now, it's a deterministic placeholder.
   */
  private deriveModelUrl(spec: CharacterSpec, characterId: string): string {
    return `/generated-characters/${characterId}.glb`;
  }
}

// ---------------------------------------------------------------------------
// Remote Implementation (future)
// ---------------------------------------------------------------------------

/**
 * Configuration for the remote character generator client.
 */
export interface RemoteGeneratorConfig {
  /** Base URL of the character generator service. */
  baseUrl: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional API key for authentication. */
  apiKey?: string;
}

/**
 * HTTP-based character generator client for production use.
 *
 * Usage:
 *   const client = new RemoteCharacterGeneratorClient({
 *     baseUrl: 'https://gen.d3studio.io',
 *     apiKey: 'your-key',
 *   });
 *   const result = await client.generateCharacter(spec);
 */
export class RemoteCharacterGeneratorClient implements ICharacterGeneratorClient {
  private config: RemoteGeneratorConfig;

  constructor(config: RemoteGeneratorConfig) {
    this.config = {
      timeoutMs: 30000,
      ...config,
    };
  }

  async generateCharacter(spec: CharacterSpec): Promise<GenerateCharacterResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/generate-character`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ spec } satisfies GenerateCharacterRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Character generation failed: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json() as GenerateCharacterResponse;

      // Validate response shape
      if (!data.characterId || !data.modelUrl || data.format !== 'glb') {
        throw new Error('Invalid response from character generator service');
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type GeneratorClientType = 'mock' | 'remote';

export interface GeneratorFactoryOptions {
  type: GeneratorClientType;
  remoteConfig?: RemoteGeneratorConfig;
}

/**
 * Factory function to create the appropriate generator client.
 *
 * @param options - Configuration for the client.
 * @returns An ICharacterGeneratorClient implementation.
 *
 * @example
 *   // For local development:
 *   const client = createGeneratorClient({ type: 'mock' });
 *
 *   // For production:
 *   const client = createGeneratorClient({
 *     type: 'remote',
 *     remoteConfig: { baseUrl: 'https://gen.d3studio.io' },
 *   });
 */
export function createGeneratorClient(
  options: GeneratorFactoryOptions = { type: 'mock' }
): ICharacterGeneratorClient {
  switch (options.type) {
    case 'mock':
      return new MockCharacterGeneratorClient();
    case 'remote':
      if (!options.remoteConfig) {
        throw new Error('remoteConfig is required for remote generator client');
      }
      return new RemoteCharacterGeneratorClient(options.remoteConfig);
    default:
      throw new Error(`Unknown generator client type: ${options.type}`);
  }
}