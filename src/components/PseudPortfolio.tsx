import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import ActivityHeatmap from './ActivityHeatmap';
import Sparkline from './Sparkline';
import GenrePie from './GenrePie';
import { SkeletonProfile } from './Skeleton';

interface PortfolioData {
  pseud: {
    id: number;
    name: string;
    description: string | null;
    icon_key: string | null;
    banner_key: string | null;
    created_at: string;
  };
  pinnedWorks: any[];
  works: any[];
  kudos: Record<number, number>;
  stats: {
    totalWorks: number;
    totalWords: number;
    completedWorks: number;
    totalKudos: number;
    avgUpdateCadence: number;
    genreDistribution: { name: string; count: number }[];
    wordCountTimeline: { month: string; words: number }[];
  };
  activity: Record<string, number>;
}

export default function PseudPortfolio({ pseudId }: { pseudId: number }) {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/pseuds/${pseudId}/public`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError('Failed to load portfolio'); setLoading(false); });
  }, [pseudId]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading profile">
        <SkeletonProfile />
      </div>
    );
  }

  if (error || !data) {
    return <div class="portfolio-error">{error || 'Pseud not found'}</div>;
  }

  const { pseud, pinnedWorks, works, kudos, stats, activity } = data;
  const iconUrl = pseud.icon_key ? `/api/storage/${encodeURIComponent(pseud.icon_key)}` : null;
  const bannerUrl = pseud.banner_key ? `/api/storage/${encodeURIComponent(pseud.banner_key)}` : null;

  // Determine current and previous year for heat map
  const currentYear = new Date().getFullYear();

  return (
    <div class="portfolio">
      {/* Banner */}
      <div class="portfolio-banner" style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : {}}>
        <div class="portfolio-banner-overlay" />
      </div>

      {/* Profile Header */}
      <div class="portfolio-header">
        <div class="portfolio-avatar">
          {iconUrl ? (
            <img src={iconUrl} alt={pseud.name} class="portfolio-avatar-img" />
          ) : (
            <div class="portfolio-avatar-placeholder">
              {pseud.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div class="portfolio-header-info">
          <h1 class="portfolio-name">{pseud.name}</h1>
          {pseud.description && (
            <p class="portfolio-description">{pseud.description}</p>
          )}
          <div class="portfolio-meta">
            <span>Member since {new Date(pseud.created_at).getFullYear()}</span>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div class="portfolio-stats-bar">
        <div class="stat-item">
          <span class="stat-value">{stats.totalWorks}</span>
          <span class="stat-label">Works</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{stats.totalWords.toLocaleString()}</span>
          <span class="stat-label">Words</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{stats.completedWorks}</span>
          <span class="stat-label">Complete</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{stats.totalKudos.toLocaleString()}</span>
          <span class="stat-label">Kudos</span>
        </div>
        {stats.avgUpdateCadence > 0 && (
          <div class="stat-item">
            <span class="stat-value">{stats.avgUpdateCadence}d</span>
            <span class="stat-label">Avg Cadence</span>
          </div>
        )}
      </div>

      {/* Pinned Works */}
      {pinnedWorks.length > 0 && (
        <section class="portfolio-section">
          <h2 class="portfolio-section-title">Featured Works</h2>
          <div class="pinned-works-grid">
            {pinnedWorks.map(work => (
              <a href={`/works/${work.id}`} class="pinned-work-card" key={work.id}>
                <div class="pinned-work-title">{work.title}</div>
                {work.summary && (
                  <div class="pinned-work-summary">{work.summary.length > 140 ? work.summary.substring(0, 140) + '…' : work.summary}</div>
                )}
                <div class="pinned-work-meta">
                  <span>{work.word_count.toLocaleString()} words</span>
                  {work.complete ? <span class="badge-complete">Complete</span> : <span class="badge-wip">WIP</span>}
                  {kudos[work.id] > 0 && <span>♥ {kudos[work.id]}</span>}
                </div>
                {work.tags && work.tags.length > 0 && (
                  <div class="pinned-work-tags">
                    {work.tags.filter((t: any) => t.type === 'fandom').slice(0, 2).map((t: any) => (
                      <span class="tag-chip tag-fandom" key={t.id}>{t.name}</span>
                    ))}
                  </div>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Stats Visualizations */}
      <section class="portfolio-section">
        <h2 class="portfolio-section-title">Statistics</h2>
        <div class="stats-grid">
          {/* Word Count Sparkline */}
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-title">Words Over Time</span>
            </div>
            <div class="stat-card-body">
              {stats.wordCountTimeline.length > 0 ? (
                <Sparkline data={stats.wordCountTimeline} width={240} height={50} />
              ) : (
                <div class="stat-empty">No data yet</div>
              )}
            </div>
          </div>

          {/* Genre Distribution */}
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-title">Tag Distribution</span>
            </div>
            <div class="stat-card-body">
              {stats.genreDistribution.length > 0 ? (
                <GenrePie data={stats.genreDistribution} size={90} />
              ) : (
                <div class="stat-empty">No tags yet</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Activity Heat Map */}
      <section class="portfolio-section">
        <ActivityHeatmap activity={activity} year={currentYear} />
      </section>

      {/* All Works */}
      <section class="portfolio-section">
        <h2 class="portfolio-section-title">All Works ({works.length})</h2>
        {works.length === 0 ? (
          <div class="portfolio-empty">No published works yet.</div>
        ) : (
          <div class="works-list">
            {works.map(work => (
              <a href={`/works/${work.id}`} class="work-list-item" key={work.id}>
                <div class="work-list-item-main">
                  <div class="work-list-item-title">{work.title}</div>
                  {work.summary && (
                    <div class="work-list-item-summary">{work.summary.length > 200 ? work.summary.substring(0, 200) + '…' : work.summary}</div>
                  )}
                  <div class="work-list-item-tags">
                    {(work.tags || []).filter((t: any) => t.type === 'fandom').slice(0, 3).map((t: any) => (
                      <span class="tag-chip tag-fandom" key={t.id}>{t.name}</span>
                    ))}
                    {(work.tags || []).filter((t: any) => t.type === 'rating').slice(0, 1).map((t: any) => (
                      <span class="tag-chip tag-rating" key={t.id}>{t.name}</span>
                    ))}
                  </div>
                </div>
                <div class="work-list-item-stats">
                  <span>{work.word_count.toLocaleString()} words</span>
                  {work.complete ? <span class="badge-complete">✓</span> : <span class="badge-wip">…</span>}
                  {kudos[work.id] > 0 && <span>♥ {kudos[work.id]}</span>}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}