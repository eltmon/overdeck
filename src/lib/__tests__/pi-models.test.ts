/**
 * pi models.json provisioning and model qualification (PAN-5212).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findPiCatalogDataDir, provisionPiProviderForModel } from '../pi-models.js'
import { qualifyPiModel } from '../providers.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pan-pi-models-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const read = () => JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'))
const ids = (provider: { models: Array<{ id: string }> }) => provider.models.map((m) => m.id)

/** A pi-ai catalog data dir shipping `models` for `provider` (pi 1.5 key shape). */
function catalog(provider: string, models: string[]): string {
  const data = join(dir, 'catalog')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, `${provider}.json`), JSON.stringify({
    'openai-responses': Object.fromEntries(models.map((id) => [`chat:${id}`, { id, provider }])),
  }))
  return data
}

describe('provisionPiProviderForModel', () => {
  it('adds missing xai ids under the built-in provider without touching its config', () => {
    provisionPiProviderForModel('grok-build-0.1', { agentDir: dir, catalogDir: null })
    const xai = read().providers.xai
    expect(ids(xai)).toEqual(['grok-build-0.1', 'grok-4.7'])
    expect(xai.models[0]).toMatchObject({ api: 'openai-responses', reasoning: true, contextWindow: 256000 })
    expect(xai).not.toHaveProperty('baseUrl')
    expect(xai).not.toHaveProperty('apiKey')
  })

  it('writes only the ids the installed pi does not ship (an entry would replace a built-in)', () => {
    provisionPiProviderForModel('grok-build-0.1', { agentDir: dir, catalogDir: catalog('xai', ['grok-4.3', 'grok-4.7']) })
    expect(ids(read().providers.xai)).toEqual(['grok-build-0.1'])
  })

  it('removes an Overdeck entry once pi ships the id, but keeps a hand-edited one', () => {
    provisionPiProviderForModel('grok-4.7', { agentDir: dir, catalogDir: null })
    const written = read()
    written.providers.xai.models.push({ id: 'my-grok' })
    written.providers.xai.models[0].name = 'Grok Build (mine)'
    writeFileSync(join(dir, 'models.json'), JSON.stringify(written))

    provisionPiProviderForModel('grok-4.7', { agentDir: dir, catalogDir: catalog('xai', ['grok-4.7', 'grok-build-0.1']) })
    expect(ids(read().providers.xai)).toEqual(['grok-build-0.1', 'my-grok'])
  })

  it('does not create models.json when the installed pi ships every planned id', () => {
    provisionPiProviderForModel('grok-4.7', { agentDir: dir, catalogDir: catalog('xai', ['grok-4.7', 'grok-build-0.1']) })
    expect(() => read()).toThrow()
  })

  it('provisions MiMo under pi\'s token-plan SGP provider', () => {
    provisionPiProviderForModel('mimo-v2.6-pro', { agentDir: dir, catalogDir: null })
    expect(ids(read().providers['xiaomi-token-plan-sgp'])).toContain('mimo-v2.6-pro')
    expect(read().providers).not.toHaveProperty('xiaomi')
  })

  it('writes custom providers with a $ENV key reference (pi reads a bare name as a literal key)', () => {
    provisionPiProviderForModel('qwen/qwen3.6-plus', { agentDir: dir, catalogDir: null })
    expect(read().providers.nous).toMatchObject({ baseUrl: 'https://inference-api.nousresearch.com/v1', api: 'openai-completions', apiKey: '$NOUS_API_KEY' })
    provisionPiProviderForModel('qwen3.8-max', { agentDir: dir, catalogDir: null })
    expect(read().providers.dashscope).toMatchObject({ apiKey: '$DASHSCOPE_API_KEY', compat: { supportsDeveloperRole: false } })
  })

  it('keeps the user\'s own models and providers', () => {
    writeFileSync(join(dir, 'models.json'), JSON.stringify({
      providers: {
        ollama: { baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', models: [{ id: 'llama3.1:8b' }] },
        xai: { models: [{ id: 'my-grok' }] },
      },
    }))
    provisionPiProviderForModel('grok-4.7', { agentDir: dir, catalogDir: null })
    const registry = read()
    expect(registry.providers.ollama.models).toEqual([{ id: 'llama3.1:8b' }])
    expect(ids(registry.providers.xai)).toEqual(['my-grok', 'grok-build-0.1', 'grok-4.7'])
  })

  it('is a no-op for providers pi already covers and for unknown models', () => {
    provisionPiProviderForModel('openai/gpt-oss-20b', { agentDir: dir, catalogDir: null })
    provisionPiProviderForModel('gpt-oss-120b', { agentDir: dir, catalogDir: null })
    provisionPiProviderForModel('totally-unknown-model', { agentDir: dir, catalogDir: null })
    expect(() => read()).toThrow()
  })

  it('refuses to overwrite an unparseable models.json', () => {
    writeFileSync(join(dir, 'models.json'), '{ not json')
    expect(() => provisionPiProviderForModel('grok-4.7', { agentDir: dir, catalogDir: null })).toThrow(/not valid JSON/)
  })
})

describe('findPiCatalogDataDir', () => {
  it('finds pi-ai hoisted beside the pi package (pi 1.5 layout)', () => {
    const pkg = join(dir, 'node_modules', '@earendil-works', 'pi-coding-agent')
    mkdirSync(join(pkg, 'dist', 'bundle'), { recursive: true })
    writeFileSync(join(pkg, 'dist', 'bundle', 'cli.js'), '')
    const data = join(dir, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')
    mkdirSync(data, { recursive: true })
    mkdirSync(join(dir, 'bin'))
    symlinkSync(join(pkg, 'dist', 'bundle', 'cli.js'), join(dir, 'bin', 'pi'))
    expect(findPiCatalogDataDir(join(dir, 'bin'))).toBe(data)
  })

  it('returns null without a pi on PATH', () => {
    expect(findPiCatalogDataDir(join(dir, 'nothing-here'))).toBeNull()
  })
})

describe('qualifyPiModel', () => {
  it('prefixes OpenRouter vendor/model ids with openrouter (bare ids bind the vendor as provider)', () => {
    expect(qualifyPiModel('openai/gpt-oss-20b-or-only')).toBe('openrouter/openai/gpt-oss-20b-or-only')
    expect(qualifyPiModel('openrouter/fusion')).toBe('openrouter/openrouter/fusion')
    // Vendor segments that are also pi providers still route through OpenRouter.
    expect(qualifyPiModel('google/gemini-2.5-flash')).toBe('openrouter/google/gemini-2.5-flash')
    expect(qualifyPiModel('minimax/minimax-m2.7')).toBe('openrouter/minimax/minimax-m2.7')
  })

  it('prefixes Groq, Cerebras and Mistral ids with their provider', () => {
    expect(qualifyPiModel('openai/gpt-oss-120b')).toBe('groq/openai/gpt-oss-120b')
    expect(qualifyPiModel('gpt-oss-120b')).toBe('cerebras/gpt-oss-120b')
    expect(qualifyPiModel('mistral-large-latest')).toBe('mistral/mistral-large-latest')
  })

  it('applies the pi profile overrides for Nous and MiMo, not the omp ones', () => {
    expect(qualifyPiModel('qwen/qwen3.6-plus', 'pi')).toBe('nous/qwen/qwen3.6-plus')
    // omp has no nous provider; its launch keeps the bare id, as before PAN-5212.
    expect(qualifyPiModel('qwen/qwen3.6-plus', 'ohmypi')).toBe('qwen/qwen3.6-plus')
    expect(qualifyPiModel('mimo-v2.6-pro', 'pi')).toBe('xiaomi-token-plan-sgp/mimo-v2.6-pro')
    expect(qualifyPiModel('mimo-v2.6-pro', 'ohmypi')).toBe('xiaomi/mimo-v2.6-pro')
  })
})
