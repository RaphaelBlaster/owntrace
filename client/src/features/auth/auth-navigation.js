function getDefaultAuthenticatedRoute(user) {
  if (user?.onboardingStatus === 'COMPLETED') return '/dashboard'
  if (['GMAIL_PENDING', 'SCAN_PENDING'].includes(user?.onboardingStatus)) return '/connect'
  return '/onboarding'
}

function canAccessAuthenticatedRoute(user, pathname) {
  if (user?.onboardingStatus === 'COMPLETED') return true
  if (['/onboarding', '/settings'].includes(pathname)) return true
  return ['/connect', '/connect/gmail', '/connect/microsoft'].includes(pathname)
    && ['GMAIL_PENDING', 'SCAN_PENDING'].includes(user?.onboardingStatus)
}

function getPostLoginRoute(user, requestedPath) {
  return typeof requestedPath === 'string' && canAccessAuthenticatedRoute(user, requestedPath)
    ? requestedPath
    : getDefaultAuthenticatedRoute(user)
}

export { canAccessAuthenticatedRoute, getDefaultAuthenticatedRoute, getPostLoginRoute }
