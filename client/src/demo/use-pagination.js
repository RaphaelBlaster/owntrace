import { useSearchParams } from 'react-router-dom'

export function usePagination(items, sizes, server) {
  const [params, setParams] = useSearchParams()
  const pageKey = server?.pageKey || 'page'
  const size = sizes.includes(Number(params.get('perPage'))) ? Number(params.get('perPage')) : sizes[0]
  const pages = Math.max(1, server ? server.pages : Math.ceil(items.length / size))
  const requested = Number(params.get(pageKey))
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(requested) ? requested : 1))
  const start = (page - 1) * size
  function update(key, value) {
    setParams(current => {
      const next = new URLSearchParams(current)
      next.delete('focus')
      if (key === 'perPage') next.delete(pageKey)
      const parameter = key === 'page' ? pageKey : key
      if (value === (key === 'page' ? 1 : sizes[0])) next.delete(parameter)
      else next.set(parameter, String(value))
      return next
    })
  }
  return { items: server ? items : items.slice(start, start + size), total: server ? server.total : items.length, page, pages, size, sizes, start, update }
}

