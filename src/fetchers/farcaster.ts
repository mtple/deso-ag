import type { Post, SearchOptions, FetchResult } from '../types.js';

// Pinata's free public Farcaster Hub
const PINATA_HUB = 'https://hub.pinata.cloud/v1';

// Farcaster Client API (free, no auth needed)
const FARCASTER_API = 'https://api.farcaster.xyz';

// Farcaster epoch: Jan 1, 2021
const FARCASTER_EPOCH = new Date('2021-01-01T00:00:00Z').getTime();

// Popular channels to query for trending content
const TRENDING_CHANNELS = [
  'farcaster',
  'ethereum', 
  'base',
  'dev',
  'founders',
  'degen',
  'crypto',
];

interface HubCast {
  data: {
    fid: number;
    timestamp: number;
    castAddBody?: {
      text: string;
      parentUrl?: string;
      embeds?: Array<{ url?: string }>;
      mentions?: number[];
    };
  };
  hash: string;
}

interface HubResponse {
  messages?: HubCast[];
  nextPageToken?: string;
}

interface FarcasterChannel {
  id: string;
  url: string;
  name: string;
  followerCount: number;
}

interface ChannelResponse {
  result?: {
    channel?: FarcasterChannel;
  };
}

interface UserData {
  fid: number;
  username?: string;
  displayName?: string;
}

// Cache for channel URLs and user lookups
const channelUrlCache = new Map<string, string>();
const userCache = new Map<number, UserData>();

export async function fetchFarcaster(options: SearchOptions): Promise<FetchResult> {
  const limit = options.limit || 25;

  try {
    let posts: Post[] = [];

    if (options.channel) {
      // Query specific channel
      posts = await fetchChannelCasts(options.channel, limit * 2);
    } else {
      // Query multiple popular channels for trending/search
      posts = await fetchTrendingCasts(limit);
    }

    // Filter by query if provided
    if (options.query) {
      const query = options.query.toLowerCase();
      posts = posts.filter(p => 
        p.content.toLowerCase().includes(query)
      );
    }

    return {
      posts: posts.slice(0, limit),
      source: 'farcaster',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      posts: [],
      source: 'farcaster',
      error: `Farcaster: ${message}`,
    };
  }
}

async function fetchTrendingCasts(limit: number): Promise<Post[]> {
  const allPosts: Post[] = [];
  const seenHashes = new Set<string>();
  const perChannelLimit = Math.ceil(limit / TRENDING_CHANNELS.length) + 5;

  // Query multiple channels in parallel
  const promises = TRENDING_CHANNELS.map(channelId => 
    fetchChannelCasts(channelId, perChannelLimit).catch(() => [])
  );

  const results = await Promise.all(promises);

  for (const posts of results) {
    for (const post of posts) {
      if (!seenHashes.has(post.id)) {
        seenHashes.add(post.id);
        allPosts.push(post);
      }
    }
  }

  // Sort by timestamp (newest first)
  allPosts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return allPosts.slice(0, limit);
}

async function fetchChannelCasts(channelId: string, limit: number): Promise<Post[]> {
  // Get the actual channel URL (which is often a chain:// URL, not https://)
  const channelUrl = await getChannelUrl(channelId);
  if (!channelUrl) {
    return [];
  }

  const posts: Post[] = [];
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const encodedUrl = encodeURIComponent(channelUrl);
    const url = `${PINATA_HUB}/castsByParent?url=${encodedUrl}&pageSize=${Math.min(limit, 100)}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Hub API: ${response.status}`);
    }

    const data = await response.json() as HubResponse;

    // Collect all casts first
    const casts: Array<{ msg: HubCast; timestamp: Date }> = [];
    
    for (const msg of data.messages || []) {
      const cast = msg.data;
      if (!cast.castAddBody) continue;
      
      const timestamp = new Date(FARCASTER_EPOCH + cast.timestamp * 1000);
      casts.push({ msg, timestamp });
    }

    // Sort by timestamp descending (newest first)
    casts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Now process the sorted casts
    for (const { msg, timestamp } of casts) {
      const cast = msg.data;
      if (!cast.castAddBody) continue;

      const hashHex = msg.hash.startsWith('0x') ? msg.hash : `0x${msg.hash}`;

      // Get user info (with caching)
      const user = await getUserInfo(cast.fid);

      posts.push({
        id: hashHex,
        source: 'farcaster',
        author: {
          username: user?.username || `fid:${cast.fid}`,
          displayName: user?.displayName,
          profileUrl: user?.username 
            ? `https://warpcast.com/${user.username}`
            : `https://warpcast.com/~/profiles/${cast.fid}`,
        },
        content: cast.castAddBody.text,
        timestamp,
        url: `https://warpcast.com/~/conversations/${hashHex.slice(2, 18)}`,
        channel: channelId,
      });

      if (posts.length >= limit) break;
    }

    return posts;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function getChannelUrl(channelId: string): Promise<string | null> {
  // Check cache first
  if (channelUrlCache.has(channelId)) {
    return channelUrlCache.get(channelId) || null;
  }

  try {
    const response = await fetch(`${FARCASTER_API}/v1/channel?channelId=${channelId}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      const data = await response.json() as ChannelResponse;
      const url = data.result?.channel?.url;
      if (url) {
        channelUrlCache.set(channelId, url);
        return url;
      }
    }
  } catch {
    // Silent fail
  }

  return null;
}

async function getUserInfo(fid: number): Promise<UserData | null> {
  // Check cache first
  if (userCache.has(fid)) {
    return userCache.get(fid) || null;
  }

  try {
    const response = await fetch(`${PINATA_HUB}/userDataByFid?fid=${fid}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      userCache.set(fid, { fid });
      return { fid };
    }

    const data = await response.json() as { messages?: Array<{ data: { userDataBody?: { type: string; value: string } } }> };
    
    const userData: UserData = { fid };

    for (const msg of data.messages || []) {
      const body = msg.data?.userDataBody;
      if (!body) continue;

      if (body.type === 'USER_DATA_TYPE_USERNAME') {
        userData.username = body.value;
      } else if (body.type === 'USER_DATA_TYPE_DISPLAY') {
        userData.displayName = body.value;
      }
    }

    userCache.set(fid, userData);
    return userData;
  } catch {
    userCache.set(fid, { fid });
    return { fid };
  }
}
