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
  Trash2,
  KeyRound,
  Mail,
  Smartphone,
  Archive,
} from 'lucide-react';
import { type BackgroundAiFeature } from './types';
import { type NavItem } from './primitives';

// Tracker definitions
/** One Settings row per `tracker_keys` entry; Jira has three (token, email, site) (PAN-5152). */
export type TrackerKeyId = 'linear' | 'github' | 'gitlab' | 'rally' | 'jira' | 'jira_email' | 'jira_base_url';
export type TrackerType = TrackerKeyId;
/** `secret: false` rows (the Jira email and site URL) render as plain text inputs. */
export const TRACKERS: { id: TrackerKeyId; name: string; icon: any; envVar: string; placeholder: string; secret?: boolean }[] = [
  { id: 'linear', name: 'Linear', icon: BarChart3, envVar: 'LINEAR_API_KEY', placeholder: 'lin_api_...' },
  { id: 'github', name: 'GitHub', icon: Code, envVar: 'GITHUB_TOKEN', placeholder: 'ghp_...' },
  { id: 'gitlab', name: 'GitLab', icon: GitBranch, envVar: 'GITLAB_TOKEN', placeholder: 'glpat-...' },
  { id: 'rally', name: 'Rally', icon: Flag, envVar: 'RALLY_API_KEY', placeholder: '_abc123...' },
  { id: 'jira', name: 'Jira API token', icon: KeyRound, envVar: 'JIRA_API_TOKEN', placeholder: 'ATATT3x...' },
  { id: 'jira_email', name: 'Jira account email', icon: Mail, envVar: 'JIRA_EMAIL', placeholder: 'you@company.com', secret: false },
  { id: 'jira_base_url', name: 'Jira site URL', icon: Globe, envVar: 'JIRA_BASE_URL', placeholder: 'https://acme.atlassian.net', secret: false },
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
  jevTurnEndAssessment: 'background:jevTurnEndAssessment',
  jevAcceptanceCriteriaReview: 'background:jevAcceptanceCriteriaReview',
  jevMemoryRelevance: 'background:jevMemoryRelevance',
};

export const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'model-routing', label: 'Model Routing', icon: Route },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'coding-agents', label: 'Coding Agents', icon: Terminal },
  { id: 'tiered-execution', label: 'Tiered Execution', icon: Route },
  { id: 'swarming', label: 'Swarming', icon: GitBranch },
  { id: 'cloister', label: 'Cloister', icon: Flag },
  { id: 'close-out', label: 'Close-out', icon: Trash2 },
  { id: 'session-vault', label: 'Session Vault', icon: Archive },
  { id: 'anywhere', label: 'Anywhere', icon: Smartphone },
  { id: 'remote', label: 'Remote', icon: Globe },
  { id: 'access-tokens', label: 'Access Tokens', icon: KeyRound },
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
  { id: 'telemetry', label: 'Telemetry', icon: BarChart3 },
  { id: 'experimental', label: 'Experimental', icon: Beaker },
];
