export type ApiResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthorized' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'title', 'error', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return fallback;
}

export async function send<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  } catch {
    return { status: 'unavailable' };
  }
  return interpret(response);
}

export async function get<T>(path: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    return { status: 'unavailable' };
  }
  return interpret(response);
}

async function interpret<T>(response: Response): Promise<ApiResult<T>> {
  if (response.status === 401) {
    return { status: 'unauthorized' };
  }
  if (response.status === 503) {
    return { status: 'unavailable' };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    return { status: 'error', message: messageFrom(body, `Request failed (${response.status})`) };
  }
  return { status: 'ok', data: body as T };
}

export function post<T>(path: string, payload: unknown): Promise<ApiResult<T>> {
  return send('POST', path, payload);
}

export async function login(email: string, password: string): Promise<ApiResult<{ ok: true }>> {
  return post('/api/login', { email, password });
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // best effort; the cookie is cleared server-side
  }
}
