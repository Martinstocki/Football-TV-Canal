import * as footballData from './footballData.js';
import * as apiFootball from './apiFootball.js';

const PROVIDERS = {
  'football-data': footballData,
  'api-football': apiFootball,
};

export function getProvider(name = process.env.DATA_PROVIDER || 'football-data') {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unbekannter DATA_PROVIDER "${name}". Erlaubt: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
}

export const providerNames = Object.keys(PROVIDERS);
