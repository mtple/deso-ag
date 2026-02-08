import type { Post, OutputFormat, Source } from '../types.js';
import { formatTimeAgo } from '../utils/time.js';

export function formatOutput(posts: Post[], format: OutputFormat): string {
  switch (format) {
    case 'json':
      return formatJson(posts);
    case 'markdown':
      return formatMarkdown(posts);
    case 'summary':
      return formatSummary(posts);
    default:
      return formatMarkdown(posts);
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
    const content = post.content.length > 500 
      ? post.content.slice(0, 500) + '...'
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

  // Top posts by engagement
  const topPosts = [...posts]
    .filter(p => p.engagement)
    .sort((a, b) => {
      const aScore = (a.engagement?.likes || 0) + (a.engagement?.reposts || 0) * 2;
      const bScore = (b.engagement?.likes || 0) + (b.engagement?.reposts || 0) * 2;
      return bScore - aScore;
    })
    .slice(0, 5);

  if (topPosts.length > 0) {
    lines.push(`\n🔥 Top Posts by Engagement:`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (let i = 0; i < topPosts.length; i++) {
      const post = topPosts[i];
      const emoji = getSourceEmoji(post.source);
      const preview = post.content.slice(0, 80).replace(/\n/g, ' ');
      const engagement = [];
      if (post.engagement?.likes) engagement.push(`❤️${post.engagement.likes}`);
      if (post.engagement?.reposts) engagement.push(`🔁${post.engagement.reposts}`);

      lines.push(`${i + 1}. ${emoji} @${post.author.username}`);
      lines.push(`   "${preview}${post.content.length > 80 ? '...' : ''}"`);
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
  }
}

function getSourceName(source: Source): string {
  switch (source) {
    case 'farcaster': return 'Farcaster';
    case 'lens': return 'Lens';
    case 'nostr': return 'Nostr';
  }
}
