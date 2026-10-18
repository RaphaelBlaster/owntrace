import AppError from './app-error.js'

function parseBoundedPagination(
  query = {},
  { allowedKeys = [], defaultLimit = 24, maximumLimit = 100 } = {},
) {
  const supportedKeys = new Set(['limit', 'page', ...allowedKeys])
  if (Object.keys(query).some((key) => !supportedKeys.has(key))) {
    throw new AppError('Choose supported query controls.', 400, 'INVALID_PAGINATION')
  }
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit)

  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new AppError('Page must be a positive integer.', 400, 'INVALID_PAGINATION')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new AppError(
      `Limit must be between 1 and ${maximumLimit}.`,
      400,
      'INVALID_PAGINATION',
    )
  }

  return { limit, page }
}

function paginationFor({ limit, page, total }) {
  return { limit, page, pages: Math.ceil(total / limit), total }
}

export { paginationFor, parseBoundedPagination }
