import Link from 'next/link';

interface AnswerDetail {
  questionId: string;
  question: string;
  selectedAnswer: number;
  correctAnswer: number;
  isCorrect: boolean;
  explanation?: string;
}

interface QuizResultsProps {
  result: {
    score: number;
    totalQuestions: number;
    percentage: number;
    passed: boolean;
    passScore: number;
    answers?: AnswerDetail[];
  };
  moduleId: string;
  onRetry?: () => void;
}

export function QuizResults({ result, moduleId, onRetry }: QuizResultsProps) {
  const { score, totalQuestions, percentage, passed, passScore, answers } = result;

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className={`w-28 h-28 rounded-full flex flex-col items-center justify-center border-4
        ${passed ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
        <span className="text-3xl font-bold text-gray-900">{percentage}%</span>
        <span className="text-xs text-gray-500">{score}/{totalQuestions}</span>
      </div>

      <div className="text-center space-y-1">
        <h3 className={`text-xl font-bold ${passed ? 'text-green-700' : 'text-red-700'}`}>
          {passed ? '🎉 Module Complete!' : '📚 Keep Practicing'}
        </h3>
        <p className="text-gray-600 text-sm">
          {passed
            ? `You passed with ${percentage}% (required: ${passScore}%)`
            : `You scored ${percentage}% — need ${passScore}% to pass`}
        </p>
      </div>

      {/* Answer review */}
      {answers && answers.length > 0 && (
        <div className="w-full space-y-3 mt-2">
          {answers.map((a, i) => (
            <div
              key={a.questionId ?? i}
              className={`rounded-lg border p-4 text-sm ${a.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <div className="font-medium text-gray-800 mb-1">{i + 1}. {a.question}</div>
              <div className={`text-xs ${a.isCorrect ? 'text-green-700' : 'text-red-600'}`}>
                {a.isCorrect ? '✓ Correct' : `✗ Incorrect — correct answer was option ${a.correctAnswer + 1}`}
              </div>
              {!a.isCorrect && a.explanation && (
                <div className="text-xs text-gray-600 mt-1 italic">{a.explanation}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        {!passed && (
          onRetry ? (
            <button
              onClick={onRetry}
              className="px-4 py-2 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg transition-colors"
            >
              Retry Quiz
            </button>
          ) : (
            <Link
              href={`/training/${moduleId}/quiz`}
              className="px-4 py-2 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg transition-colors"
            >
              Retry Quiz
            </Link>
          )
        )}
        {passed && (
          <Link
            href="/training"
            className="px-4 py-2 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg transition-colors"
          >
            Back to Training Hub
          </Link>
        )}
        <Link
          href={`/training/${moduleId}`}
          className="px-4 py-2 text-sm font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Module Overview
        </Link>
      </div>
    </div>
  );
}
