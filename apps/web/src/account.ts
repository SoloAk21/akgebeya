export {};

function control<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing account control: ${id}`);
  return node as T;
}

const form = control<HTMLFormElement>('auth-form');
const email = control<HTMLInputElement>('email');
const password = control<HTMLInputElement>('password');
const submit = control<HTMLButtonElement>('auth-submit');
const toggle = control<HTMLButtonElement>('auth-switch');
const logout = control<HTMLButtonElement>('logout');
const retry = control<HTMLButtonElement>('session-retry');
const status = control('auth-status');
const heading = control('account-heading');
const signedIn = control('signed-in');
let register = false;

function busy(value: boolean) {
  for (const input of [email, password, submit, toggle, logout, retry]) input.disabled = value;
  form.setAttribute('aria-busy', String(value));
}

async function request(path: string, data?: { email: string; password: string } | Record<string, never>) {
  const response = await fetch(`/api/auth/${path}`, {
    method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json() as { user?: { email: string }; message?: string };
  return { response, result };
}

function showUser(accountEmail?: string) {
  form.hidden = Boolean(accountEmail);
  signedIn.hidden = !accountEmail;
  retry.hidden = true;
  control('account-email').textContent = accountEmail ?? '';
  password.value = '';
  heading.textContent = accountEmail ? 'You’re signed in.' : register ? 'Create your account' : 'Sign in';
}

async function loadSession() {
  busy(true);
  status.textContent = 'Checking your session…';
  try {
    const { response, result } = await request('session');
    if (response.ok && result.user) { showUser(result.user.email); status.textContent = 'Your session is active.'; }
    else if (response.status === 401) { showUser(); status.textContent = 'Sign in or create an account to get started.'; }
    else { throw new Error('Session check failed'); }
  } catch {
    status.textContent = 'We couldn’t check your session. Please try again.';
    retry.hidden = false;
  } finally { busy(false); }
}

toggle.addEventListener('click', () => {
  register = !register;
  heading.textContent = register ? 'Create your account' : 'Sign in';
  submit.textContent = register ? 'Create account' : 'Sign in';
  toggle.textContent = register ? 'Sign in instead' : 'Create an account instead';
  password.autocomplete = register ? 'new-password' : 'current-password';
  status.textContent = register ? 'Your email will be your sign-in name. Email verification is not available yet.' : 'Welcome back. Enter your details below.';
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  void (async () => {
    busy(true);
    status.textContent = register ? 'Creating your account…' : 'Signing in…';
    try {
      const { response, result } = await request(register ? 'register' : 'login', { email: email.value, password: password.value });
      if (response.ok && result.user) { showUser(result.user.email); status.textContent = 'You’re signed in. Your session will remain active after a refresh.'; }
      else { status.textContent = result.message ?? 'Unable to sign in. Please try again.'; }
    } catch {
      status.textContent = 'The request could not be confirmed. Check your session before trying again.';
      retry.hidden = false;
    } finally { password.value = ''; busy(false); }
  })();
});

logout.addEventListener('click', () => {
  void (async () => {
    busy(true);
    try {
      const { response, result } = await request('logout', {});
      if (!response.ok) throw new Error(result.message);
      showUser();
      status.textContent = 'You’ve signed out.';
    } catch { status.textContent = 'Sign-out could not be confirmed. Please try again.'; }
    finally { busy(false); }
  })();
});
retry.addEventListener('click', () => { void loadSession(); });
void loadSession();
