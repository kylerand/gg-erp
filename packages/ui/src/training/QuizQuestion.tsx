interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer?: number;
  explanation?: string;
}

interface QuizQuestionProps {
  question: QuizQuestion;
  questionIndex: number;
  totalQuestions: number;
  selectedAnswer: number | null;
  onSelect: (index: number) => void;
  showResult?: boolean;
}

export function QuizQuestion({
  question,
  questionIndex,
  totalQuestions,
  selectedAnswer,
  onSelect,
  showResult = false,
}: QuizQuestionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full bg-yellow-400 text-white text-sm font-bold flex items-center justify-center">
          {questionIndex + 1}
        </span>
        <p className="text-base font-medium text-gray-900 leading-snug">{question.question}</p>
      </div>
      <p className="text-xs text-gray-500 ml-10">Question {questionIndex + 1} of {totalQuestions}</p>
      <div className="space-y-2 ml-10">
        {question.options.map((option, i) => {
          const isSelected = selectedAnswer === i;
          const isCorrect = question.correctAnswer === i;
          let style = 'border-gray-200 bg-white hover:border-yellow-400 hover:bg-yellow-50 cursor-pointer';
          if (showResult) {
            if (isCorrect) style = 'border-green-400 bg-green-50 cursor-default';
            else if (isSelected && !isCorrect) style = 'border-red-400 bg-red-50 cursor-default';
            else style = 'border-gray-200 bg-gray-50 cursor-default opacity-60';
          } else if (isSelected) {
            style = 'border-yellow-400 bg-yellow-50 cursor-pointer';
          }
          return (
            <button
              key={i}
              onClick={() => !showResult && onSelect(i)}
              className={`w-full flex items-center gap-3 p-3 border-2 rounded-lg text-left text-sm transition-all ${style}`}
            >
              <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0
                ${isSelected ? 'border-yellow-500 bg-yellow-500 text-white' : 'border-gray-300 text-gray-500'}`}>
                {String.fromCharCode(65 + i)}
              </span>
              {option}
              {showResult && isCorrect && <span className="ml-auto text-green-600">✓</span>}
              {showResult && isSelected && !isCorrect && <span className="ml-auto text-red-600">✗</span>}
            </button>
          );
        })}
      </div>
      {showResult && question.explanation && (
        <div className="ml-10 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          💡 {question.explanation}
        </div>
      )}
    </div>
  );
}
