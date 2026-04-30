import type { ITool, ToolResult } from './ITool.js';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

interface WikipediaSearchResponse {
  query?: {
    search?: Array<{ title: string; snippet?: string; pageid?: number }>;
  };
}

interface WikipediaExtractResponse {
  query?: {
    pages?: Record<string, { title?: string; extract?: string }>;
  };
}

/**
 * Tool: searches English Wikipedia and returns the top article's intro extract.
 *
 * Two-step protocol:
 *   1. /w/api.php?action=query&list=search    → resolve top page title
 *   2. /w/api.php?action=query&prop=extracts  → fetch intro plaintext
 *
 * No auth needed. CORS-permissive (origin=*) so this also works in browsers
 * if reused. Network / HTTP errors are encoded into the ToolResult.content
 * field rather than thrown, per the ITool contract.
 *
 * The `fetchImpl` constructor argument exists so tests can inject a mock
 * without monkey-patching the global.
 */
export class WikipediaSearchTool implements ITool {
  readonly name = 'wikipedia';
  readonly description = 'Search English Wikipedia and return the top article extract';

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async run(input: string): Promise<ToolResult> {
    const query = input.trim();
    if (query.length === 0) {
      return { source: 'wikipedia', content: '(empty query)' };
    }

    // Step 1: search for top hit
    const searchUrl = new URL(WIKIPEDIA_API);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', query);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('origin', '*');

    let searchData: WikipediaSearchResponse;
    try {
      const res = await this.fetchImpl(searchUrl.toString());
      if (!res.ok) {
        return { source: 'wikipedia', content: `(search failed: HTTP ${res.status})` };
      }
      searchData = (await res.json()) as WikipediaSearchResponse;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { source: 'wikipedia', content: `(search failed: ${msg})` };
    }

    const hits = searchData.query?.search ?? [];
    if (hits.length === 0 || hits[0] === undefined) {
      return { source: 'wikipedia', content: '(no results)' };
    }

    const topTitle = hits[0].title;

    // Step 2: fetch the intro extract for that title
    const extractUrl = new URL(WIKIPEDIA_API);
    extractUrl.searchParams.set('action', 'query');
    extractUrl.searchParams.set('format', 'json');
    extractUrl.searchParams.set('prop', 'extracts');
    extractUrl.searchParams.set('exintro', 'true');
    extractUrl.searchParams.set('explaintext', 'true');
    extractUrl.searchParams.set('titles', topTitle);
    extractUrl.searchParams.set('origin', '*');

    let extractData: WikipediaExtractResponse;
    try {
      const res = await this.fetchImpl(extractUrl.toString());
      if (!res.ok) {
        return {
          source: `wikipedia:${topTitle}`,
          content: `(extract failed: HTTP ${res.status})`,
        };
      }
      extractData = (await res.json()) as WikipediaExtractResponse;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { source: `wikipedia:${topTitle}`, content: `(extract failed: ${msg})` };
    }

    const pages = extractData.query?.pages ?? {};
    const firstPage = Object.values(pages)[0];
    const extract = firstPage?.extract ?? '';
    if (extract.trim().length === 0) {
      return { source: `wikipedia:${topTitle}`, content: '(no extract available)' };
    }

    return { source: `wikipedia:${topTitle}`, content: extract };
  }
}
