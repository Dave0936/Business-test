/**
 * Runs once per server instance. When the deployment sits behind an outbound HTTP(S)
 * proxy (HTTPS_PROXY / HTTP_PROXY set), route all server-side fetch() calls through it,
 * honouring NO_PROXY. Without these variables nothing changes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy && !process.env.HTTP_PROXY && !process.env.http_proxy) return;
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
