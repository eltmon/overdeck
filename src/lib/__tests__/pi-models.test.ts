/**
 * pi models.json provisioning and model qualification (PAN-5212).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { provisionPiProviderForModel } from '../pi-models.js'
import { qualifyPiModel } from '../providers.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pan-pi-models-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const read = () => JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'))

describe('provisionPiProviderForModel', () => {
  it('adds missing xai ids under the built-in provider without touching its config', () => {
    provisionPiProviderForModel('grok-build-0.1', dir)
    const xai = read().providers.xai
    expect(xai.models.map((m: { id: string }) => m.id)).toEqual(['grok-build-0.1', 'grok-4.7'])
    expect(xai.models[0]).toMatchObject({ api: 'openai-responses', reasoning: true, contextWindow: 256000 })
    expect(xai).not.toHaveProperty('baseUrl')
    expect(xai).not.toHaveProperty('apiKey')
  })

  it('writes custom providers with a $ENV key reference (pi reads a bare name as a literal key)', () => {
    provisionPiProviderForModel('qwen/qwen3.6-plus', dir)
    expect(read().providers.nous).toMatchObject({ baseUrl: 'https://inference-api.nousresearch.com/v1', api: 'openai-completions', apiKey: '$NOUS_API_KEY' })
    provisionPiProviderForModel('qwen3.8-max', dir)
    expect(read().providers.dashscope.apiKey).toBe('$DASHSCOPE_API_KEY')
  })

  it('keeps the user\'s own models and providers', () => {
    writeFileSync(join(dir, 'models.json'), JSON.stringify({
      providers: {
        ollama: { baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', models: [{ id: 'llama3.1:8b' }] },
        xai: { models: [{ id: 'my-grok' }] },
      },
    }))
    provisionPiProviderForModel('xai/grok-4.7', dir)
    const registry = read()
    expect(registry.providers.ollama.models).toEqual([{ id: 'llama3.1:8b' }])
    expect(registry.providers.xai.models.map((m: { id: string }) => m.id)).toEqual(['my-grok', 'grok-build-0.1', 'grok-4.7'])
  })

  it('is a no-op for providers pi already covers', () => {
    provisionPiProviderForModel('openai/gpt-oss-20b', dir)
    provisionPiProviderForModel('gpt-oss-120b', dir)
    expect(() => read()).toThrow()
  })

  it('refuses to overwrite an unparseable models.json', () => {
    writeFileSync(join(dir, 'models.json'), '{ not json')
    expect(() => provisionPiProviderForModel('grok-4.7', dir)).toThrow(/not valid JSON/)
  })
})

describe('qualifyPiModel', () => {
  it('prefixes OpenRouter vendor/model ids with openrouter (bare ids bind the vendor as provider)', () => {
    expect(qualifyPiModel('openai/gpt-oss-20b-or-only')).toBe('openrouter/openai/gpt-oss-20b-or-only')
    expect(qualifyPiModel('openrouter/fusion')).toBe('openrouter/openrouter/fusion')
  })

  it('prefixes Groq, Cerebras and Mistral ids with their provider', () => {
    expect(qualifyPiModel('openai/gpt-oss-120b')).toBe('groq/openai/gpt-oss-120b')
    expect(qualifyPiModel('gpt-oss-120b')).toBe('cerebras/gpt-oss-120b')
    expect(qualifyPiModel('mistral-large-latest')).toBe('mistral/mistral-large-latest')
  })

  it('qualifies Nous for pi only (omp has no nous provider)', () => {
    expect(qualifyPiModel('qwen/qwen3.6-plus', 'pi')).toBe('nous/qwen/qwen3.6-plus')
    expect(qualifyPiModel('qwen/qwen3.6-plus', 'ohmypi')).toBe('qwen/qwen3.6-plus')
  })

  it('leaves an already-qualified id unchanged', () => {
    expect(qualifyPiModel('xai/grok-4.3')).toBe('xai/grok-4.3')
    expect(qualifyPiModel('openrouter/openai/gpt-oss-20b')).toBe('openrouter/openai/gpt-oss-20b')
    expect(qualifyPiModel('nous/qwen/qwen3.6-plus', 'pi')).toBe('nous/qwen/qwen3.6-plus')
  })
})
