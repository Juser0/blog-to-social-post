import { genkit, modelRef } from 'genkit';
import { openAICompatible } from '@genkit-ai/compat-oai';

/**
 * OpenRouter는 공급업체별 모델 ID를 그대로 씁니다.
 * `nvidia/nemotron-3-ultra` 같은 짧은 이름은 없고, 실제로는 550B/A55B 규격이 붙은 ID입니다.
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

export const PLUGIN_NAME = 'openrouter';

export const ai = genkit({
  plugins: [
    openAICompatible({
      name: PLUGIN_NAME,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        // OpenRouter 대시보드의 앱 귀속용 헤더입니다. 없어도 동작합니다.
        'HTTP-Referer': 'https://github.com/genkit-ai/genkit',
        'X-Title': 'Blog to Social',
      },
    }),
  ],
});

/**
 * modelRef 이름은 `<플러그인명>/<OpenRouter 모델 ID>` 형태여야 합니다.
 * 모델 ID 자체에 슬래시가 들어 있어 이름에 슬래시가 두 개 생깁니다.
 */
export const defaultModel = modelRef({ name: `${PLUGIN_NAME}/${DEFAULT_MODEL}` });