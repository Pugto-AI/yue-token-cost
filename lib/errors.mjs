/**
 * Errors that should reach the caller as a clean message (never a stack trace).
 */

export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

const SPECIAL_TOKEN_MSG = /special token that is not allowed/i
const SPECIAL_TOKEN_LITERAL = /<\|[a-z_]+\|>/i

/**
 * js-tiktoken throws when the text contains a reserved special-token literal
 * (o200k_base: <|endoftext|>, <|endofprompt|>; cl100k_base also has the three fim tokens).
 * That is a caller mistake, not an internal failure - report it as such.
 * @param {unknown} err
 * @param {string} text
 * @returns {Error}
 */
export function mapEncoderError(err, text) {
  const message = String(err && err.message ? err.message : err)
  if (SPECIAL_TOKEN_MSG.test(message)) {
    const found = SPECIAL_TOKEN_LITERAL.exec(text)
    return new ValidationError(
      `text contains a reserved special token (${found ? found[0] : 'special token'}); it cannot be measured as plain text`,
    )
  }
  return err instanceof Error ? err : new Error(message)
}
