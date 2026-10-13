'use client';

import { useEffect, useRef, useState } from 'react';

const STEPS = ['블로그 본문 텍스트 추출', '핵심 요약 및 태그 생성 중', 'SNS별 콘텐츠 변환'];

/** 고른 플랫폼이 없으면 모든 플랫폼을 다룬다고 안내합니다. */
const FALLBACK_LABELS = ['LinkedIn', 'X', 'Instagram', '리마인더'];

type StepState = 'pending' | 'active' | 'done';

/** 단계 전환 시점(초). 서버가 진행률을 스트리밍하지 않아 시간 기준으로 근사합니다. */
const STEP_TIMINGS_MS = [1_400, 7_500];

/** 시간이 지나도 실제 응답 전에는 95%에서 멈춥니다. 완료는 서버 응답으로만 확정됩니다. */
const MAX_ESTIMATED_PERCENT = 95;

function stepStateAt(elapsed: number, index: number): StepState {
  const start = index === 0 ? 0 : STEP_TIMINGS_MS[index - 1];
  const end = index < STEP_TIMINGS_MS.length ? STEP_TIMINGS_MS[index] : Number.POSITIVE_INFINITY;

  if (elapsed >= end) return 'done';
  if (elapsed >= start) return 'active';
  return 'pending';
}

function estimatedPercent(elapsed: number): number {
  const bounds = [0, ...STEP_TIMINGS_MS, 12_000];
  const segment = bounds.findIndex((b, i) => i + 1 < bounds.length && elapsed < bounds[i + 1]);

  if (segment === -1) {
    // 마지막 구간은 95%까지 천천히 올라가며 멈춥니다.
    return MAX_ESTIMATED_PERCENT;
  }

  const from = bounds[segment];
  const to = Math.min(bounds[segment + 1], 12_000);
  const ratio = (elapsed - from) / Math.max(1, to - from);
  const startPercent = [5, 28, 62][segment] ?? 5;
  const endPercent = [28, 62, 95][segment] ?? 95;

  return Math.round(startPercent + (endPercent - startPercent) * Math.min(1, ratio));
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  remember: '리마인더',
  twitter: 'X',
  instagram: 'Instagram',
};

export function ConversionOverlay({
  articleTitle,
  platforms,
  onCancel,
}: {
  articleTitle: string;
  platforms: readonly string[];
  onCancel: () => void;
}) {
  const startedAt = useRef<number>(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(timer);
  }, []);

  // 렌더 중 Date.now()를 직접 부르면 서버/클라이언트 값이 어긋나 hydration이 깨집니다.
  const elapsed = now - startedAt.current;

  // 뒤쪽 배경이 스크롤되지 않도록 고정합니다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const percent = estimatedPercent(elapsed);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="변환 진행 중">
      <div className="overlay-card">
        <span className="overlay-icon">
          <span className="spinner" />
        </span>

        <h2 className="overlay-title">컨텐츠 변환 중...</h2>
        <p className="overlay-subject" title={articleTitle}>
          {articleTitle}
        </p>
        <p className="overlay-desc">
          글 내용을 분석해{' '}
          {(platforms.length > 0 ? platforms.map((p) => PLATFORM_LABELS[p] ?? p) : FALLBACK_LABELS).join(
            ', ',
          )}{' '}
          형식으로 작성하고 있습니다.
        </p>

        <div className="overlay-progress">
          <div className="progress-head">
            <span className="progress-label">
              <span className="progress-dot" />
              진행 상태
            </span>
            <span className="progress-value">{percent}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <ol className="overlay-steps">
          {STEPS.map((label, index) => {
            const state = stepStateAt(elapsed, index);
            return (
              <li key={label} className={`step ${state}`}>
                <span className="step-icon">
                  {state === 'done' ? '✓' : state === 'active' ? <span className="spinner small" /> : ''}
                </span>
                <span className="step-label">{label}</span>
                <span className="step-status">
                  {state === 'done' ? (
                    <span className="badge done">완료</span>
                  ) : state === 'active' ? (
                    <span className="badge active">처리중</span>
                  ) : (
                    <span className="badge pending">대기</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <button type="button" className="cancel-btn" onClick={onCancel}>
          취소하기
        </button>
      </div>
    </div>
  );
}