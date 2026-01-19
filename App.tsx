import React, { useState, useEffect, useRef } from 'react';
import { 
  Question,
  QuestionResult, 
  SessionReport, 
  StepInteraction 
} from './types';
import { SESSION_BASE_URL, SESSION_MAPPING_URL } from './constants';

const MathContent: React.FC<{ html: string; className?: string }> = ({ html, className }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  
  useEffect(() => {
    const render = () => {
      if (containerRef.current && (window as any).MathJax?.typesetPromise) {
        (window as any).MathJax.typesetPromise([containerRef.current]).catch(() => {});
      }
    };
    render();
    const observer = new MutationObserver(render);
    if (containerRef.current) {
      observer.observe(containerRef.current, { childList: true, subtree: true });
    }
    return () => observer.disconnect();
  }, [html]);

  return (
    <span 
      ref={containerRef} 
      className={`math-container tex2jax_process ${className || ''}`} 
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
};

/**
 * A dedicated component for the timer to ensure it ticks continuously
 * without triggering a full App re-render.
 */
const SessionTimer: React.FC<{ startTime: number }> = ({ startTime }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // Initial sync
    setElapsed(Math.floor((Date.now() - startTime) / 1000));
    
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [startTime]);

  return <>{elapsed}s</>;
};

const App: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLanding, setIsLanding] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sessionCode, setSessionCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(Date.now());
  const [questionStartTime, setQuestionStartTime] = useState(Date.now());
  
  const [sessionResults, setSessionResults] = useState<QuestionResult[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [lastValidationResults, setLastValidationResults] = useState<QuestionResult['finalAnswersStatus'] | null>(null);
  
  const [isGuidanceActive, setIsGuidanceActive] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [currentGateIdx, setCurrentGateIdx] = useState(0);
  const [stepInteractions, setStepInteractions] = useState<StepInteraction[]>([]);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' | 'partial' | null }>({ msg: '', type: null });
  const [gateFeedback, setGateFeedback] = useState<{ msg: string; type: 'success' | 'error' | null }>({ msg: '', type: null });
  const [isSolutionRevealed, setIsSolutionRevealed] = useState(false);
  const [showFixPrompt, setShowFixPrompt] = useState(false);
  const [isStepPausedForFix, setIsStepPausedForFix] = useState(false);
  const [firstTryResults, setFirstTryResults] = useState<QuestionResult['finalAnswersStatus'] | null>(null);

  const resolveAssetUrl = (path: string | undefined): string => {
    if (!path) return "";
    if (path.startsWith('http') || path.startsWith('data:')) return path;
    const cleanPath = path.replace(/^\.\//, '');
    const base = SESSION_BASE_URL.endsWith('/') ? SESSION_BASE_URL : `${SESSION_BASE_URL}/`;
    return `${base}${cleanPath}`;
  };

  const startSession = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = sessionCode.trim().toLowerCase();
    if (!cleanCode) return;
    setLoading(true);
    setError(null);

    try {
      const mappingRes = await fetch(`${SESSION_MAPPING_URL}?t=${Date.now()}`);
      if (!mappingRes.ok) throw new Error("Failed to load session mapping.");
      const mapping = await mappingRes.json();

      const normalizedMapping = Object.keys(mapping).reduce((acc, k) => {
        acc[k.toLowerCase()] = mapping[k];
        return acc;
      }, {} as Record<string, string>);

      let questionsUrl = normalizedMapping[cleanCode];
      if (!questionsUrl) throw new Error(`Session "${sessionCode.toUpperCase()}" not found. Make sure the code is written correctly.`);

      if (questionsUrl.includes('gist.github.com')) {
        questionsUrl = questionsUrl.replace('gist.github.com', 'gist.githubusercontent.com');
        if (!questionsUrl.includes('/raw')) {
          questionsUrl = questionsUrl.replace(/\/$/, '') + '/raw';
        }
      }

      const questionsRes = await fetch(`${questionsUrl}${questionsUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
      if (!questionsRes.ok) throw new Error("Error Loading Questions. Try Again or Contact Me.");
      const data = await questionsRes.json();

      setQuestions(data);
      setIsLanding(false);
      setSessionStartTime(Date.now());
    } catch (err: any) {
      console.error("Session load error:", err);
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally { 
      setLoading(false); 
    }
  };

  const currentQuestion: Question | undefined = questions[currentIdx];

  useEffect(() => {
    if (!currentQuestion) return;
    setQuestionStartTime(Date.now());
    setUserAnswers({});
    setLastValidationResults(null);
    setIsGuidanceActive(false);
    setCurrentStepIdx(0);
    setCurrentGateIdx(0);
    setIsSolutionRevealed(false);
    setFeedback({ msg: '', type: null });
    setGateFeedback({ msg: '', type: null });
    setShowFixPrompt(false);
    setIsStepPausedForFix(false);
    setFirstTryResults(null);
    setStepInteractions(currentQuestion.steps.map(s => ({ stepId: s.id, attemptsBeforeCorrect: 0, wasFixed: false, completed: false })));
  }, [currentIdx, questions, currentQuestion]);

  const handleInputChange = (id: string, value: string) => {
    setUserAnswers(prev => ({ ...prev, [id]: value }));
    if (lastValidationResults) {
      setLastValidationResults(prev => prev ? prev.filter(v => v.answerId !== id) : null);
    }
  };

  const validateFinalAnswers = () => {
    if (!currentQuestion) return;
    let correctCount = 0;
    const totalCount = currentQuestion.finalAnswers.length;
    
    const currentResults: QuestionResult['finalAnswersStatus'] = currentQuestion.finalAnswers.map(ans => {
      const inputVal = parseFloat(userAnswers[ans.id] || '');
      const isCorrect = !isNaN(inputVal) && Math.abs(inputVal - ans.value) <= ans.tolerance;
      if (isCorrect) correctCount++;
      return { answerId: ans.id, label: ans.label, isCorrect, userValue: isNaN(inputVal) ? null : inputVal };
    });

    setLastValidationResults(currentResults);
    if (firstTryResults === null) setFirstTryResults(currentResults);

    if (correctCount === totalCount) {
      setFeedback({ msg: 'Brilliant! All answers are correct.', type: 'success' });
      setIsSolutionRevealed(true);
      setIsGuidanceActive(false);
      completeQuestion(firstTryResults || currentResults);
    } else if (correctCount > 0) {
      setFeedback({ msg: `Partially correct (${correctCount}/${totalCount}). Review the guided steps.`, type: 'partial' });
      setIsGuidanceActive(true);
    } else {
      setFeedback({ msg: 'Incorrect. Let\'s work through the steps together.', type: 'error' });
      setIsGuidanceActive(true);
    }
  };

  const completeQuestion = (finalStatus: QuestionResult['finalAnswersStatus']) => {
    if (!currentQuestion) return;
    const result: QuestionResult = {
      questionId: currentQuestion.id,
      timeTakenSeconds: Math.floor((Date.now() - questionStartTime) / 1000),
      finalAnswersStatus: finalStatus,
      stepInteractions: stepInteractions
    };
    setSessionResults(prev => [...prev, result]);
  };

  const handleGateChoice = (choiceIndex: number) => {
    if (!currentQuestion) return;
    const gate = currentQuestion.steps[currentStepIdx]?.gates?.[currentGateIdx];
    if (gate && gate.type === 'MCQ') {
      if (choiceIndex === gate.correctIndex) {
        setGateFeedback({ msg: gate.correctFeedback || 'Correct!', type: 'success' });
        setTimeout(() => { setGateFeedback({ msg: '', type: null }); setCurrentGateIdx(prev => prev + 1); }, 1500);
      } else {
        setGateFeedback({ msg: gate.wrongFeedback || 'Try again!', type: 'error' });
        setStepInteractions(prev => prev.map((si, i) => i === currentStepIdx ? { ...si, attemptsBeforeCorrect: si.attemptsBeforeCorrect + 1 } : si));
      }
    }
  };

  const handleSelfCheckReveal = () => {
    setGateFeedback({ msg: 'Reasoning Revealed', type: 'success' });
    setTimeout(() => { setGateFeedback({ msg: '', type: null }); setCurrentGateIdx(prev => prev + 1); }, 500);
  };

  const moveToNextStep = () => {
    if (!currentQuestion) return;
    setIsStepPausedForFix(false);
    setShowFixPrompt(false);
    if (currentStepIdx < currentQuestion.steps.length - 1) {
      setCurrentStepIdx(prev => prev + 1);
      setCurrentGateIdx(0);
    } else {
      setIsGuidanceActive(false);
      setIsSolutionRevealed(true);
      completeQuestion(firstTryResults || []);
    }
  };

  const handleSelfReport = (gotIt: boolean) => {
    setStepInteractions(prev => prev.map((si, i) => i === currentStepIdx ? { ...si, wasFixed: !gotIt, completed: true } : si));
    if (!gotIt) { setShowFixPrompt(true); setIsStepPausedForFix(true); } 
    else moveToNextStep();
  };

  const downloadReport = () => {
    const report: SessionReport = { timestamp: new Date().toISOString(), totalTimeSeconds: Math.floor((Date.now() - sessionStartTime) / 1000), questions: sessionResults };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report_${sessionCode}.json`;
    a.click();
  };

  if (isLanding) {
    return (
      <div className="min-h-screen bg-[#0f1115] flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-[#5da9ff]/5 rounded-full blur-[120px]" />
        <div className="max-w-xl w-full z-10 text-center">
          <div className="inline-block p-6 rounded-[40px] bg-gradient-to-tr from-[#5da9ff] to-[#7c3aed] shadow-2xl mb-8">
            <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
          </div>
          <h1 className="text-5xl font-black text-white mb-4 uppercase tracking-tighter">Practice Portal</h1>
          <form onSubmit={startSession} className="space-y-4">
            <input type="text" value={sessionCode} onChange={(e) => setSessionCode(e.target.value)} placeholder="ENTER CODE" className="w-full bg-[#171a21] border-2 border-[#2a2f3a] rounded-3xl px-8 py-6 text-3xl font-black text-center text-white focus:border-[#5da9ff] outline-none transition-all uppercase" />
            <button type="submit" disabled={loading || !sessionCode} className="w-full bg-white text-black font-black py-6 rounded-3xl text-xl hover:scale-[1.02] active:scale-0.98 transition-all disabled:opacity-30 uppercase">{loading ? 'CONNECTING...' : 'START'}</button>
          </form>
          {error && <div className="mt-4 text-red-400 font-bold bg-red-500/10 p-4 rounded-2xl border border-red-500/20">⚠️ {error}</div>}
        </div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1115] text-center p-8">
        <div className="bg-[#171a21] border border-[#2a2f3a] p-12 rounded-[40px] shadow-2xl max-w-md w-full">
          <div className="text-7xl mb-6">🎯</div>
          <h2 className="text-3xl font-bold text-white mb-2">Well Done!</h2>
          <p className="text-[#a0a4b8] mb-8">Session completed successfully.</p>
          <button onClick={downloadReport} className="w-full bg-[#5da9ff] text-[#0f1115] font-black py-5 rounded-2xl shadow-xl hover:translate-y-[-2px] transition-all uppercase">Download Report</button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) return null;

  const currentStep = currentQuestion.steps[currentStepIdx];
  const isWaitingForSelfReport = currentStep && (!currentStep.gates || currentGateIdx >= currentStep.gates.length);
  const isRevealedLayout = isGuidanceActive || isSolutionRevealed;

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e6eb] p-4 md:p-8">
      {/* Header */}
      <div className="max-w-[1800px] mx-auto flex justify-between items-center mb-8 bg-[#171a21]/80 backdrop-blur-md p-5 rounded-3xl border border-[#2a2f3a]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-[#5da9ff] to-[#7c3aed] rounded-xl flex items-center justify-center font-black text-white">S</div>
          <div>
            <h1 className="text-lg font-bold leading-none">SmartTutor</h1>
            <span className="text-[10px] text-[#5da9ff] font-bold uppercase tracking-widest">Physics 101</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-[#1f2430] px-4 py-2 rounded-xl border border-[#2a2f3a] font-mono text-sm">
            <span className="text-[#a0a4b8]">TIMER:</span> <SessionTimer startTime={sessionStartTime} />
          </div>
          <div className="bg-[#5da9ff] text-black px-5 py-2 rounded-xl font-black text-sm uppercase">Q {currentIdx + 1} / {questions.length}</div>
        </div>
      </div>

      <div className={`max-w-[1800px] mx-auto relative ${isRevealedLayout ? 'grid grid-cols-1 lg:grid-cols-12 gap-8' : 'flex justify-center'}`}>
        
        {/* Main Column: Problem & Submit */}
        <div className={`flex flex-col gap-8 transition-all duration-700 ${isRevealedLayout ? 'lg:col-span-4 w-full' : 'max-w-3xl w-full'}`}>
          <section className="bg-[#171a21] border border-[#2a2f3a] rounded-[40px] p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#5da9ff]" />
            <h2 className="text-[#5da9ff] uppercase text-[10px] font-black mb-6 tracking-widest">Problem Statement</h2>
            <div className="text-xl leading-relaxed mb-4 block">
              <MathContent html={currentQuestion.text} />
            </div>
            {currentQuestion.questionImageUrl && (
              <div className="mt-6 bg-[#0f1115] rounded-3xl overflow-hidden border border-[#2a2f3a]">
                <img src={resolveAssetUrl(currentQuestion.questionImageUrl)} alt="Question" className="w-full h-auto" />
              </div>
            )}
          </section>

          <section className="bg-[#171a21] border border-[#2a2f3a] rounded-[40px] p-8 shadow-xl">
            <h2 className="text-[#5da9ff] uppercase text-[10px] font-black mb-6 tracking-widest">Submit Results</h2>
            {showFixPrompt && (
              <div className="mb-6 p-5 bg-[#facc15]/10 border-2 border-[#facc15]/30 rounded-2xl text-[#facc15] text-sm font-bold flex items-center gap-3 animate-pulse">
                <span className="text-lg">💡</span>
                <span>Review the tips provided in the middle column and adjust your values below.</span>
              </div>
            )}
            <div className="space-y-4">
              {currentQuestion.finalAnswers.map(ans => {
                const validation = lastValidationResults?.find(v => v.answerId === ans.id);
                const borderClass = validation ? (validation.isCorrect ? 'border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.15)]' : 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.15)]') : 'border-[#2a2f3a]';
                return (
                  <div key={ans.id} className="group">
                    <label className="text-[10px] font-bold text-[#a0a4b8] uppercase mb-1 block px-1 flex justify-between">
                      {ans.label}
                      {validation && (
                        <span className={validation.isCorrect ? 'text-green-500' : 'text-red-500'}>
                          {validation.isCorrect ? '✓ CORRECT' : '✕ INCORRECT'}
                        </span>
                      )}
                    </label>
                    <input type="number" step="any" value={userAnswers[ans.id] || ''} onChange={e => handleInputChange(ans.id, e.target.value)} disabled={isSolutionRevealed} 
                      className={`w-full bg-[#1f2430] border-2 ${borderClass} rounded-2xl px-5 py-4 text-white focus:border-[#5da9ff] outline-none font-mono transition-all`} />
                  </div>
                );
              })}
              <button onClick={validateFinalAnswers} disabled={isSolutionRevealed} className="w-full bg-[#5da9ff] text-black font-black py-5 rounded-2xl mt-4 shadow-lg hover:brightness-110 active:scale-95 transition-all">CHECK ANSWERS</button>
            </div>
            
            {feedback.msg && (
              <div className={`mt-6 p-5 rounded-2xl text-sm font-bold border-2 ${feedback.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/20' : feedback.type === 'partial' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                {feedback.msg}
              </div>
            )}
          </section>
        </div>

        {/* Middle Column: Guidance */}
        {isRevealedLayout && (
          <div className="lg:col-span-4 h-full animate-in slide-in-from-right-8 duration-500">
            <div className="bg-[#171a21] border border-[#2a2f3a] rounded-[40px] p-8 h-full shadow-xl flex flex-col gap-6 sticky top-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <h2 className="text-[#5da9ff] uppercase text-[10px] font-black tracking-widest">Guided Support</h2>
              
              <div className="space-y-10">
                <div className="bg-[#1f2430] p-5 rounded-2xl border border-[#2a2f3a] flex items-center gap-4">
                  <span className="w-8 h-8 rounded-full bg-[#5da9ff] text-black flex items-center justify-center font-bold text-xs">{currentStepIdx + 1}</span>
                  <div>
                    <h3 className="text-[10px] font-black text-[#a0a4b8] uppercase">Current Step</h3>
                    <p className="text-sm font-bold text-white">Conceptual Breakdown</p>
                  </div>
                </div>

                {currentStep?.imageUrl && (
                  <div className="bg-[#0f1115] rounded-3xl overflow-hidden border border-[#2a2f3a]">
                    <img src={resolveAssetUrl(currentStep.imageUrl)} alt="Step Diagram" className="w-full h-auto" />
                  </div>
                )}

                {currentStep?.gates?.map((gate, gIdx) => {
                  if (gIdx > currentGateIdx) return null;
                  const isSolved = gIdx < currentGateIdx;
                  
                  const stateStyles = isSolved 
                    ? (gate.type === 'MCQ' ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100')
                    : 'animate-in fade-in slide-in-from-bottom-4';

                  return (
                    <div key={gIdx} className={`transition-all duration-500 ${stateStyles}`}>
                      <div className="flex items-center gap-2 mb-4">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${isSolved ? 'bg-green-500 text-black' : 'bg-[#5da9ff]/20 text-[#5da9ff] border border-[#5da9ff]/30'}`}>{isSolved ? '✓' : gIdx + 1}</span>
                        <span className="text-[10px] uppercase font-black text-[#a0a4b8]">Check point</span>
                      </div>
                      <div className="mb-6 text-lg font-medium block">
                        <MathContent html={gate.question} />
                      </div>
                      {gate.type === 'MCQ' ? (
                        <div className="grid gap-3">
                          {gate.options?.map((opt, i) => (
                            <button key={i} onClick={() => handleGateChoice(i)} className="text-left bg-[#1f2430] border-2 border-[#2a2f3a] p-5 rounded-2xl hover:border-[#5da9ff] transition-all">
                              <MathContent html={opt} className="text-sm font-medium" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {!isSolved ? (
                            <button onClick={handleSelfCheckReveal} className="w-full py-5 bg-[#5da9ff]/10 border-2 border-[#5da9ff]/30 text-[#5da9ff] font-bold rounded-2xl hover:bg-[#5da9ff]/20 transition-all flex items-center justify-center gap-2 group">
                              <span>Reveal Reasoning</span>
                              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                            </button>
                          ) : (
                            <div className="p-6 bg-[#0f1115] border-2 border-green-500/60 rounded-3xl text-sm leading-relaxed text-[#4ade80] animate-in slide-in-from-top-2 shadow-[0_0_20px_rgba(74,222,128,0.1)]">
                              <MathContent html={gate.revealText || ''} />
                            </div>
                          )}
                        </div>
                      )}
                      {!isSolved && gateFeedback.msg && (
                        <div className={`mt-6 p-4 rounded-xl text-xs font-bold border-2 ${gateFeedback.type === 'success' ? 'bg-green-500/5 text-green-400 border-green-500/20' : 'bg-red-500/5 text-red-400 border-red-500/20'}`}>
                          <MathContent html={gateFeedback.msg} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {isWaitingForSelfReport && (
                  <div className="pt-8 border-t border-[#2a2f3a] animate-in fade-in duration-700">
                    <div className="bg-[#5da9ff]/5 border-2 border-[#5da9ff]/20 p-6 mb-8 rounded-3xl">
                      <h4 className="text-[10px] font-black text-[#5da9ff] mb-4 tracking-widest uppercase text-center">Step Tips</h4>
                      <ul className="space-y-3">
                        {currentStep.tips.map((t, i) => <li key={i} className="text-sm flex gap-3 leading-relaxed"><span className="text-[#5da9ff]">•</span><MathContent html={t} /></li>)}
                      </ul>
                    </div>
                    {!isStepPausedForFix ? (
                      <div className="bg-[#1f2430] p-8 rounded-[32px] border-2 border-dashed border-[#2a2f3a] text-center">
                        <p className="font-bold text-lg mb-6 text-white">Does your answer match?</p>
                        <div className="grid gap-3">
                          <button onClick={() => handleSelfReport(true)} className="py-5 bg-[#4ade80] text-black font-black rounded-2xl hover:brightness-110 transition-all">YES, PROCEED</button>
                          <button onClick={() => handleSelfReport(false)} className="py-5 border-2 border-[#facc15] text-[#facc15] font-black rounded-2xl hover:bg-[#facc15]/10 transition-all">NO, I NEED TO FIX IT</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={moveToNextStep} className="w-full py-5 bg-[#1f2430] text-white border-2 border-[#2a2f3a] font-bold rounded-2xl hover:bg-[#2a2f3a] transition-all flex items-center justify-center gap-2">
                        CONTINUE TO NEXT STEP <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Right Column: Visual Solution */}
        {isRevealedLayout && (
          <div className="lg:col-span-4 transition-all duration-700 animate-in slide-in-from-right-16">
            <div className="relative bg-[#0f1115] rounded-[40px] border-2 border-[#2a2f3a] shadow-2xl overflow-hidden min-h-[400px]">
              <img src={resolveAssetUrl(currentQuestion.solutionImageUrl)} alt="Solution" className="w-full h-auto object-contain max-h-[85vh]" />
              {currentQuestion.steps.map((step, idx) => {
                const revealed = isSolutionRevealed || (isGuidanceActive && idx < currentStepIdx) || (isGuidanceActive && idx === currentStepIdx && isWaitingForSelfReport);
                return (
                  <div key={step.id} className={`absolute bg-[#0f1115] transition-all duration-700 ${revealed ? 'opacity-0' : 'opacity-100'}`} 
                    style={{ left: `${step.region.x * 100}%`, top: `${step.region.y * 100}%`, width: `${step.region.w * 100}%`, height: `${step.region.h * 100}%` }} />
                );
              })}
            </div>
            {isSolutionRevealed && (
              <div className="mt-8 flex justify-center animate-in zoom-in duration-500">
                <button onClick={() => currentIdx < questions.length - 1 ? setCurrentIdx(i => i + 1) : setIsFinished(true)} className="bg-white text-black font-black py-5 px-16 rounded-2xl shadow-2xl hover:scale-105 transition-all uppercase">NEXT QUESTION</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;