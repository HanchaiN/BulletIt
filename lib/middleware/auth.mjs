import crypto from "node:crypto";

class AuthenticationError extends Error {
  constructor(message = 'Authentication required', options = { status: 401 }) {
    super(message, options);
    this.status = options.status;
  }
}

export default function authMiddleware (req, res, next) {
  const realm = "bulletin";

  // res.setHeader('Strict-Transport-Security', 'max-age=300')

  try {
    // parse login and password from headers
    const [scheme, auth_response] = (req.headers.authorization || '').split(' ', 2);
    if (scheme === 'Basic' && auth_response) {
      const [login, password] = Buffer.from(auth_response, 'base64').toString('utf-8').split(':')
      // Verify login and password are set and correct
      if (!login || !password) {
        throw new AuthenticationError('username and password are required');
      }
      const hash = crypto.createHmac('sha256', res.app.locals.auth.secret)
        .update(password, 'utf-8').digest();
      // FIXME
      if (res.app.locals.auth.password[login] === null) {
        res.app.locals.auth.password[login] = hash;
      } else if (typeof res.app.locals.auth.password[login] === "string") {
        res.app.locals.auth.password[login] = crypto.createHmac('sha256', res.app.locals.auth.secret)
          .update(res.app.locals.auth.password[login], 'utf-8').digest();
      }
      if (!crypto.timingSafeEqual(
        hash,
        res.app.locals.auth.password[login] ?? Buffer.alloc(32),
      )) {
        throw new AuthenticationError('Authentication failed');
      }
      return next();
    }
    throw new AuthenticationError();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.setHeader('WWW-Authenticate', [
        `Basic realm="${realm}", charset="UTF-8"`,
      ]);
      throw error;
    }
    throw error;
  }
}