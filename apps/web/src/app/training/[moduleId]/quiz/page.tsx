'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { QuizQuestion as QuizQuestionCard, QuizResults } from '@gg-erp/ui';
import {
  getTrainingModule,
  submitQuiz,
  type TrainingModule,
  type OjtKnowledgeCheck,
  type QuizSubmitResult,
} from '@/lib/api-client';

const DEMO_EMPLOYEE_ID = '00000000-0000-0000-0000-000000000001';

export default function QuizPage() {
  const { moduleId } = useParams<{ moduleId: string }>();

  const [module, setModule] = useState<TrainingModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const questions = (module?.knowledgeChecks as OjtKnowledgeCheck[] | undefined) ?? [];

  useEffect(() => {
    getTrainingModule(moduleId)
      .then(setModule)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [moduleId]);

  function handleAnswer(answerIndex: number) {
    const next = [...answers];
    next[currentIndex] = answerIndex;
    setAnswers(next);
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
    }
  }

  function handlePrev() {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
    }
  }

  async function handleSubmit() {
    if (answers.length < questions.length) return;
    setSubmitting(true);
    try {
      const res = await submitQuiz(moduleId, DEMO_EMPLOYEE_ID, answers);
      setResult(res);
      setSubmitted(true);
    } catch (err) {
      console.error('Quiz submission failed', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
        Loading quiz…
      </div>
    );
  }

  if (!module || questions.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 text-sm">No quiz available for this module.</p>
        <Link href={`/training/${moduleId}`} className="text-yellow-600 hover:underline text-sm">
          Back to module
        </Link>
      </div>
    );
  }

  if (submitted && result) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <QuizResults
          result={result}
          moduleId={moduleId}
          onRetry={() => {
            setAnswers([]);
            setCurrentIndex(0);
            setSubmitted(false);
            setResult(null);
          }}
        />
      </div>
    );
  }

  const q = questions[currentIndex];
  const selectedAnswer = answers[currentIndex] ?? -1;
  const allAnswered = answers.length === questions.length && answers.every(a => a >= 0);

  return (
    <div className="max-w-2xl mx-auto py-8">
      {/* Header */}
      <nav className="text-xs text-gray-500 mb-6 flex items-center gap-1.5">
        <Link href="/training" className="hover:text-yellow-600">Training</Link>
        <span>/</span>
        <Link href={`/training/${moduleId}`} className="hover:text-yellow-600">{module.moduleName}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Knowledge Check</span>
      </nav>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-bold text-gray-900 text-lg">Knowledge Check</h1>
          <span className="text-sm text-gray-500">
            {currentIndex + 1} / {questions.length}
          </span>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-6">
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`h-2 flex-1 rounded-full transition-colors ${
                i === currentIndex ? 'bg-yellow-400' :
                answers[i] !== undefined && answers[i] >= 0 ? 'bg-green-400' :
                'bg-gray-200'
              }`}
            />
          ))}
        </div>

        <QuizQuestionCard
          question={q}
          questionIndex={currentIndex}
          totalQuestions={questions.length}
          selectedAnswer={selectedAnswer >= 0 ? selectedAnswer : null}
          onSelect={handleAnswer}
        />

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="px-4 py-2 text-sm text-gray-600 disabled:opacity-40 hover:text-gray-900"
          >
            ← Previous
          </button>

          {currentIndex < questions.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={selectedAnswer < 0}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-40 hover:bg-gray-700"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!allAnswered || submitting}
              className="px-5 py-2 text-sm font-semibold bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg disabled:opacity-40"
            >
              {submitting ? 'Submitting…' : 'Submit Quiz'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
