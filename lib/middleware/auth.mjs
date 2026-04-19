export default function authMiddleware (req, res, next) {
  const auth = {login: 'admin', password: 'admin'} // change this

  // parse login and password from headers
  const [scheme, b64auth] = (req.headers.authorization || '').split(' ', 2);
  if (scheme === 'Basic' && b64auth) {
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':')
    // Verify login and password are set and correct
    if (login && password && login === auth.login && password === auth.password) {
      // Access granted...
      return next();
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="bulletin" charset="UTF-8"');
  const err = new Error('Authentication required.');
  err.status = 401;
  throw err;
}