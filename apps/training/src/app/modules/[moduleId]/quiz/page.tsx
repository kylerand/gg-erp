'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Trophy,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';
import {
  getModule,
  submitQuiz,
  type TrainingModule,
  type QuizSubmitResult,
} from '@/lib/api-client';

export default function QuizPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const moduleId = params.moduleId as string;

  const [mod, setMod] = useState<TrainingModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);

  useEffect(() => {
    if (!moduleId) return;
    getModule(moduleId)
      .then((m) => {
        setMod(m);
        setAnswers(new Array(m.knowledgeChecks?.length ?? 0).fill(-1));
      })
      .catch(() => router.push('/modules'))
      .finally(() => setLoading(false));
  }, [moduleId, router]);

  const checks = mod?.knowledgeChecks ?? [];

  async function handleSubmit() {
    if (!user || !mod) return;
    setSubmitting(true);
    try {
      const r = await submitQuiz(moduleId, user.userId, answers);
      setResult(r);
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    setResult(null);
    setAnswers(new Array(checks.length).fill(-1));
    setCurrentQ(0);
  }

  if (loading || !mod) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Results view
  if (result) {
    return (
      <div className="space-y-5">
        <Link
          href={`/modules/${moduleId}`}
          className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back to Module
        </Link>

        <div
          className={`card p-6 text-center ${result.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
        >
          {result.passed ? (
            <Trophy size={48} className="mx-auto text-green-600" />
          ) : (
            <XCircle size={48} className="mx-auto text-red-600" />
          )}
          <h1
            className={`mt-3 text-2xl ${result.passed ? 'text-green-800' : 'text-red-800'}`}
            data-brand-heading="true"
          >
            {result.passed ? 'Congratulations!' : 'Not Quite…'}
          </h1>
          <p
            className={`mt-1 text-sm ${result.passed ? 'text-green-700' : 'text-red-700'}`}
          >
            You scored {result.score}/{result.totalQuestions} ({result.percentage}%)
            {!result.passed && ` — need ${result.passScore}% to pass`}
          </p>

          {!result.passed && (
            <button
              onClick={handleRetry}
              className="mx-auto mt-4 flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white"
            >
              <RotateCcw size={15} /> Retry Quiz
            </button>
          )}
        </div>

        {/* Answer review */}
        <div className="space-y-3">
          {result.answers.map((a, i) => (
            <div
              key={a.questionId}
              className={`card p-4 ${a.isCorrect ? 'border-green-200' : 'border-red-200'}`}
            >
              <div className="flex items-start gap-2">
                {a.isCorrect ? (
                  <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-green-600" />
                ) : (
                  <XCircle size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {i + 1}. {a.question}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your answer: {checks[i]?.options[a.selectedAnswer] ?? `Option ${a.selectedAnswer + 1}`}
                  </p>
                  {!a.isCorrect && (
                    <p className="text-xs font-semibold text-green-700">
                      Correct: {checks[i]?.options[a.correctAnswer] ?? `Option ${a.correctAnswer + 1}`}
                    </p>
                  )}
                  {a.explanation && (
                    <p className="mt-1 text-xs italic text-muted-foreground">{a.explanation}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Quiz view
  const question = checks[currentQ];
  const allAnswered = answers.every((a) => a >= 0);

  return (
    <div className="space-y-5">
      <Link
        href={`/modules/${moduleId}`}
        className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        {mod.moduleName}
      </Link>

      <div>
        <h1 className="text-xl" data-brand-heading="true">
          Knowledge Check
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Question {currentQ + 1} of {checks.length} · {mod.passScore ?? 80}% to pass
        </p>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5">
        {checks.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentQ(i)}
            className={`h-2 flex-1 rounded-full transition-colors ${
              i === currentQ
                ? 'bg-primary'
                : answers[i] >= 0
                  ? 'bg-primary/40'
                  : 'bg-muted'
            }`}
          />
        ))}
      </div>

      {question && (
        <div className="card p-5">
          <h2 className="text-base font-semibold">{question.question}</h2>
          <div className="mt-4 space-y-2">
            {question.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => {
                  const next = [...answers];
                  next[currentQ] = i;
                  setAnswers(next);
                }}
                className={`w-full rounded-xl border p-3 text-left text-sm transition-colors ${
                  answers[currentQ] === i
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-border bg-white text-foreground hover:bg-muted/30'
                }`}
              >
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold">
                  {String.fromCharCode(65 + i)}
                </span>
                {opt}
              </button>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            {currentQ > 0 && (
              <button
                onClick={() => setCurrentQ(currentQ - 1)}
                className="rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground"
              >
                Previous
              </button>
            )}
            <div className="flex-1" />
            {currentQ < checks.length - 1 ? (
              <button
                onClick={() => setCurrentQ(currentQ + 1)}
                disabled={answers[currentQ] < 0}
                className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!allAnswered || submitting}
                className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit Quiz'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
