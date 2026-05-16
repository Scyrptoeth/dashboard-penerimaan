import {
  createEmptyState,
  type DashboardState,
  validateImportedState,
} from "@/lib/domain";

const STATE_KEY = "dashboard-penerimaan:state:v1";
const UNDO_KEY = "dashboard-penerimaan:undo:v1";

export function loadStoredState(): DashboardState {
  if (typeof window === "undefined") {
    return createEmptyState();
  }

  const raw = window.localStorage.getItem(STATE_KEY);
  if (!raw) {
    return createEmptyState();
  }

  try {
    return validateImportedState(JSON.parse(raw));
  } catch {
    return createEmptyState();
  }
}

export function saveStoredState(state: DashboardState): void {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function saveUndoState(state: DashboardState): void {
  window.localStorage.setItem(UNDO_KEY, JSON.stringify(state));
}

export function loadUndoState(): DashboardState | null {
  const raw = window.localStorage.getItem(UNDO_KEY);
  if (!raw) {
    return null;
  }

  try {
    return validateImportedState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearStoredState(): void {
  window.localStorage.removeItem(STATE_KEY);
  window.localStorage.removeItem(UNDO_KEY);
}
