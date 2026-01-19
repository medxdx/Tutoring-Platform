
import React, { useState, useEffect, useRef } from 'react';
import { 
  Question,
  QuestionResult, 
  SessionReport, 
  StepInteraction 
} from './types';
import { SESSION_BASE_URL } from './constants';

const MathContent: React.FC<{ html: string; className?: string }> = ({ html, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const typeset = () => {
    const node = containerRef.current;
    if (node && (window as any).MathJax?.typesetPromise) {
      (window as any).MathJax.typesetPromise([node]).catch((err: any) => console.error(err));
    }
  };
  useEffect(() => {
    typeset();
    const interval = setInterval(() => {
      if ((window as any).MathJax?.typesetPromise) { typeset(); clearInterval(interval); }
    }, 250);
    return () => clearInterval(interval);
  }, [html]);
  return <div ref={containerRef} className={`math-container ${className || ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
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
      const fileName = cleanCode === 'demo' ? 'questions.json' : `${cleanCode}.json`;
      const res = await fetch(`${SESSION_BASE_URL}${fileName}`);
      if (!res.ok) throw new Error(`Session "${sessionCode.toUpperCase()}" not found on server.`);
      const data = await res.json();
      setQuestions(data);
      setIsLanding(false);
      setSessionStartTime(Date.now());
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Unknown connection error');
    } finally { setLoading(false); }
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
    // Clear validation color when user starts typing again
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
      setFeedback({ 
        msg: `Partially correct (${correctCount}/${totalCount}). Review the guided steps.`, 
        type: 'partial' 
      });
      setIsGuidanceActive(true);
    } else {
      setFeedback({ 
        msg: 'Incorrect. Let\'s work through the steps together.', 
        type: 'error' 
      });
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
    const gates = currentQuestion.steps[currentStepIdx]?.gates;
    if (!gates) return;
    
    const gate = gates[currentGateIdx];
    if (gate && gate.type === 'MCQ') {
      const isCorrect = choiceIndex === gate.correctIndex;
      if (isCorrect) {
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
    setTimeout(() => {
      setGateFeedback({ msg: '', type: null });
      setCurrentGateIdx(prev => prev + 1);
    }, 500);
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
    const report: SessionReport = { 
      timestamp: new Date().toISOString(), 
      totalTimeSeconds: Math.floor((Date.now() - sessionStartTime) / 1000), 
      questions: sessionResults 
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${sessionCode}.json`;
    a.click();
  };

  if (isLanding) {
    return (
      <div className="min-h-screen bg-[#0f1115] flex items-center justify-center p-6 relative">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-[#5da9ff]/5 rounded-full blur-[120px]" />
        <div className="max-w-xl w-full z-10 text-center">
          <div className="inline-block p-4 rounded-3xl bg-gradient-to-tr from-[#5da9ff] to-[#7c3aed] shadow-2xl mb-8">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
          </div>
          <h1 className="text-4xl font-black text-white mb-4 uppercase tracking-tighter">Practice Portal</h1>
          <form onSubmit={startSession} className="space-y-6">
            <input type="text" value={sessionCode} onChange={(e) => setSessionCode(e.target.value)} placeholder="Session Code" className="w-full bg-[#171a21]/50 border-2 border-[#2a2f3a] rounded-3xl px-8 py-6 text-2xl font-black text-center text-white tracking-[0.1em] focus:border-[#5da9ff] transition-all uppercase" />
            <button type="submit" disabled={loading || !sessionCode} className="w-full bg-white text-black font-black py-6 rounded-3xl text-xl hover:scale-[1.02] active:scale-0.98 transition-all disabled:opacity-30">{loading ? 'CONNECTING...' : 'START SESSION'}</button>
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
          <div className="text-6xl mb-6">🏆</div>
          <h2 className="text-3xl font-bold text-[#5da9ff] mb-4">Complete!</h2>
          <button onClick={downloadReport} className="w-full bg-[#5da9ff] text-white font-black py-5 rounded-2xl shadow-xl hover:translate-y-[-2px] transition-all">Download Report</button>
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
      <div className="max-w-[1800px] mx-auto flex justify-between items-center mb-10 bg-[#171a21]/80 backdrop-blur-md p-4 rounded-2xl border border-[#2a2f3a]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-[#5da9ff] to-[#7c3aed] rounded-lg" />
          <h1 className="text-xl font-bold">Dashboard</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-mono text-[#a0a4b8]">{Math.floor((Date.now() - sessionStartTime) / 1000)}s</span>
          <div className="bg-[#1f2430] px-4 py-2 rounded-xl font-bold text-[#5da9ff]">{currentIdx + 1} / {questions.length}</div>
        </div>
      </div>

      <div className={`max-w-[1800px] mx-auto relative ${isRevealedLayout ? 'grid grid-cols-1 lg:grid-cols-12 gap-8' : 'flex justify-center'}`}>
        {/* Main Column: Problem & Submit */}
        <div className={`flex flex-col gap-8 transition-all duration-700 ${isRevealedLayout ? 'lg:col-span-4 w-full' : 'max-w-3xl w-full'}`}>
          <section className="bg-[#171a21] border border-[#2a2f3a] rounded-[32px] p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-[#5da9ff]" />
            <h2 className="text-[#5da9ff] uppercase text-[10px] font-black mb-6 tracking-widest">Problem Statement</h2>
            <MathContent html={currentQuestion.text} className="text-xl leading-relaxed mb-4" />
            
            {currentQuestion.questionImageUrl && (
              <div className="mt-6 bg-[#0f1115]/50 rounded-2xl overflow-hidden border border-[#2a2f3a] shadow-inner">
                <img 
                  src={resolveAssetUrl(currentQuestion.questionImageUrl)} 
                  alt="Question Diagram"
                  className="w-full h-auto object-contain max-h-[400px]"
                  loading="lazy"
                />
              </div>
            )}
          </section>

          <section className="bg-[#171a21] border border-[#2a2f3a] rounded-[32px] p-8 shadow-xl relative">
            <h2 className="text-[#5da9ff] uppercase text-[10px] font-black mb-6 tracking-widest">Submit Results</h2>
            {showFixPrompt && (
              <div className="mb-6 p-4 bg-[#facc1511] border border-[#facc1533] rounded-2xl text-[#facc15] text-sm animate-pulse flex items-center gap-3">
                <span>💡</span> Review tips and update your values.
              </div>
            )}
            <div className="space-y-4">
              {currentQuestion.finalAnswers.map(ans => {
                const validation = lastValidationResults?.find(v => v.answerId === ans.id);
                const borderClass = validation 
                  ? (validation.isCorrect ? 'border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]') 
                  : 'border-[#2a2f3a]';

                return (
                  <div key={ans.id} className="flex flex-col gap-1 relative">
                    <label className="text-[10px] font-bold text-[#a0a4b8] uppercase px-1 flex justify-between">
                      {ans.label}
                      {validation && (
                        <span className={validation.isCorrect ? 'text-green-400' : 'text-red-400'}>
                          {validation.isCorrect ? '✓ CORRECT' : '✕ INCORRECT'}
                        </span>
                      )}
                    </label>
                    <input 
                      type="number" 
                      step="any" 
                      value={userAnswers[ans.id] || ''} 
                      onChange={e => handleInputChange(ans.id, e.target.value)} 
                      disabled={isSolutionRevealed} 
                      className={`bg-[#1f2430] border-2 ${borderClass} rounded-2xl px-5 py-4 text-white focus:border-[#5da9ff] outline-none font-mono transition-all duration-300`} 
                    />
                  </div>
                );
              })}
              <button 
                onClick={validateFinalAnswers} 
                disabled={isSolutionRevealed} 
                className="w-full bg-[#5da9ff] text-[#0f1115] font-black py-5 rounded-2xl mt-4 shadow-lg hover:brightness-110 active:scale-95 transition-all"
              >
                CHECK ANSWERS
              </button>
            </div>
            {feedback.msg && (
              <div className={`mt-6 p-5 rounded-2xl text-sm font-bold border-2 animate-in slide-in-from-top-4 duration-500 ${
                feedback.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 
                feedback.type === 'partial' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                'bg-red-500/10 text-red-400 border-red-500/20'
              }`}>
                {feedback.msg}
              </div>
            )}
          </section>
        </div>

        {/* Middle Column: Guidance */}
        {isRevealedLayout && (
          <div className="lg:col-span-4 h-full animate-in slide-in-from-right-8 duration-500">
            <div className="bg-[#171a21] border border-[#2a2f3a] rounded-[32px] p-8 h-full shadow-xl flex flex-col gap-6 sticky top-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <h2 className="text-[#5da9ff] uppercase text-[10px] font-black tracking-widest">Guided Support</h2>
              
              <div className="space-y-10">
                <div className="bg-[#1f2430] p-5 rounded-2xl border border-[#2a2f3a]">
                  <h3 className="text-xs font-black text-[#5da9ff] uppercase mb-1">Step {currentStepIdx + 1}</h3>
                  <p className="text-sm font-bold text-white">Conceptual Breakdown</p>
                </div>

                {currentStep?.imageUrl && (
                  <div className="bg-[#0f1115]/50 rounded-2xl overflow-hidden border border-[#2a2f3a] mb-4">
                    <img src={resolveAssetUrl(currentStep.imageUrl)} alt="Step Diagram" className="w-full h-auto" />
                  </div>
                )}

                {currentStep?.gates?.map((gate, gIdx) => {
                  if (gIdx > currentGateIdx) return null;
                  const isSolved = gIdx < currentGateIdx;
                  return (
                    <div key={gIdx} className={`transition-all duration-500 ${isSolved ? 'opacity-40 grayscale pointer-events-none' : 'animate-in fade-in slide-in-from-bottom-4'}`}>
                      <div className="flex items-center gap-2 mb-4">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isSolved ? 'bg-green-500 text-black' : 'bg-[#5da9ff] text-black'}`}>{isSolved ? '✓' : gIdx + 1}</span>
                        <span className="text-[10px] uppercase font-black text-[#a0a4b8]">Check {gIdx + 1}</span>
                      </div>
                      
                      {gate.imageUrl && !isSolved && (
                        <div className="bg-[#0f1115]/50 rounded-xl overflow-hidden border border-[#2a2f3a] mb-4">
                          <img src={resolveAssetUrl(gate.imageUrl)} alt="Check Diagram" className="w-full h-auto" />
                        </div>
                      )}

                      <MathContent html={gate.question} className="mb-6 text-lg font-medium" />

                      {gate.type === 'MCQ' ? (
                        <div className="grid gap-3">
                          {gate.options?.map((opt, i) => (
                            <button key={i} onClick={() => handleGateChoice(i)} className="text-left bg-[#1f2430] border-2 border-[#2a2f3a] p-4 rounded-xl hover:border-[#5da9ff44] transition-all">
                              <MathContent html={opt} className="text-sm" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {!isSolved ? (
                            <button onClick={handleSelfCheckReveal} className="w-full flex items-center justify-center gap-3 py-4 bg-[#5da9ff]/10 border-2 border-[#5da9ff]/30 text-[#5da9ff] font-bold rounded-xl hover:bg-[#5da9ff]/20 transition-all group">
                              <span>🧠 Reveal Reasoning</span>
                              <svg className="w-5 h-5 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                            </button>
                          ) : (
                            <div className="p-5 bg-[#0f1115] border border-green-500/20 rounded-xl text-sm leading-relaxed text-[#4ade80] animate-in slide-in-from-top-2">
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
                    <div className="bg-[#5da9ff]/5 border-l-4 border-[#5da9ff] p-6 mb-8 rounded-2xl">
                      <h4 className="text-[10px] font-black text-[#5da9ff] mb-3 tracking-widest uppercase">Solution Logic</h4>
                      <ul className="space-y-3">
                        {currentStep.tips.map((t, i) => <li key={i} className="text-sm flex gap-2"><span className="text-[#5da9ff]">•</span><MathContent html={t} /></li>)}
                      </ul>
                    </div>
                    
                    {!isStepPausedForFix ? (
                      <div className="bg-[#1f2430] p-8 rounded-3xl border-2 border-dashed border-[#2a2f3a] text-center">
                        <p className="font-bold text-lg mb-6">Does your logic match?</p>
                        <div className="grid gap-4">
                          <button onClick={() => handleSelfReport(true)} className="py-4 bg-[#4ade80] text-black font-black rounded-2xl hover:scale-[1.02] active:scale-0.98 transition-all">YES, PROCEED</button>
                          <button onClick={() => handleSelfReport(false)} className="group relative py-4 border-2 border-[#facc15] bg-[#facc15]/5 text-[#facc15] font-black rounded-2xl overflow-hidden hover:bg-[#facc15]/10">
                            <span className="relative z-10 flex items-center justify-center gap-2">NO, I NEED TO FIX IT <span className="text-xl animate-ping">!</span></span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={moveToNextStep} className="w-full py-5 bg-[#1f2430] text-white border-2 border-[#2a2f3a] font-bold rounded-2xl hover:bg-[#2a2f3a] transition-all flex items-center justify-center gap-2">
                        CONTINUE TO NEXT STEP <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
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
            <div className="relative bg-[#0f1115] rounded-[32px] border-2 border-[#2a2f3a] shadow-2xl overflow-hidden group min-h-[300px]">
              <img 
                src={resolveAssetUrl(currentQuestion.solutionImageUrl)} 
                alt="Solution Workspace"
                className="w-full h-auto object-contain max-h-[85vh]" 
              />
              {currentQuestion.steps.map((step, idx) => {
                const revealed = isSolutionRevealed || (isGuidanceActive && idx < currentStepIdx) || (isGuidanceActive && idx === currentStepIdx && isWaitingForSelfReport);
                return (
                  <div 
                    key={step.id} 
                    className={`absolute bg-[#0f1115] transition-all duration-700 ${revealed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} 
                    style={{ 
                      left: `${step.region.x * 100}%`, 
                      top: `${step.region.y * 100}%`, 
                      width: `${step.region.w * 100}%`, 
                      height: `${step.region.h * 100}%`, 
                      border: isGuidanceActive && idx === currentStepIdx ? '2px solid #5da9ff' : 'none' 
                    }} 
                  />
                );
              })}
            </div>
            {isSolutionRevealed && (
              <div className="mt-8 flex justify-center animate-in zoom-in duration-500">
                <button onClick={() => currentIdx < questions.length - 1 ? setCurrentIdx(i => i + 1) : setIsFinished(true)} className="bg-white text-black font-black py-5 px-16 rounded-2xl shadow-2xl hover:scale-105 transition-all">NEXT QUESTION</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
