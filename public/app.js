const $ = id => document.getElementById(id);
const CONTRACT = /^C[A-Z2-7]{55}$/;
let current = null;
let nextCursor = null;
let isLoading = false;

function short(value, head = 12, tail = 8) {
  return typeof value === 'string' && value.length > head + tail + 3
    ? value.slice(0, head) + '…' + value.slice(-tail) : String(value ?? '—');
}
function notice(message, kind = 'info') {
  $('message').textContent = message;
  $('message').className = 'message ' + kind;
}
function setBusy(busy) {
  isLoading = busy;
  $('search-button').disabled = busy;
  $('search-button').textContent = busy ? 'Fetching…' : 'Fetch events ↗';
  $('next-button').disabled = busy || !nextCursor;
}
function setEmpty(title, description) {
  const empty = $('empty-state');
  empty.hidden = false;
  empty.querySelector('h2').textContent = title;
  empty.querySelector('p').textContent = description;
  $('table-wrap').hidden = true;
}
async function request(path, signal) {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Server returned invalid JSON'); }
  if (!response.ok) throw new Error(data?.error || 'Request failed (HTTP ' + response.status + ')');
  return data;
}
async function checkHealth() {
  try {
    const health = await request('/api/health');
    const online = health?.status === 'ok';
    $('health-label').textContent = online ? 'Monitor online' : 'Monitor unavailable';
    $('health-dot').classList.toggle('online', online);
  } catch {
    $('health-label').textContent = 'Monitor offline';
    $('health-dot').classList.remove('online');
  }
}
let controller = null;
async function loadPage(cursor = null) {
  if (isLoading || !current) return;
  if (controller) controller.abort();
  controller = new AbortController();
  setBusy(true);
  notice('Reading indexed events from DevGuard Monitor…');
  const params = new URLSearchParams({
    network: current.network,
    contractId: current.contractId,
    limit: String(current.limit)
  });
  if (cursor) {
    params.set('afterLedger', String(cursor.afterLedger));
    params.set('afterEventId', cursor.afterEventId);
  }
  try {
    const data = await request('/api/events?' + params.toString(), controller.signal);
    if (!Array.isArray(data.events) || !(data.nextCursor === null ||
      (Number.isSafeInteger(data.nextCursor?.afterLedger) && typeof data.nextCursor?.afterEventId === 'string'))) {
      throw new Error('Monitor returned an unexpected event response');
    }
    nextCursor = data.nextCursor;
    $('result-count').textContent = data.events.length + ' event' + (data.events.length === 1 ? '' : 's') + ' this page';
    $('result-network').textContent = current.network.toUpperCase();
    $('page-label').textContent = nextCursor ? 'More indexed events available' : 'End of available events';
    $('event-rows').replaceChildren();
    if (data.events.length === 0) {
      setEmpty('No indexed events', 'The monitor has not stored matching events, or there are no later events for this cursor.');
      notice('No events found in the monitor database.', 'info');
    } else {
      $('empty-state').hidden = true;
      $('table-wrap').hidden = false;
      data.events.forEach(appendEventRow);
      notice('Events loaded from Monitor.', 'success');
    }
  } catch (error) {
    nextCursor = null;
    setEmpty('Unable to load events', 'Check that DevGuard Monitor is running, accessible and has indexed this contract.');
    notice(error.message, 'error');
    $('page-label').textContent = 'Query unsuccessful';
  } finally { setBusy(false); }
}
function appendEventRow(event) {
  const tr = document.createElement('tr');
  const values = [
    short(event.id, 13, 9), String(event.ledger ?? '—'),
    String(event.type ?? '—'), short(event.txHash, 11, 7),
    typeof event.ledgerClosedAt === 'string' ? event.ledgerClosedAt.replace('T', ' ').replace(/Z$/, ' UTC') : '—'
  ];
  values.forEach((value, index) => {
    const td = document.createElement('td');
    td.textContent = value;
    if (index === 0 || index === 3) {
      td.className = 'mono';
      td.title = String(index === 0 ? event.id ?? '' : event.txHash ?? '');
    }
    tr.append(td);
  });
  const td = document.createElement('td');
  const button = document.createElement('button');
  button.className = 'details-button';
  button.textContent = 'Inspect ↗';
  button.setAttribute('aria-label', 'Inspect event ' + String(event.id ?? ''));
  button.addEventListener('click', () => {
    $('details-json').textContent = JSON.stringify(event, null, 2);
    $('details').showModal();
  });
  td.append(button);
  tr.append(td);
  $('event-rows').append(tr);
}
$('search-form').addEventListener('submit', event => {
  event.preventDefault();
  if (isLoading) return;
  const contractId = $('contract').value.trim().toUpperCase();
  if (!CONTRACT.test(contractId)) {
    notice('Enter a valid 56-character Stellar contract ID beginning with C.', 'error');
    $('contract').focus();
    return;
  }
  current = { network: $('network').value, contractId, limit: Number($('limit').value) };
  nextCursor = null;
  loadPage();
});
$('next-button').addEventListener('click', () => {
  if (nextCursor && !isLoading) loadPage(nextCursor);
});
$('close-details').addEventListener('click', () => $('details').close());
$('details').addEventListener('click', e => {
  if (e.target === $('details')) $('details').close();
});
checkHealth();
