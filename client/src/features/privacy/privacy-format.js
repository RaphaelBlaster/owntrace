function formatDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function formatEnum(value) {
  if (!value) return 'Unknown'
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatMoney(amountMinor, currency) {
  if (!Number.isInteger(amountMinor) || !currency) return 'Not available'
  const divisor = currency === 'JPY' ? 1 : 100
  try {
    return new Intl.NumberFormat(undefined, {
      currency,
      style: 'currency',
    }).format(amountMinor / divisor)
  } catch {
    return 'Not available'
  }
}

export { formatDate, formatEnum, formatMoney }
