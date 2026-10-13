import { NextResponse } from 'next/server';
import { createChatModel, DEFAULT_MODEL } from '@/lib/ai';
import { appendMeasurementJsonl, estimateCostUsd, normalizeUsage } from '@/lib/measure';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 프레임워크 비교용 얇은 어댑터. GenKit의 POST /chat과 같은 스펙이다.
 * POST /chat {prompt, model?, maxTokens?}
 *   → {output, usage, latencyMs, attempts, model, costUsd}
 * 하네스가 순수 연결 성능을 잴 수 있도록 재시도 없이 1회만 호출한다.
 */
export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
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
    const message = await createChatModel(modelId, maxTokens).invoke(prompt);
    const output = messageContentToString(message.content);

    const latencyMs = Date.now() - startedAt;
    const usage = normalizeUsage(message.usage_metadata);
    const measurement = {
      model: modelId,
      latencyMs,
      attempts: 1,
      usage,
      costUsd: estimateCostUsd(modelId, usage),
    };

    appendMeasurementJsonl({
      kind: 'chat',
      at: new Date(startedAt).toISOString(),
      promptChars: prompt.length,
      outputChars: output.length,
      ...measurement,
    });

    return NextResponse.json({ output, ...measurement });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('[chat adapter]', error);
    return NextResponse.json({ error: message, latencyMs: Date.now() - startedAt }, { status: 500 });
  }
}

/** LangChain 메시지 content(문자열 또는 파트 배열)를 문자열로 바꾼다. */
function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

interface ChatBody {
  prompt?: unknown;
  model?: unknown;
  maxTokens?: unknown;
}
