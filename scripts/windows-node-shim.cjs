// Node.js 25 can fail to resolve the Windows user in restricted background jobs.
// tsx only needs the username to choose a temporary directory, so provide a safe fallback.
if (process.platform === 'win32') {
  const os = require('node:os');
  try { os.userInfo(); }
  catch {
    os.userInfo = () => ({
      username: process.env.USERNAME || 'windows-user',
      uid: -1,
      gid: -1,
      shell: null,
      homedir: process.env.USERPROFILE || process.cwd(),
    });
  }
}
