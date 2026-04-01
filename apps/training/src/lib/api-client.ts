const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

let _token = '';
export function setAuthToken(t: string | null) {
  _token = t ?? '';
}

function authHeaders(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

async function apiFetch<T>(path: string, init?: RequestInit, fallback?: T): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    if (fallback !== undefined) return fallback;
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types (matching the live ERP API response shapes)
// ---------------------------------------------------------------------------

export interface OjtStep {
  id: string;
  title: string;
  instructions: string;
  videoUrl?: string;
  videoDuration?: number;
  videoThumbnail?: string;
  tools?: string[];
  materials?: string[];
  safetyWarnings?: Array<{ severity: 'danger' | 'warning' | 'caution'; text: string }>;
  commonMistakes?: string[];
  whyItMatters?: string;
  keyTakeaways?: string[];
  diagrams?: Array<{ url: string; caption: string }>;
  requiresConfirmation?: boolean;
  requiresVideoCompletion?: boolean;
}

export interface OjtKnowledgeCheck {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface TrainingModule {
  id: string;
  moduleCode: string;
  moduleName: string;
  description?: string;
  moduleStatus: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  passScore?: number;
  validityDays?: number;
  isRequired: boolean;
  estimatedTime?: string;
  thumbnailUrl?: string;
  prerequisites: string[];
  jobRoles: string[];
  requiresSupervisorSignoff: boolean;
  sortOrder: number;
  steps?: OjtStep[];
  knowledgeChecks?: OjtKnowledgeCheck[];
  createdAt: string;
  updatedAt: string;
}

export interface StepProgressEntry {
  stepId: string;
  status: string;
  videoWatched: boolean;
  videoProgress: number;
  completedAt: string | null;
}

export interface ModuleProgressData {
  moduleId: string;
  employeeId: string;
  status: string;
  currentStep: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: StepProgressEntry[];
  quizAttempts: Array<{
    id: string;
    score: number;
    totalQuestions: number;
    passed: boolean;
    attemptedAt: string;
  }>;
}

export interface QuizSubmitResult {
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  passScore: number;
  answers: Array<{
    questionId: string;
    question: string;
    selectedAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
    explanation?: string;
  }>;
}

export interface TrainingAssignment {
  id: string;
  moduleId: string;
  employeeId: string;
  assignmentStatus: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'EXEMPT' | 'CANCELLED';
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  score?: number;
  module?: { moduleCode: string; moduleName: string; passScore?: number; isRequired: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface OjtNote {
  id: string;
  content: string;
  moduleId: string;
  stepId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listModules(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return apiFetch<{ items: TrainingModule[]; total: number }>(
    `/sop/modules${qs}`,
    undefined,
    { items: [], total: 0 },
  );
}

export async function getModule(idOrCode: string) {
  const data = await apiFetch<{ module: TrainingModule }>(`/sop/modules/${idOrCode}`);
  return data.module;
}

export async function getModuleProgress(moduleIdOrCode: string, employeeId: string) {
  return apiFetch<ModuleProgressData>(
    `/sop/modules/${moduleIdOrCode}/progress/${employeeId}`,
    undefined,
    {
      moduleId: moduleIdOrCode,
      employeeId,
      status: 'not-started',
      currentStep: null,
      startedAt: null,
      completedAt: null,
      steps: [],
      quizAttempts: [],
    },
  );
}

export async function updateStepProgress(
  moduleIdOrCode: string,
  params: {
    employeeId: string;
    stepId: string;
    status?: string;
    videoWatched?: boolean;
    videoProgress?: number;
    completed?: boolean;
  },
) {
  await apiFetch(`/sop/modules/${moduleIdOrCode}/step-progress`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export async function submitQuiz(moduleIdOrCode: string, employeeId: string, answers: number[]) {
  return apiFetch<QuizSubmitResult>(`/sop/modules/${moduleIdOrCode}/quiz`, {
    method: 'POST',
    body: JSON.stringify({ employeeId, answers }),
  });
}

export async function listMyAssignments(employeeId: string) {
  const qs = employeeId ? `?employeeId=${employeeId}` : '';
  return apiFetch<{ items: TrainingAssignment[]; total: number }>(
    `/ojt/assignments${qs}`,
    undefined,
    { items: [], total: 0 },
  );
}

export async function listNotes(employeeId: string, moduleId: string) {
  return apiFetch<{ items: OjtNote[] }>(
    `/sop/notes?employeeId=${employeeId}&moduleId=${moduleId}`,
    undefined,
    { items: [] },
  );
}

export async function saveNote(data: {
  employeeId: string;
  moduleId: string;
  stepId?: string;
  content: string;
}) {
  return apiFetch<OjtNote>('/sop/notes', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteNote(noteId: string) {
  await apiFetch(`/sop/notes/${noteId}`, { method: 'DELETE' });
}

export async function listBookmarks(employeeId: string, moduleId: string) {
  return apiFetch<{
    items: Array<{ id: string; moduleId: string; stepId: string; createdAt: string }>;
  }>(`/sop/bookmarks?employeeId=${employeeId}&moduleId=${moduleId}`, undefined, { items: [] });
}

export async function toggleBookmark(employeeId: string, moduleId: string, stepId: string) {
  return apiFetch<{ bookmarked: boolean }>('/sop/bookmarks', {
    method: 'POST',
    body: JSON.stringify({ employeeId, moduleId, stepId }),
  });
}
