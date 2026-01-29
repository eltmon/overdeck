import { Provider, ProvidersConfig, ApiKeysConfig } from '../types';
import { ProviderCard } from './ProviderCard';

export interface ProviderPanelProps {
  providers: ProvidersConfig;
  apiKeys: ApiKeysConfig;
  thinkingLevel: number;
  onProviderToggle: (provider: Provider) => void;
  onApiKeyChange: (provider: Provider, key: string) => void;
  onThinkingLevelChange: (level: number) => void;
  onTestConnection: (provider: Provider) => Promise<void>;
}

const PROVIDER_INFO: Record<
  Provider,
  { displayName: string; icon: string; iconColor: string; compatibility: 'direct' | 'router' }
> = {
  anthropic: { displayName: 'Anthropic', icon: 'auto_awesome', iconColor: '#D97757', compatibility: 'direct' },
  openai: { displayName: 'OpenAI', icon: 'bolt', iconColor: '#10a37f', compatibility: 'router' },
  google: { displayName: 'Google Vertex AI', icon: 'google', iconColor: '#4285F4', compatibility: 'router' },
  zai: { displayName: 'Z.AI (GLM)', icon: 'api', iconColor: '#94a3b8', compatibility: 'direct' },
};

export function ProviderPanel({
  providers,
  apiKeys,
  thinkingLevel,
  onProviderToggle,
  onApiKeyChange,
  onThinkingLevelChange,
  onTestConnection,
}: ProviderPanelProps) {
  const providerList: Provider[] = ['anthropic', 'openai', 'google', 'zai'];

  const getApiKey = (provider: Provider): string | undefined => {
    if (provider === 'anthropic') {
      // Anthropic key comes from environment (ANTHROPIC_API_KEY)
      return 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxx'; // Masked for display
    }
    return apiKeys[provider as keyof ApiKeysConfig];
  };

  const isConnected = (provider: Provider): boolean => {
    const key = getApiKey(provider);
    return !!key && key.length > 0;
  };

  return (
    <section className="mb-12">
      <h2 className="text-2xl font-bold mb-6">AI Model Providers</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {providerList.map((provider) => {
          const info = PROVIDER_INFO[provider];
          return (
            <ProviderCard
              key={provider}
              provider={provider}
              displayName={info.displayName}
              icon={info.icon}
              iconColor={info.iconColor}
              compatibility={info.compatibility}
              enabled={providers[provider]}
              connected={isConnected(provider)}
              apiKey={getApiKey(provider)}
              locked={provider === 'anthropic'} // Anthropic is always enabled
              showThinkingLevel={provider === 'google'}
              thinkingLevel={thinkingLevel}
              onToggle={() => onProviderToggle(provider)}
              onApiKeyChange={(key) => onApiKeyChange(provider, key)}
              onThinkingLevelChange={provider === 'google' ? onThinkingLevelChange : undefined}
              onTestConnection={async () => onTestConnection(provider)}
            />
          );
        })}
      </div>
    </section>
  );
}
