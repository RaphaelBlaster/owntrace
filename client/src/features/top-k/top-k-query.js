const categories = ['jobs', 'orders', 'subscriptions', 'security', 'finance', 'travel', 'social', 'marketing', 'spam', 'personal', 'other', 'all']
const kinds = ['all', 'applications', 'opportunities']
export function readTopKQuery(params) {
  const category = params.get('category'), kind = params.get('kind'), status = params.get('status') || ''
  const number = (name, fallback, allowed) => { const value = Number(params.get(name)); return Number.isInteger(value) && allowed(value) ? value : fallback }
  return { category: categories.includes(category) ? category : 'jobs', kind: kinds.includes(kind) ? kind : 'all', status: /^[a-z_]{0,60}$/.test(status) ? status : '', search: (params.get('search') || '').slice(0, 80), page: number('page', 1, value => value >= 1 && value <= 10000), limit: number('limit', 6, value => [6, 12, 24].includes(value)) }
}
export function mailViewPath(action) {
  const fields = ['type', 'category', 'kind', 'status', 'search', 'page']
  if (!action || action.type !== 'show_mail_insights' || Object.keys(action).some(key => !fields.includes(key)) || !['', ...categories.filter(value => value !== 'all')].includes(action.category) || !kinds.includes(action.kind) || typeof action.status !== 'string' || !/^[a-z_]{0,60}$/.test(action.status) || typeof action.search !== 'string' || action.search.length > 80 || !Number.isInteger(action.page) || action.page < 1 || action.page > 10000) return null
  const params = new URLSearchParams({ category: action.category || 'all', kind: action.kind, status: action.status, search: action.search, page: String(action.page), limit: '6' })
  return '/top-k?' + params
}
