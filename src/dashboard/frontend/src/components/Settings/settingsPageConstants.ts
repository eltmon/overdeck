import {
  Code,
  Beaker,
  Terminal,
  Brain,
  SplitSquareVertical,
  BarChart3,
  Route,
  MessageCircle,
  Key,
  GitBranch,
  Flag,
  Palette,
  Wrench,
  Monitor,
  ShieldCheck,
  Volume2,
  Mic,
  Gauge,
  Globe,
} from 'lucide-react';
import { type BackgroundAiFeature } from './types';
import { type NavItem } from './primitives';

// Tracker definitions
export type TrackerType = 'linear' | 'github' | 'gitlab' | 'rally';
export const TRACKERS: { id: TrackerType; name: string; icon: any; envVar: string; placeholder: string }[] = [
  { id: 'linear', name: 'Linear', icon: BarChart3, envVar: 'LINEAR_API_KEY', placeholder: 'lin_api_...' },
  { id: 'github', name: 'GitHub', icon: Code, envVar: 'GITHUB_TOKEN', placeholder: 'ghp_...' },
  { id: 'gitlab', name: 'GitLab', icon: GitBranch, envVar: 'GITLAB_TOKEN', placeholder: 'glpat-...' },
  { id: 'rally', name: 'Rally', icon: Flag, envVar: 'RALLY_API_KEY', placeholder: '_abc123...' },
];

/** Cost-ledger source tag per background feature (matches the backend tags). */
export const BG_FEATURE_COST_SOURCE: Record<BackgroundAiFeature, string> = {
  conversationTitles: 'background:conversationTitles',
  titleRefinement: 'background:titleRefinement',
  memoryExtraction: 'memory-extraction',
  memoryQueryExpansion: 'background:memoryQueryExpansion',
  conversationEnrichment: 'background:conversationEnrichment',
  sessionEmbeddings: 'background:sessionEmbeddings',
  summaryFork: 'background:summaryFork',
  ttsSummarizer: 'background:ttsSummarizer',
};

export const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'model-routing', label: 'Model Routing', icon: Route },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'cloister', label: 'Cloister', icon: Flag },
  { id: 'remote', label: 'Remote', icon: Globe },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'background-ai', label: 'Background AI', icon: Gauge },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'tts', label: 'TTS', icon: Volume2 },
  { id: 'tracker-keys', label: 'Tracker Keys', icon: GitBranch },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'diff', label: 'Diff', icon: SplitSquareVertical },
  { id: 'desktop', label: 'Desktop App', icon: Monitor },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'experimental', label: 'Experimental', icon: Beaker },
];
