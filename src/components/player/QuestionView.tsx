import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { Check } from 'lucide-react';

export const QuestionView: React.FC = () => {
  const { currentQuestion, submitAnswer, myAnswerSubmitted, myAnswerForQuestionId, mySelectedAnswer } = useSocket();
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  
  // Track the last question ID to detect when we get the same question again
  const lastQuestionIdRef = useRef<number | null>(null);

  if (!currentQuestion) {
    return null;
  }

  // Reset state when we get a NEW question (or the same question appearing again)
  useEffect(() => {
    // If this is a different question OR the same question but we haven't submitted yet for this appearance
    if (currentQuestion.id !== lastQuestionIdRef.current) {
      console.log('[QuestionView] New question detected, resetting state:', currentQuestion.id);
      
      // Reset all local state
      setSelectedAnswer(null);
      setSubmitted(false);
      
      // Update our reference to track this question
      lastQuestionIdRef.current = currentQuestion.id;
    }
    
    // Only restore answer state if we actually submitted to THIS specific question appearance
    // and the server confirms we answered this question
    if (myAnswerSubmitted && myAnswerForQuestionId === currentQuestion.id) {
      console.log('[QuestionView] Restoring submitted answer for question:', currentQuestion.id);
      setSubmitted(true);
      if (mySelectedAnswer) {
        setSelectedAnswer(mySelectedAnswer);
      }
    }
  }, [currentQuestion.id, myAnswerSubmitted, myAnswerForQuestionId, mySelectedAnswer]);

  const handleAnswerClick = (answerKey: string) => {
    if (submitted) return;
    setSelectedAnswer(answerKey);
  };

  const handleSubmit = () => {
    if (selectedAnswer && !submitted) {
      console.log('[QuestionView] Submitting answer:', selectedAnswer, 'for question:', currentQuestion.id);
      
      // Optimistic UI: mark submitted immediately so user sees instant feedback.
      setSubmitted(true);
      
      // still send to server and handle failures by reverting the optimistic state
      submitAnswer(currentQuestion.id, selectedAnswer).then((ack) => {
        const ok = ack?.ok ?? true;
        if (!ok) {
          console.error('submitAnswer rejected by server', ack);
          // revert UI so user can try again
          setSubmitted(false);
        } else {
          console.log('[QuestionView] Answer successfully submitted to server');
        }
      }).catch((err) => {
        console.error('submitAnswer error', err);
        setSubmitted(false);
      });
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="flex justify-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`}
            alt="Quantum Logo"
            className="h-20 w-auto"
          />
        </div>

        <div className="bg-gray-900 rounded-lg p-8 shadow-xl border border-[#31b1d8]/20">
          <div className="mb-8">
            <div className="inline-block px-4 py-2 bg-[#31b1d8]/20 rounded-full mb-4">
              <span className="text-[#31b1d8] font-semibold">
                Question {currentQuestion.order}
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-white leading-relaxed">
              {currentQuestion.text}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {currentQuestion.choices.map((choice) => (
              <button
                key={choice.key}
                onClick={() => handleAnswerClick(choice.key)}
                disabled={submitted}
                className={`
                  relative p-6 rounded-lg border-2 text-left transition-all duration-200 transform hover:scale-105
                  ${
                    selectedAnswer === choice.key
                      ? 'bg-[#31b1d8] border-[#31b1d8] text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-[#31b1d8] hover:bg-gray-800/80'
                  }
                  ${submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <div className="flex items-start space-x-3">
                  <div
                    className={`
                    flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold
                    ${
                      selectedAnswer === choice.key
                        ? 'bg-white text-[#31b1d8]'
                        : 'bg-gray-700 text-gray-400'
                    }
                  `}
                  >
                    {choice.key}
                  </div>
                  <span className="flex-1 font-medium">{choice.text}</span>
                  {selectedAnswer === choice.key && (
                    <Check className="w-6 h-6 flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>

          {!submitted ? (
            <button
              onClick={handleSubmit}
              disabled={!selectedAnswer}
              className={`
                w-full py-4 rounded-lg font-semibold text-lg transition duration-200
                ${
                  selectedAnswer
                    ? 'bg-[#31b1d8] hover:bg-[#2a9dbf] text-white transform hover:scale-105'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              Submit Answer
            </button>
          ) : (
            <div className="text-center py-4">
              <p className="text-[#31b1d8] font-semibold text-lg">
                Answer submitted! Waiting for results...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};