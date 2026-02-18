import { useRef, useCallback } from 'react'

/**
 * Wraps a search function with stale-request protection.
 *
 * If `search(...)` is called while a previous call is still in flight,
 * the older call's result is discarded — the returned promise resolves to
 * `null` instead of the stale payload.  This prevents older responses from
 * overwriting newer results when the user triggers multiple queries rapidly.
 *
 * Usage in a component:
 *
 *   const search = useSearch(searchAPI.searchTranscripts)
 *
 *   const handleSearch = async () => {
 *     const response = await search(query, limit, offset)
 *     if (!response) return  // superseded by a newer call — ignore
 *     setResults(response.results)
 *   }
 */
export function useSearch(searchFn) {
  const latestIdRef = useRef(0)

  const search = useCallback(
    async (...args) => {
      const id = ++latestIdRef.current
      try {
        const result = await searchFn(...args)
        if (id !== latestIdRef.current) return null  // superseded
        return result
      } catch (err) {
        if (id !== latestIdRef.current) return null  // superseded
        throw err
      }
    },
    [searchFn]
  )

  return search
}
