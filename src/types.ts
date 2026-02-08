export type Source = 'farcaster' | 'lens' | 'nostr';
export type Timeframe = '24h' | '48h' | 'week';
export type OutputFormat = 'json' | 'markdown' | 'summary' | 'compact';
export type SortOrder = 'engagement' | 'recent' | 'relevance';

export interface Post {
  id: string;
  source: Source;
  author: {
    username: string;
    displayName?: string;
    profileUrl?: string;
  };
  content: string;
  timestamp: Date;
  url?: string;
  engagement?: {
    likes?: number;
    reposts?: number;
    replies?: number;
  };
  channel?: string;
  tags?: string[];
}

export interface SearchOptions {
  query?: string;
  sources: Source[];
  timeframe: Timeframe;
  channel?: string;
  limit?: number;
  sort?: SortOrder;
}

export interface FetchResult {
  posts: Post[];
  source: Source;
  error?: string;
}

export interface AggregateResult {
  posts: Post[];
  meta: {
    query?: string;
    sources: { name: Source; count: number; error?: string }[];
    timeframe: string;
    fetchedAt: string;
    totalPosts: number;
  };
}

export interface Term {
  token: string;
  score: number;
  postCount: number;
}

export interface SourceTerms {
  source: Source;
  postCount: number;
  terms: Term[];
}

export interface TermsResult {
  bySource: SourceTerms[];
  overall: Term[];
  timeframe: string;
  analyzedAt: string;
}
