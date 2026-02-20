import type { Post, OutputFormat, Source, AggregateResult, TermsResult } from '../types.js';
import { formatTimeAgo } from '../utils/time.js';

export function computeEngagementScore(post: Post): number {
  return (post.engagement?.likes || 0) +
    (post.engagement?.reposts || 0) * 2 +
    (post.engagement?.replies || 0);
}

export function formatOutput(posts: Post[], format: OutputFormat, meta?: AggregateResult['meta'], termsResult?: TermsResult): string {
  // Filter out posts with empty/whitespace-only content
  const filtered = posts.filter(p => p.content.trim().length > 0);

  switch (format) {
    case 'json':
      return formatJson(filtered);
    case 'markdown':
      return formatMarkdown(filtered);
    case 'summary':
      return formatSummary(filtered);
    case 'compact':
      return formatCompact(filtered, meta, termsResult);
    default:
      return formatMarkdown(filtered);
  }
}

function formatJson(posts: Post[]): string {
  return JSON.stringify(posts, (key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }, 2);
}

function formatCompact(posts: Post[], meta?: AggregateResult['meta'], termsResult?: TermsResult): string {
  const result: Record<string, unknown> = {
    meta: meta || {
      totalPosts: posts.length,
      sources: [],
      timeframe: 'unknown',
      fetchedAt: new Date().toISOString(),
    },
    posts: posts.map(p => ({
      id: p.id,
      source: p.source,
      author: p.author.username,
      content: p.content,
      timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
      url: p.url || null,
      score: computeEngagementScore(p),
      engagement: {
        likes: p.engagement?.likes || 0,
        reposts: p.engagement?.reposts || 0,
        replies: p.engagement?.replies || 0,
      },
      tags: p.tags || [],
    })),
  };

  if (termsResult) {
    result.terms = termsResult;
  }

  return JSON.stringify(result);
}

