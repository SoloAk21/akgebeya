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
const profileForm = control<HTMLFormElement>('profile-form');
const displayName = control<HTMLInputElement>('display-name');
const profileSave = control<HTMLButtonElement>('profile-save');
const profileRetry = control<HTMLButtonElement>('profile-retry');
const profileStatus = control('profile-status');
let register = false;
let profileReady = false;

function busy(value: boolean) {
  for (const input of [email, password, submit, toggle, logout, retry]) input.disabled = value;
  form.setAttribute('aria-busy', String(value));
  displayName.disabled = value || !profileReady;
  profileSave.disabled = value || !profileReady;
  profileRetry.disabled = value;
  profileForm.setAttribute('aria-busy', String(value));
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

async function showUser(accountEmail?: string) {
  profileReady = false;
  displayName.value = '';
  profileStatus.textContent = '';
  profileRetry.hidden = true;
  form.hidden = Boolean(accountEmail);
  signedIn.hidden = !accountEmail;
  retry.hidden = true;
  control('account-email').textContent = accountEmail ?? '';
  password.value = '';
  heading.textContent = accountEmail ? 'You’re signed in.' : register ? 'Create your account' : 'Sign in';
  if (accountEmail) await loadProfile();
}

async function profileRequest(save = false) {
  const response = await fetch('/api/profile', {
    method: save ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(save ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: displayName.value }) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json() as { profile?: { displayName: string | null }; message?: string };
  if (response.status === 401) {
    await showUser();
    status.textContent = 'Your session has ended. Please sign in again.';
  }
  if (!response.ok || !result.profile) throw new Error(result.message ?? 'Unable to load your profile.');
  displayName.value = result.profile.displayName ?? '';
  profileReady = true;
}

async function loadProfile() {
  profileStatus.textContent = 'Loading your profile…';
  profileRetry.hidden = true;
  try {
    await profileRequest();
    profileStatus.textContent = displayName.value ? 'Your saved profile.' : 'Add a display name to complete your profile.';
  } catch {
    profileStatus.textContent = 'We couldn’t load your profile. Please try again.';
    profileRetry.hidden = false;
  }
}

profileForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!profileReady || !profileForm.reportValidity()) return;
  void (async () => {
    busy(true);
    profileStatus.textContent = 'Saving your profile…';
    try { await profileRequest(true); profileStatus.textContent = 'Profile saved.'; profileRetry.hidden = true; }
    catch (error) {
      profileStatus.textContent = error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'TypeError'
        ? error.message : 'Save could not be confirmed. Reload your profile to check before trying again.';
      profileRetry.hidden = false;
    } finally { busy(false); }
  })();
});
profileRetry.addEventListener('click', () => {
  void (async () => { busy(true); try { await loadProfile(); } finally { busy(false); } })();
});

async function loadSession() {
  busy(true);
  status.textContent = 'Checking your session…';
  try {
    const { response, result } = await request('session');
    if (response.ok && result.user) { await showUser(result.user.email); if (!signedIn.hidden) status.textContent = 'Your session is active.'; }
    else if (response.status === 401) { await showUser(); status.textContent = 'Sign in or create an account to get started.'; }
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
      if (response.ok && result.user) { await showUser(result.user.email); if (!signedIn.hidden) status.textContent = 'You’re signed in. Your session will remain active after a refresh.'; }
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
      await showUser();
      status.textContent = 'You’ve signed out.';
    } catch { status.textContent = 'Sign-out could not be confirmed. Please try again.'; }
    finally { busy(false); }
  })();
});
retry.addEventListener('click', () => { void loadSession(); });
void loadSession();
