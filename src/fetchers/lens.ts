import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

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
    const posts = await fetchLensPosts(options.limit || 50, options.query);

    let mappedPosts: Post[] = posts
      .filter(post => {
        if (!post) return false;
        if (new Date(post.timestamp) < cutoff) return false;
        // Filter out empty content
        const content = post.metadata?.content || '';
        if (content.trim().length === 0) return false;
        return true;
      })
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

    // Additional client-side query filter (AND semantics for multi-word queries)
    if (options.query) {
      mappedPosts = mappedPosts.filter(p =>
        matchesQuery(p.content, p.tags || [], options.query!)
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

async function fetchLensPosts(limit: number, searchQuery?: string): Promise<LensPost[]> {
  // Build the request object dynamically
  const requestFields = [`pageSize: $pageSize`];
  const variableDefs = [`$pageSize: PageSize!`];
  const variables: Record<string, unknown> = {
    pageSize: limitToLensEnum(limit),
  };

  if (searchQuery) {
    requestFields.push(`filter: { searchQuery: $searchQuery }`);
    variableDefs.push(`$searchQuery: String!`);
    variables.searchQuery = searchQuery;
  }

  const graphqlQuery = `
    query GetPosts(${variableDefs.join(', ')}) {
      posts(request: { ${requestFields.join(', ')} }) {
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
      variables,
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
  return 'FIFTY';
}
