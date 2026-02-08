import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';

// Lens V3 API endpoint
const LENS_API = 'https://api.lens.xyz/graphql';

interface LensPost {
  slug: string;
  timestamp: string;
  author: {
    username?: { value: string; localName: string };
    metadata?: { name?: string };
  };
  metadata?: {
    content?: string;
  };
  stats?: {
    reactions: number;
    reposts: number;
    comments: number;
  };
}

interface LensResponse {
  data?: {
    posts?: {
      items: LensPost[];
    };
  };
  errors?: Array<{ message: string }>;
}

export async function fetchLens(options: SearchOptions): Promise<FetchResult> {
  const cutoff = getTimeframeCutoff(options.timeframe);

  try {
    const posts = await fetchLensPosts(options.limit || 50);

    let mappedPosts: Post[] = posts
      .filter(post => post && new Date(post.timestamp) >= cutoff)
      .map(post => ({
        id: post.slug,
        source: 'lens' as const,
        author: {
          username: post.author?.username?.localName || post.author?.username?.value || 'unknown',
          displayName: post.author?.metadata?.name,
          profileUrl: post.author?.username?.localName 
            ? `https://hey.xyz/u/${post.author.username.localName}`
            : undefined,
        },
        content: post.metadata?.content || '',
        timestamp: new Date(post.timestamp),
        url: `https://hey.xyz/posts/${post.slug}`,
        engagement: {
          likes: post.stats?.reactions || 0,
          reposts: post.stats?.reposts || 0,
          replies: post.stats?.comments || 0,
        },
      }));

    // Filter by query if provided
    if (options.query) {
      const query = options.query.toLowerCase();
      mappedPosts = mappedPosts.filter(p => 
        p.content.toLowerCase().includes(query)
      );
    }

    return {
      posts: mappedPosts,
      source: 'lens',
    };
  } catch (error) {
    return {
      posts: [],
      source: 'lens',
      error: error instanceof Error ? error.message : 'Unknown error fetching from Lens',
    };
  }
}

async function fetchLensPosts(limit: number): Promise<LensPost[]> {
  // Lens V3 posts query - minimal fields to avoid schema issues
  const graphqlQuery = `
    query GetPosts($pageSize: PageSize!) {
      posts(request: { pageSize: $pageSize }) {
        items {
          ... on Post {
            slug
            timestamp
            author {
              username { 
                value 
                localName
              }
              metadata { 
                name 
              }
            }
            metadata {
              ... on TextOnlyMetadata { content }
              ... on ArticleMetadata { content }
              ... on LinkMetadata { content }
            }
            stats {
              reactions
              reposts
              comments
            }
          }
        }
      }
    }
  `;

  const response = await fetch(LENS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: {
        pageSize: limitToLensEnum(limit),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Lens API HTTP error: ${response.status}`);
  }

  const result = await response.json() as LensResponse;
  
  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }
  
  return result.data?.posts?.items || [];
}

function limitToLensEnum(limit: number): string {
  if (limit <= 10) return 'TEN';
  if (limit <= 25) return 'TWENTY_FIVE';
  return 'FIFTY';
}
