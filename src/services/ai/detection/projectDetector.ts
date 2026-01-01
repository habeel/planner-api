/**
 * Project Detection Module
 *
 * Analyzes user messages to detect when they're describing a large initiative
 * that would benefit from structured project planning with the wizard.
 */

export interface ProjectSignals {
  scaleKeywords: string[];
  multiComponent: boolean;
  timelineHints: boolean;
  uncertaintyMarkers: boolean;
}

export interface ProjectDetectionResult {
  isLargeProject: boolean;
  confidence: number; // 0-1
  signals: ProjectSignals;
  suggestedName?: string;
  suggestedEpics?: string[];
}

const SCALE_KEYWORDS = [
  // Modernization/migration keywords
  'rewrite',
  'rebuild',
  'migration',
  'migrate',
  'overhaul',
  'initiative',
  'platform',
  'modernize',
  'modernization',
  'new system',
  'from scratch',
  'greenfield',
  'replace',
  'redesign',
  'rearchitect',
  'refactor entire',
  'major project',
  // New application building keywords
  'build a',
  'building a',
  'create a',
  'creating a',
  'develop a',
  'developing a',
  'new app',
  'new application',
  'new product',
  'new platform',
  'plan all',
  'plan the features',
  'plan out',
  'build a backlog',
  'feature planning',
  'mvp',
  'startup',
  'from the ground up',
];

const MULTI_COMPONENT_PATTERNS = [
  /frontend\s+and\s+backend/i,
  /multiple\s+(services?|components?|teams?|systems?)/i,
  /\band\b.*\band\b/i, // "auth and pricing and billing"
  /across\s+(the\s+)?(entire\s+)?/i,
  /full[\s-]?stack/i,
  /end[\s-]?to[\s-]?end/i,
  // Feature listing patterns
  /(?:features?|modules?)\s*(?:like|such as|including|for this|:)/i,
  /plan\s+(?:all\s+)?(?:the\s+)?features?/i,
  /build\s+a\s+backlog/i,
];

const TIMELINE_PATTERNS = [
  /q[1-4]\s*(20\d{2})?/i,
  /next\s+(quarter|month|year)/i,
  /\d+\s*(weeks?|months?)/i,
  /multi[\s-]?(phase|month|quarter)/i,
  /roadmap/i,
  /long[\s-]?term/i,
];

const UNCERTAINTY_PATTERNS = [
  /mess/i,
  /legacy/i,
  /technical\s+debt/i,
  /needs?\s+(to\s+be\s+)?(moderniz|updat|rewrit|replac)/i,
  /don'?t\s+know\s+where\s+to\s+start/i,
  /overwhelming/i,
  /complex/i,
  /complicated/i,
];

export function detectLargeProject(message: string): ProjectDetectionResult {
  const lowerMessage = message.toLowerCase();

  // Check scale keywords
  const scaleKeywords = SCALE_KEYWORDS.filter((kw) =>
    lowerMessage.includes(kw.toLowerCase())
  );

  // Check multi-component
  const multiComponent = MULTI_COMPONENT_PATTERNS.some((pattern) =>
    pattern.test(message)
  );

  // Check timeline hints
  const timelineHints = TIMELINE_PATTERNS.some((pattern) =>
    pattern.test(message)
  );

  // Check uncertainty markers
  const uncertaintyMarkers = UNCERTAINTY_PATTERNS.some((pattern) =>
    pattern.test(message)
  );

  const signals: ProjectSignals = {
    scaleKeywords,
    multiComponent,
    timelineHints,
    uncertaintyMarkers,
  };

  // Calculate confidence
  let confidence = 0;

  if (scaleKeywords.length > 0) confidence += 0.4;
  if (scaleKeywords.length > 1) confidence += 0.1;
  if (multiComponent) confidence += 0.25;
  if (timelineHints) confidence += 0.15;
  if (uncertaintyMarkers) confidence += 0.1;

  confidence = Math.min(confidence, 1);

  const isLargeProject = confidence >= 0.5;

  // Try to extract a suggested name
  const suggestedName = extractProjectName(message);

  // Try to extract suggested epics
  const suggestedEpics = extractSuggestedEpics(message);

  return {
    isLargeProject,
    confidence,
    signals,
    suggestedName,
    suggestedEpics: suggestedEpics.length > 0 ? suggestedEpics : undefined,
  };
}

function extractProjectName(message: string): string | undefined {
  // Look for patterns like "rewrite of X", "X migration", "X modernization"
  const patterns = [
    /(?:rewrite|rebuild|migration|modernization)\s+(?:of\s+)?(?:our\s+|the\s+)?([a-z\s]+?)(?:\s+[-–]|\s+is|\s+needs|$)/i,
    /(?:our|the)\s+([a-z\s]+?)\s+(?:needs|is\s+a\s+mess|rewrite|migration)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 50) {
        return name.charAt(0).toUpperCase() + name.slice(1) + ' Modernization';
      }
    }
  }

  return undefined;
}

function extractSuggestedEpics(message: string): string[] {
  const epics: string[] = [];

  // Look for component mentions
  const componentPatterns: Array<{ pattern: RegExp; epicName: string }> = [
    { pattern: /(?:auth(?:entication)?|login|users?)/i, epicName: 'Authentication & User Management' },
    { pattern: /(?:payment|billing|subscription|pricing)/i, epicName: 'Billing & Payments' },
    { pattern: /(?:api|backend|server)/i, epicName: 'API Layer' },
    { pattern: /(?:frontend|ui|dashboard)/i, epicName: 'Frontend/UI' },
    { pattern: /(?:database|data\s*migration|schema)/i, epicName: 'Data Migration' },
    { pattern: /(?:notification|email|messaging)/i, epicName: 'Notifications' },
    { pattern: /(?:integration|third[\s-]?party)/i, epicName: 'Third-Party Integrations' },
    { pattern: /(?:reporting|analytics)/i, epicName: 'Reporting & Analytics' },
  ];

  for (const { pattern, epicName } of componentPatterns) {
    if (pattern.test(message) && !epics.includes(epicName)) {
      epics.push(epicName);
    }
  }

  return epics;
}

export function shouldSuggestWizard(result: ProjectDetectionResult): boolean {
  return result.isLargeProject && result.confidence >= 0.5;
}
