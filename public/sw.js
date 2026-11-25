/* Trip Log service worker: makes the app installable, opens fast, and shows push alerts.
   Data (/api) is never cached, so screens always show live numbers. App files are network-first,
   so a new version shows up as soon as the phone is online. */
'use strict';
const CACHE = 'triplog-shell-v5';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/shared/logic.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/demo-accounts') return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Trip Log', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Trip Log', {
    body: d.body || '', icon: '/icons/icon-192.png', tag: d.link || 'triplog', renotify: true, data: { link: d.link || '' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = '/' + (e.notification.data && e.notification.data.link ? e.notification.data.link : '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => new URL(c.url).origin === location.origin);
    if (w) { w.navigate(target).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});
