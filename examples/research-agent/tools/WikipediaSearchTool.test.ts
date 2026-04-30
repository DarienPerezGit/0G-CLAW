import { describe, it, expect, vi } from 'vitest';
import { WikipediaSearchTool } from './WikipediaSearchTool.js';

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('WikipediaSearchTool', () => {
  it('returns extract on happy path', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    (fetchMock as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockResponse({
          query: { search: [{ title: 'Decentralized AI', snippet: '...', pageid: 1 }] },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          query: {
            pages: { '1': { title: 'Decentralized AI', extract: 'Decentralized AI is...' } },
          },
        }),
      );

    const tool = new WikipediaSearchTool(fetchMock);
    const result = await tool.run('decentralized AI');

    expect(result.source).toBe('wikipedia:Decentralized AI');
    expect(result.content).toContain('Decentralized AI is');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns "no results" when search yields nothing', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    (fetchMock as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({ query: { search: [] } }),
    );

    const tool = new WikipediaSearchTool(fetchMock);
    const result = await tool.run('asdfghjkl-no-results-here');

    expect(result.source).toBe('wikipedia');
    expect(result.content).toBe('(no results)');
  });

  it('encodes network errors into content rather than throwing', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    (fetchMock as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ENETDOWN'),
    );

    const tool = new WikipediaSearchTool(fetchMock);
    const result = await tool.run('anything');

    expect(result.content).toContain('ENETDOWN');
    expect(result.source).toBe('wikipedia');
  });

  it('encodes HTTP errors into content rather than throwing', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    (fetchMock as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({}, false, 500),
    );

    const tool = new WikipediaSearchTool(fetchMock);
    const result = await tool.run('anything');

    expect(result.content).toContain('HTTP 500');
  });

  it('handles missing extract on the matched page', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    (fetchMock as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockResponse({ query: { search: [{ title: 'Stub Page', pageid: 99 }] } }),
      )
      .mockResolvedValueOnce(
        mockResponse({ query: { pages: { '99': { title: 'Stub Page' } } } }),
      );

    const tool = new WikipediaSearchTool(fetchMock);
    const result = await tool.run('stub');

    expect(result.source).toBe('wikipedia:Stub Page');
    expect(result.content).toBe('(no extract available)');
  });

  it('rejects empty input without making any fetch call', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const tool = new WikipediaSearchTool(fetchMock);

    const result = await tool.run('   ');

    expect(result.content).toBe('(empty query)');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
