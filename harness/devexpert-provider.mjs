// Loaded explicitly by this harness only; does not modify the user's global Pi config.
export default function registerDevExpert(pi) {
  pi.registerProvider('devexpert', {
    name: 'DevExpert Inference',
    baseUrl: 'https://inference.devexpert.io/v1',
    apiKey: '$DEVEXPERT_API_KEY',
    api: 'openai-completions',
    models: [{
      id: 'chat', name: 'DevExpert Chat', reasoning: true, input: ['text'],
      contextWindow: 128_000, maxTokens: 16_384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsDeveloperRole: false }
    }]
  });
}
