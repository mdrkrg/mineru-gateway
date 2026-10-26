# Frontend subpath deployment

The frontend and API can share one origin below an application path. For this
example, the public UI is `https://example.com/mineru` and the public API is
`https://example.com/mineru/api`.

## Path contract

| Public request | Bundled Caddy action | Internal target |
|---|---|---|
| `/mineru` | redirect | `/mineru/` |
| `/mineru/api/*` | strip `/mineru/api` | Gateway `/*` |
| `/mineru/*` | strip `/mineru` and serve the SPA | static files |

The API matcher runs before the SPA matcher. Requests outside `/mineru` return
404 when a non-root base is configured.

## Container configuration

Copy and edit the example environment file:

```bash
cp container/.env.example container/.env
```

Set the public mount and API URL:

```env
FRONTEND_BASE_PATH=/mineru
GATEWAY_GATEWAY_URL=https://example.com/mineru/api
```

`FRONTEND_BASE_PATH` must be empty for a root deployment or an absolute path
without a trailing slash. Compose uses it in two places:

- the frontend image build emits `/mineru/assets/*` and uses router base
  `/mineru/`
- Caddy strips `/mineru` for files and `/mineru/api` for Gateway requests

`GATEWAY_GATEWAY_URL` is required by the Compose stack and must be the complete
browser-visible API base, including `<FRONTEND_BASE_PATH>/api`.

The frontend base is baked into the JavaScript bundle. Changing it requires an
image rebuild:

```bash
podman compose -f container/compose.yaml up --build -d
```

The Compose stack derives `GATEWAY_ROOT_PATH=/mineru/api` from the frontend
base. This affects ASGI-generated public URLs but not internal route matching.

## Standalone frontend build

When the frontend and Gateway are deployed separately, provide both Vite
variables at build time:

```bash
cd frontend
VITE_APP_BASE_PATH=/mineru/ \
VITE_API_PREFIX=/mineru/api \
pnpm build
```

Configure the Gateway independently:

```env
GATEWAY_ROOT_PATH=/mineru/api
GATEWAY_GATEWAY_URL=https://example.com/mineru/api
```

A stripping Caddy route has this shape:

```caddyfile
example.com {
	handle_path /mineru/api/* {
		reverse_proxy gateway:8000
	}

	redir /mineru /mineru/ 308

	handle_path /mineru/* {
		root * /srv/mineru-frontend
		try_files {path} /index.html
		file_server
	}
}
```

## OAuth and email verification

When user authentication is enabled, set the browser destination after OAuth
or email verification:

```env
GATEWAY_OAUTH_FRONTEND_REDIRECT_URL=https://example.com/mineru/oauth/callback
```

Register this OAuth callback with the identity provider:

```text
https://example.com/mineru/api/auth/oauth/{provider}/callback
```

The Gateway exchanges the authorization code at that API callback, then sends
the browser to:

```text
https://example.com/mineru/oauth/callback
```

`GATEWAY_OAUTH_REDIRECT_BASE_URL` defaults to `GATEWAY_GATEWAY_URL`; set it only
when the public OAuth callback uses a different API base. Email verification
uses the same frontend callback. If
`GATEWAY_VERIFY_EMAIL_BASE_URL` is set explicitly, it must also include the
public API prefix.

## Verification

After deployment, verify both direct and fallback paths:

```bash
curl -I https://example.com/mineru
curl -fsS https://example.com/mineru/
curl -fsS https://example.com/mineru/tasks
curl -fsS https://example.com/mineru/api/v1/health
curl -fsS https://example.com/mineru/api/openapi.json
```

Expected behavior:

- `/mineru` returns a 308 redirect to `/mineru/`
- the SPA and its assets load only below `/mineru`
- refreshing a nested frontend route returns `index.html`
- Gateway responses expose status and result URLs below `/mineru/api`
- `/mineru/api/docs` loads `/mineru/api/openapi.json`