function formatMarkdown(posts: Post[]): string {
  if (posts.length === 0) {
    return '# No posts found\n\nTry adjusting your search parameters.';
  }

  const lines: string[] = [
    `# Social Aggregator Results`,
    `*Found ${posts.length} posts*\n`,
    '---\n',
  ];

  for (const post of posts) {
    const sourceEmoji = getSourceEmoji(post.source);
    const timeAgo = formatTimeAgo(post.timestamp);

    lines.push(`## ${sourceEmoji} ${post.author.displayName || post.author.username}`);
    lines.push(`**@${post.author.username}** · ${timeAgo}\n`);

    // Content (truncate if too long)
    const content = post.content.length > 2500
      ? post.content.slice(0, 2500) + '...'
      : post.content;
    lines.push(content + '\n');

    // Engagement
    if (post.engagement) {
      const parts: string[] = [];
      if (post.engagement.likes !== undefined) parts.push(`❤️ ${post.engagement.likes}`);
      if (post.engagement.reposts !== undefined) parts.push(`🔁 ${post.engagement.reposts}`);
      if (post.engagement.replies !== undefined) parts.push(`💬 ${post.engagement.replies}`);
      if (parts.length > 0) lines.push(parts.join(' · ') + '\n');
    }

    // Tags
    if (post.tags && post.tags.length > 0) {
      lines.push(`Tags: ${post.tags.map(t => `#${t}`).join(' ')}\n`);
    }

    // Link
    if (post.url) {
      lines.push(`[View on ${getSourceName(post.source)}](${post.url})\n`);
    }

    lines.push('---\n');
  }

  return lines.join('\n');
}

function formatSummary(posts: Post[]): string {
  if (posts.length === 0) {
    return 'No posts found matching your criteria.';
  }

  // Group by source
  const bySource = new Map<Source, Post[]>();
  for (const post of posts) {
    const existing = bySource.get(post.source) || [];
    existing.push(post);
    bySource.set(post.source, existing);
  }

  const lines: string[] = [
    `📊 Social Aggregator Summary`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Total: ${posts.length} posts\n`,
  ];

  // Stats by source
  for (const [source, sourcePosts] of bySource) {
    const emoji = getSourceEmoji(source);
    const name = getSourceName(source);

    const totalLikes = sourcePosts.reduce((sum, p) => sum + (p.engagement?.likes || 0), 0);
    const totalReposts = sourcePosts.reduce((sum, p) => sum + (p.engagement?.reposts || 0), 0);

    lines.push(`${emoji} ${name}: ${sourcePosts.length} posts`);
    if (totalLikes > 0 || totalReposts > 0) {
      lines.push(`   ❤️ ${totalLikes} likes · 🔁 ${totalReposts} reposts`);
    }
    lines.push('');
  }

  // All posts sorted by engagement (posts without engagement go last, sorted by time)
  const allPosts = [...posts]
    .sort((a, b) => {
      const aScore = (a.engagement?.likes || 0) + (a.engagement?.reposts || 0) * 2;
      const bScore = (b.engagement?.likes || 0) + (b.engagement?.reposts || 0) * 2;
      if (aScore !== bScore) return bScore - aScore;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
  if (allPosts.length > 0) {
    lines.push(`\n🔥 All Posts by Engagement:`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (let i = 0; i < allPosts.length; i++) {
      const post = allPosts[i];
      const emoji = getSourceEmoji(post.source);
      const preview = post.content.slice(0, 400).replace(/\n/g, ' ');
      const engagement = [];
      if (post.engagement?.likes) engagement.push(`❤️${post.engagement.likes}`);
      if (post.engagement?.reposts) engagement.push(`🔁${post.engagement.reposts}`);

      lines.push(`${i + 1}. ${emoji} @${post.author.username}`);
      lines.push(`   "${preview}${post.content.length > 400 ? '...' : ''}"`);
      lines.push(`   ${engagement.join(' ')} · ${formatTimeAgo(post.timestamp)}`);
      lines.push('');
    }
  }

  // Common topics/hashtags
  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags || []) {
      tagCounts.set(tag.toLowerCase(), (tagCounts.get(tag.toLowerCase()) || 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topTags.length > 0) {
    lines.push(`\n🏷️ Trending Tags:`);
    lines.push(topTags.map(([tag, count]) => `#${tag} (${count})`).join(' · '));
  }

  return lines.join('\n');
}

function getSourceEmoji(source: Source): string {
  switch (source) {
    case 'farcaster': return '🟣';
    case 'lens': return '🌿';
    case 'nostr': return '⚡';
    case 'bluesky': return '🦋';
  }
}

function getSourceName(source: Source): string {
  switch (source) {
    case 'farcaster': return 'Farcaster';
    case 'lens': return 'Lens';
    case 'nostr': return 'Nostr';
    case 'bluesky': return 'Bluesky';
  }
}

export function formatTermsSummary(result: TermsResult): string {
  const lines: string[] = [
    `📊 Top Terms (last ${result.timeframe})`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];

  for (const st of result.bySource) {
    const emoji = getSourceEmoji(st.source);
    const name = getSourceName(st.source);
    lines.push(`${emoji} ${name} (${st.postCount} posts analyzed)`);

    if (st.terms.length === 0) {
      lines.push('  No significant terms found');
    } else {
      for (let i = 0; i < st.terms.length; i++) {
        const t = st.terms[i];
        const pad = t.token.length < 16 ? ' '.repeat(16 - t.token.length) : ' ';
        lines.push(`  ${i + 1}. ${t.token}${pad}score: ${t.score.toFixed(1)}  (in ${t.postCount} posts)`);
      }
    }
    lines.push('');
  }

  lines.push('🌐 Overall Top Terms');
  if (result.overall.length === 0) {
    lines.push('  No significant terms found');
  } else {
    for (let i = 0; i < result.overall.length; i++) {
      const t = result.overall[i];
      const pad = t.token.length < 16 ? ' '.repeat(16 - t.token.length) : ' ';
      lines.push(`  ${i + 1}. ${t.token}${pad}score: ${t.score.toFixed(1)}  (in ${t.postCount} posts)`);
    }
  }

  return lines.join('\n');
}
