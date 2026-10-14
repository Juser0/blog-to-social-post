import { NextResponse } from 'next/server';
import { adapter, MODEL as DEFAULT_MODEL, missingApiKeyReason } from '@/lib/adapters/index';
import { LINK } from '@/lib/link';
import { appendMeasurementJsonl, estimateCostUsd } from '@/lib/measure';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 프레임워크 비교용 얇은 어댑터. 부팅 시 고른 link(genkit|langchain)로 1회 호출한다.
 * POST /chat {prompt, model?, maxTokens?}
 *   → {output, usage, latencyMs, attempts, model, costUsd, link}
 * 하네스가 순수 연결 성능을 잴 수 있도록 재시도 없이 1회만 호출한다.
 */
export async function POST(request: Request) {
  const keyReason = missingApiKeyReason();
  if (keyReason) {
    return NextResponse.json({ error: keyReason }, { status: 500 });
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 본문입니다.' }, { status: 400 });
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  if (prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt가 필요합니다.' }, { status: 400 });
  }

  const modelId = typeof body?.model === 'string' && body.model.length > 0 ? body.model : DEFAULT_MODEL;
  const maxTokens = typeof body?.maxTokens === 'number' && body.maxTokens > 0 ? Math.floor(body.maxTokens) : 1024;

  const startedAt = Date.now();
  try {
    const { text: output, usage } = await adapter.chat(prompt, { modelId, maxTokens });

    const latencyMs = Date.now() - startedAt;
    const measurement = {
      model: modelId,
      latencyMs,
      attempts: 1,
      usage,
      costUsd: estimateCostUsd(modelId, usage),
    };

    appendMeasurementJsonl(
      {
        kind: 'chat',
        at: new Date(startedAt).toISOString(),
        promptChars: prompt.length,
        outputChars: output.length,
        ...measurement,
      },
      `${LINK}.jsonl`,
    );

    return NextResponse.json({ output, link: LINK, ...measurement });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error(`[chat adapter:${LINK}]`, error);
    return NextResponse.json({ error: message, latencyMs: Date.now() - startedAt }, { status: 500 });
  }
}

interface ChatBody {
  prompt?: unknown;
  model?: unknown;
  maxTokens?: unknown;
}
