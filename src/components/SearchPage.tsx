import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import FilterChips from './FilterChips';
import WorkCard from './WorkCard';

interface SearchPageProps {
  initialQuery: string;
  initialFilters: { type: string; complete: string; word_min: number; word_max: number };
  initialPage: number;
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

export default function SearchPage({ initialQuery, initialFilters, initialPage }: SearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(initialPage);
  const [results, setResults] = useState<WorkResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(!!initialQuery || initialFilters.type !== '' || initialFilters.complete !== '' || initialFilters.word_min > 0 || initialFilters.word_max > 0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchResults = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (filters.type) params.set('type', filters.type);
    if (filters.complete) params.set('complete', filters.complete);
    if (filters.word_min > 0) params.set('word_min', String(filters.word_min));
    if (filters.word_max > 0) params.set('word_max', String(filters.word_max));
    if (page > 1) params.set('page', String(page));
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

    // Update URL
    const urlParams = new URLSearchParams();
    if (query) urlParams.set('q', query);
    if (filters.type) urlParams.set('type', filters.type);
    if (filters.complete) urlParams.set('complete', filters.complete);
    if (filters.word_min > 0) urlParams.set('word_min', String(filters.word_min));
    if (filters.word_max > 0) urlParams.set('word_max', String(filters.word_max));
    if (page > 1) urlParams.set('page', String(page));
    window.history.pushState({ query, filters, page }, '', `/search?${urlParams.toString()}`);
  }, [query, filters, page]);

  // Initial fetch for SSR data
  useEffect(() => {
    if (hasSearched) {
      fetchResults();
    }
  }, [filters, page]);

  // Debounced search on query change
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPage(1);
      if (query || filters.type || filters.complete || filters.word_min || filters.word_max) {
        fetchResults();
      }
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  // Handle filter changes
  function handleFilterChange(newFilters: typeof initialFilters) {
    setFilters(newFilters);
    setPage(1);
  }

  // Popstate for back/forward
  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      if (e.state) {
        setQuery(e.state.query || '');
        setFilters(e.state.filters || initialFilters);
        setPage(e.state.page || 1);
      } else {
        const params = new URLSearchParams(location.search);
        setQuery(params.get('q') || '');
        setFilters({
          type: params.get('type') || '',
          complete: params.get('complete') || '',
          word_min: Number(params.get('word_min')) || 0,
          word_max: Number(params.get('word_max')) || 0,
        });
        setPage(Math.max(Number(params.get('page')) || 1, 1));
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const totalPages = Math.ceil(total / 20);

  return (
    <section class="search-page">
      <h1 class="page-title">Search Works</h1>

      <form class="search-bar" onSubmit={(e) => { e.preventDefault(); setPage(1); fetchResults(); }}>
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
            <button class="fab-btn" onClick={() => { setPage(page - 1); fetchResults(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label="Previous page">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
          )}
          <span class="page-indicator">Page {page}</span>
          {page < totalPages && (
            <button class="fab-btn" onClick={() => { setPage(page + 1); fetchResults(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label="Next page">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          )}
        </nav>
      )}
    </section>
  );
}