const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function validateEmail(email, errors) {
  if (!email) {
    errors.email = 'Email is required.'
  } else if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.'
  }
}

function validatePassword(password, errors) {
  if (typeof password !== 'string' || !password) {
    errors.password = 'Password is required.'
  } else if (password.length < 12) {
    errors.password = 'Password must be at least 12 characters.'
  } else if (password.length > 128) {
    errors.password = 'Password must be 128 characters or fewer.'
  }
}

function validateRegistrationInput(body) {
  if (!isPlainObject(body)) {
    return { errors: { form: 'A JSON request body is required.' } }
  }

  const name = normalizeName(body.name)
  const email = normalizeEmail(body.email)
  const password = body.password
  const errors = {}

  if (!name) {
    errors.name = 'Name is required.'
  } else if (name.length < 2 || name.length > 80) {
    errors.name = 'Name must be between 2 and 80 characters.'
  }

  validateEmail(email, errors)
  validatePassword(password, errors)

  return { data: { email, name, password }, errors }
}

function validateLoginInput(body) {
  if (!isPlainObject(body)) {
    return { errors: { form: 'A JSON request body is required.' } }
  }

  const email = normalizeEmail(body.email)
  const password = body.password
  const errors = {}

  validateEmail(email, errors)

  if (typeof password !== 'string' || !password) {
    errors.password = 'Password is required.'
  } else if (password.length > 128) {
    errors.password = 'Password must be 128 characters or fewer.'
  }

  return { data: { email, password }, errors }
}

function validateAccountDeletionInput(body) {
  if (!isPlainObject(body)) {
    return { errors: { form: 'A JSON request body is required.' } }
  }

  const password = body.password
  const confirmation = body.confirmation
  const errors = {}

  if (typeof password !== 'string' || !password) {
    errors.password = 'Password is required to delete your account.'
  } else if (password.length > 128) {
    errors.password = 'Password must be 128 characters or fewer.'
  }

  if (confirmation !== 'DELETE') {
    errors.confirmation = 'Type DELETE to confirm permanent account deletion.'
  }

  return { data: { password }, errors }
}

export {
  normalizeEmail,
  validateAccountDeletionInput,
  validateLoginInput,
  validateRegistrationInput,
}
