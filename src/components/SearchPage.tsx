import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import FilterChips from './FilterChips';
import WorkCard from './WorkCard';

type Filters = { type: string; complete: string; word_min: number; word_max: number };

interface SearchPageProps {
  initialQuery: string;
  initialFilters: Filters;
  initialPage: number;
  initialResults: WorkResult[];
  initialTotal: number;
}

interface WorkResult {
  id: number;
  title: string;
  pseud_name: string | null;
  summary: string | null;
  word_count: number;
  complete: number;
  published_at: string | null;
  tags: { id: number; name: string; type: string }[];
}

interface SearchResponse {
  results: WorkResult[];
  total: number;
  page: number;
}

export default function SearchPage({ initialQuery, initialFilters, initialPage, initialResults, initialTotal }: SearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(initialPage);
  const [results, setResults] = useState<WorkResult[]>(initialResults);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(
    initialResults.length > 0 || !!initialQuery ||
    initialFilters.type !== '' || initialFilters.complete !== '' ||
    initialFilters.word_min > 0 || initialFilters.word_max > 0
  );
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  // Always holds the latest query/filters so debounce timeout reads current values
  const latestRef = useRef({ query, filters });

  useEffect(() => {
    latestRef.current = { query, filters };
  });

  // Fetch results with explicit params to avoid stale-closure races.
  // Pass skipPush=true when triggered by a popstate event or on initial mount,
  // so we never push duplicate history entries.
  function doFetch(q: string, f: Filters, p: number, skipPush: boolean) {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (f.type) params.set('type', f.type);
    if (f.complete) params.set('complete', f.complete);
    if (f.word_min > 0) params.set('word_min', String(f.word_min));
    if (f.word_max > 0) params.set('word_max', String(f.word_max));
    if (p > 1) params.set('page', String(p));
    params.set('limit', '20');

    fetch(`/api/search?${params.toString()}`)
      .then(r => r.json())
      .then((data: SearchResponse) => {
        setResults(data.results || []);
        setTotal(data.total || 0);
        setHasSearched(true);
      })
      .catch(() => {
        setResults([]);
        setTotal(0);
        setHasSearched(true);
      })
      .finally(() => setLoading(false));

    if (!skipPush) {
      const urlParams = new URLSearchParams();
      if (q) urlParams.set('q', q);
      if (f.type) urlParams.set('type', f.type);
      if (f.complete) urlParams.set('complete', f.complete);
      if (f.word_min > 0) urlParams.set('word_min', String(f.word_min));
      if (f.word_max > 0) urlParams.set('word_max', String(f.word_max));
      if (p > 1) urlParams.set('page', String(p));
      window.history.pushState({ query: q, filters: f, page: p }, '', `/search?${urlParams.toString()}`);
    }
  }

  // Fallback client-side fetch on mount only when SSR produced no results but
  // search params are present (e.g. DB error during SSR).
  useEffect(() => {
    if (initialResults.length > 0) return;
    const hasParams = initialQuery || initialFilters.type || initialFilters.complete ||
                      initialFilters.word_min || initialFilters.word_max;
    if (hasParams) {
      doFetch(initialQuery, initialFilters, initialPage, true);
    }
  }, []);

  // Debounced search on query change — reads latest filters via ref to avoid
  // stale values if filters changed within the debounce window.
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const { query: q, filters: f } = latestRef.current;
      if (q || f.type || f.complete || f.word_min || f.word_max) {
        setPage(1);
        doFetch(q, f, 1, false);
      }
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  // Immediately fetch when filters change; reset to page 1.
  function handleFilterChange(newFilters: Filters) {
    setFilters(newFilters);
    setPage(1);
    doFetch(query, newFilters, 1, false);
  }

  // Popstate for back/forward — restore state and fetch without pushing a new entry.
  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      let q: string, f: Filters, p: number;
      if (e.state) {
        q = e.state.query || '';
        f = e.state.filters || initialFilters;
        p = e.state.page || 1;
      } else {
        const searchParams = new URLSearchParams(location.search);
        q = searchParams.get('q') || '';
        f = {
          type: searchParams.get('type') || '',
          complete: searchParams.get('complete') || '',
          word_min: Number(searchParams.get('word_min')) || 0,
          word_max: Number(searchParams.get('word_max')) || 0,
        };
        p = Math.max(Number(searchParams.get('page')) || 1, 1);
      }
      setQuery(q);
      setFilters(f);
      setPage(p);
      doFetch(q, f, p, true);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const totalPages = Math.ceil(total / 20);

  return (
    <section class="search-page">
      <h1 class="page-title">Search Works</h1>

      <form class="search-bar" onSubmit={(e) => { e.preventDefault(); setPage(1); doFetch(query, filters, 1, false); }}>
        <div class="search-input-wrapper">
          <svg class="search-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder="Search for works…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            autocomplete="off"
          />
        </div>
      </form>

      <FilterChips filters={filters} onChange={handleFilterChange} />

      {loading && <p class="search-loading">Searching…</p>}

      {hasSearched && !loading && results.length === 0 && (
        <p class="no-results">
          {query
            ? <>No works found for "<span class="query-highlight">{query}</span>"</>
            : 'No works match the selected filters.'}
        </p>
      )}

      {!hasSearched && (
        <p class="placeholder-text">Enter a search query or use filters to find works.</p>
      )}

      {results.length > 0 && (
        <div class="results-meta">
          <span>{total.toLocaleString()} result{total !== 1 ? 's' : ''}</span>
        </div>
      )}

      <div class="results-list">
        {results.map(w => (
          <WorkCard key={w.id} {...w} />
        ))}
      </div>

      {totalPages > 1 && (
        <nav class="pagination">
          {page > 1 && (
            <button class="fab-btn" onClick={() => {
              const newPage = page - 1;
              setPage(newPage);
              doFetch(query, filters, newPage, false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }} aria-label="Previous page">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
          )}
          <span class="page-indicator">Page {page}</span>
          {page < totalPages && (
            <button class="fab-btn" onClick={() => {
              const newPage = page + 1;
              setPage(newPage);
              doFetch(query, filters, newPage, false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }} aria-label="Next page">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          )}
        </nav>
      )}
    </section>
  );
}