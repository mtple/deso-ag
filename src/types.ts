export type Source = 'farcaster' | 'lens' | 'nostr';
export type Timeframe = '24h' | '48h' | 'week';
export type OutputFormat = 'json' | 'markdown' | 'summary';

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
}

export interface FetchResult {
  posts: Post[];
  source: Source;
  error?: string;
}
