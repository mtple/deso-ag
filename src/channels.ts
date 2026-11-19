import { getHypersnapNodeUrl } from './fetchers/hypersnap.js';

const FARCASTER_CHANNELS_API = 'https://api.farcaster.xyz/v2/all-channels';
const REQUEST_TIMEOUT_MS = 10000;

export interface Channel {
  id: string;
  name: string;
  followerCount: number;
  description?: string;
}

export interface ChannelsResult {
  channels: Channel[];
  /** Where the list came from: the Farcaster client API, or a Hypersnap node when that is unreachable. */
  source: 'farcaster' | 'hypersnap';
  /** Why the Farcaster list wasn't used, when the Hypersnap fallback answered instead. */
  fallbackReason?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) throw new Error(`${new URL(url).host}: ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${new URL(url).host}: no response after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFarcasterChannels(): Promise<Channel[]> {
  const data = await getJson<{
    result?: { channels?: Array<{ id: string; name: string; followerCount?: number; description?: string }> };
  }>(FARCASTER_CHANNELS_API);

  const channels = data.result?.channels || [];
  if (channels.length === 0) throw new Error('api.farcaster.xyz returned no channels');

  return channels.map(ch => ({
    id: ch.id,
    name: ch.name,
    followerCount: ch.followerCount || 0,
    description: ch.description || undefined,
  }));
}

async function fetchHypersnapChannels(limit: number): Promise<Channel[]> {
  const data = await getJson<{
    channels?: Array<{ id: string; name?: string; follower_count?: number | null; description?: string | null }>;
  }>(`${getHypersnapNodeUrl()}/v2/farcaster/channel/trending?limit=${Math.min(Math.max(limit, 50), 100)}`);

  return (data.channels || []).map(ch => ({
    id: ch.id,
    name: ch.name || ch.id,
    followerCount: ch.follower_count || 0,
    description: ch.description || undefined,
  }));
}

/**
 * Popular channels, most-followed first. Reads Farcaster's channel list and
 * falls back to a Hypersnap node (no key needed) if that can't be reached.
 */
export async function fetchChannels(limit: number = 20): Promise<ChannelsResult> {
  const byFollowers = (channels: Channel[]) =>
    [...channels].sort((a, b) => b.followerCount - a.followerCount).slice(0, limit);

  let fallbackReason: string;
  try {
    return { channels: byFollowers(await fetchFarcasterChannels()), source: 'farcaster' };
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error);
  }

  try {
    return { channels: byFollowers(await fetchHypersnapChannels(limit)), source: 'hypersnap', fallbackReason };
  } catch (error) {
    const hypersnapReason = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't load channels. Farcaster: ${fallbackReason}. Hypersnap: ${hypersnapReason}`);
  }
}
