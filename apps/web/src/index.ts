import { fetchHealth } from './health.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}

const button = element<HTMLButtonElement>('retry');
const heading = element('connection-heading');
const message = element('message');
const badge = element('badge');
const details = element('details');

async function checkConnection() {
  button.disabled = true;
  button.textContent = 'Checking…';
  heading.textContent = 'Checking connection…';
  message.textContent = 'Contacting the AkGebeya service.';
  badge.textContent = 'Checking';
  badge.dataset['state'] = 'loading';
  details.hidden = true;
  try {
    const health = await fetchHealth();
    heading.textContent = 'You’re connected.';
    message.textContent = 'The AkGebeya backend responded successfully.';
    badge.textContent = 'Connected';
    badge.dataset['state'] = 'success';
    element('service').textContent = health.service;
    element('timestamp').textContent = new Date(health.timestamp).toLocaleString();
    details.hidden = false;
  } catch {
    heading.textContent = 'Connection unavailable.';
    message.textContent = 'We couldn’t reach the AkGebeya service. Make sure the backend is running, then try again.';
    badge.textContent = 'Unavailable';
    badge.dataset['state'] = 'error';
  } finally {
    button.disabled = false;
    button.textContent = 'Check again';
  }
}

button.addEventListener('click', () => { void checkConnection(); });
void checkConnection();
