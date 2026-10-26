import { useSyncExternalStore } from 'react';
import type { CreatorCategory } from '@/lib/creator-categories';
import type { Discovery } from '@/lib/discover';

// Browser-only projects for Find creators: a named set of brand inputs (one campaign, one
// product line…) and the rankings found with it. Stored like the match history; storage can
// be unavailable (private mode, blocked site data), so every access is guarded.
// Key visuals are not stored: too large for localStorage, and re-uploading is cheap.

const KEY = 'creatorpulse:projects';
const CHANGE_EVENT = 'creatorpulse:projects';
const MAX_PROJECTS = 20;
const MAX_RUNS = 20;
const TOP = 5;

export interface ProjectInputs {
  brandName: string;
  creatorCategory: CreatorCategory;
  referenceBrands: string[];
  brandDescription: string;
}

// A ranking as it was found: enough to compare runs, not the whole evidence.
export interface ProjectRun {
  id: string; // the discovery id
  createdAt: string;
  creatorCategory: CreatorCategory;
  status: Discovery['status'];
  note: string | null; // the brand-side label, e.g. "Scored against your reference brands: …"
  top: { name: string; fitScore: number | null; confidence: string | null }[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  inputs: ProjectInputs;
  runs: ProjectRun[];
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Project[] {
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Project[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PROJECTS)));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Projects are a convenience; the ranking is still shown.
  }
}

export function listProjects(): Project[] {
  return parse(readRaw());
}

export function getProject(id: string): Project | undefined {
  return listProjects().find((p) => p.id === id);
}

export function createProject(name: string, inputs: ProjectInputs): Project {
  const now = new Date().toISOString();
  const project: Project = { id: `project_${Date.now().toString(36)}`, name: name.trim() || inputs.brandName, createdAt: now, updatedAt: now, inputs, runs: [] };
  write([project, ...listProjects()]);
  return project;
}

export function updateInputs(id: string, inputs: ProjectInputs): void {
  write(listProjects().map((p) => (p.id === id ? { ...p, inputs, updatedAt: new Date().toISOString() } : p)));
}

// Newest first; running the same inputs again replaces that run (same discovery id).
export function addRun(id: string, d: Discovery, note: string | null): void {
  const run: ProjectRun = {
    id: d.id,
    createdAt: d.createdAt,
    creatorCategory: d.creatorCategory,
    status: d.status,
    note,
    top: d.candidates.slice(0, TOP).map((c) => ({ name: c.name, fitScore: c.compatibility.fitScore, confidence: c.compatibility.confidence })),
  };
  write(
    listProjects().map((p) =>
      p.id === id ? { ...p, updatedAt: run.createdAt, runs: [run, ...p.runs.filter((r) => r.id !== run.id)].slice(0, MAX_RUNS) } : p
    )
  );
}

export function deleteProject(id: string): void {
  write(listProjects().filter((p) => p.id !== id));
}

// useSyncExternalStore needs a stable snapshot, so re-parse only when the raw string changes.
let cachedRaw: string | null | undefined;
let cachedList: Project[] = [];

function snapshot(): Project[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parse(raw);
  }
  return cachedList;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// null while rendering on the server, where there is no localStorage.
export function useProjects(): Project[] | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
