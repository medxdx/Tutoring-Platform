export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Gate {
  type: 'MCQ' | 'SelfCheck';
  question: string;
  imageUrl?: string;
  options?: string[];
  correctIndex?: number;
  correctFeedback?: string;
  wrongFeedback?: string;
  revealText?: string;
}

export interface Step {
  id: string;
  region: Region;
  tips: string[];
  imageUrl?: string;
  gates?: Gate[];
}

export interface FinalAnswer {
  id: string;
  label: string;
  value: number;
  tolerance: number;
}

export interface Question {
  id: string;
  text: string;
  questionImageUrl?: string;
  solutionImageUrl: string;
  finalAnswers: FinalAnswer[];
  steps: Step[];
}

export interface StepInteraction {
  stepId: string;
  attemptsBeforeCorrect: number; 
  wasFixed: boolean; 
  completed: boolean;
}

export interface QuestionResult {
  questionId: string;
  timeTakenSeconds: number;
  finalAnswersStatus: {
    answerId: string;
    label: string;
    isCorrect: boolean;
    userValue: number | null;
  }[];
  stepInteractions: StepInteraction[];
}

export interface SessionReport {
  timestamp: string;
  totalTimeSeconds: number;
  questions: QuestionResult[];
}