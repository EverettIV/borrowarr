const canManageDownloadClients = (user) => Boolean(user?.permissions?.admin);

const SENSITIVE_SETTING_KEY = /^(password|apikey|api_key|secret|token|rpcsecret|rpc_secret)$/i;

function redactDownloadClientSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return {};
  }
  const next = { ...settings };
  for (const key of Object.keys(next)) {
    if (SENSITIVE_SETTING_KEY.test(key) || key.toLowerCase().includes('password')) {
      delete next[key];
    }
  }
  return next;
}

function sanitizeDownloadClientForUser(clientJson, user) {
  const plain = typeof clientJson?.toJSON === 'function' ? clientJson.toJSON() : { ...clientJson };
  if (canManageDownloadClients(user)) {
    return plain;
  }
  return {
    ...plain,
    settings: redactDownloadClientSettings(plain.settings),
  };
}

module.exports = {
  canManageDownloadClients,
  sanitizeDownloadClientForUser,
  redactDownloadClientSettings,
};